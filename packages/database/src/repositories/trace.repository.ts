import type {
	TraceEvent,
	TraceGraph,
	TraceGraphEdge,
	TraceGraphNode,
	TraceStats,
	TraceSummary,
} from "@better-ccflare/types";
import { BaseRepository } from "./base.repository";

type TraceStatusFilter = "ok" | "error";

export interface ListTracesQuery {
	page: number;
	pageSize: number;
	fromTs?: number;
	toTs?: number;
	model?: string;
	projectPath?: string;
	status?: TraceStatusFilter;
}

interface StoredTraceEventRow {
	trace_id: string;
	span_id: string;
	parent_span_id: string | null;
	request_id: string | null;
	round_id: number | null;
	type: TraceEvent["type"];
	actor: string;
	ts_start: number;
	ts_end: number | null;
	status: TraceEvent["status"] | null;
	payload_json: string;
	metrics_json: string | null;
	tags_json: string | null;
}

function parseJsonObject(
	value: string | null,
): Record<string, unknown> | undefined {
	if (!value) return undefined;
	try {
		const parsed = JSON.parse(value) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

function parseJson<T>(value: string | null): T | undefined {
	if (!value) return undefined;
	try {
		return JSON.parse(value) as T;
	} catch {
		return undefined;
	}
}

function toTraceEvent(row: StoredTraceEventRow): TraceEvent {
	return {
		trace_id: row.trace_id,
		span_id: row.span_id,
		parent_span_id: row.parent_span_id || undefined,
		request_id: row.request_id || undefined,
		round_id: row.round_id ?? undefined,
		type: row.type,
		actor: row.actor,
		ts_start: row.ts_start,
		ts_end: row.ts_end ?? undefined,
		status: row.status ?? undefined,
		payload: parseJsonObject(row.payload_json) || {},
		metrics: parseJson(row.metrics_json),
		tags: parseJson(row.tags_json),
	};
}

export class TraceRepository extends BaseRepository<TraceEvent> {
	saveEvents(events: TraceEvent[]): void {
		if (events.length === 0) return;

		const stmt = this.db.prepare(`
			INSERT OR IGNORE INTO trace_events (
				trace_id,
				span_id,
				parent_span_id,
				request_id,
				round_id,
				type,
				actor,
				ts_start,
				ts_end,
				status,
				payload_json,
				metrics_json,
				tags_json
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);

		const run = this.db.transaction((batch: TraceEvent[]) => {
			for (const event of batch) {
				stmt.run(
					event.trace_id,
					event.span_id,
					event.parent_span_id || null,
					event.request_id || null,
					event.round_id ?? null,
					event.type,
					event.actor,
					event.ts_start,
					event.ts_end ?? null,
					event.status ?? null,
					JSON.stringify(event.payload || {}),
					event.metrics ? JSON.stringify(event.metrics) : null,
					event.tags ? JSON.stringify(event.tags) : null,
				);
			}
		});

		run(events);
	}

	getTraceEvents(traceId: string): TraceEvent[] {
		const rows = this.query<StoredTraceEventRow>(
			`
			SELECT
				trace_id,
				span_id,
				parent_span_id,
				request_id,
				round_id,
				type,
				actor,
				ts_start,
				ts_end,
				status,
				payload_json,
				metrics_json,
				tags_json
			FROM trace_events
			WHERE trace_id = ?
			ORDER BY ts_start ASC, span_id ASC
		`,
			[traceId],
		);
		return rows.map(toTraceEvent);
	}

	getTraceSummary(traceId: string): TraceSummary | null {
		const row = this.get<{
			started_at: number;
			ended_at: number;
			round_count: number;
			tool_call_count: number;
			total_tokens: number | null;
			cost_estimate: number | null;
			error_count: number;
		}>(
			`
			SELECT
				MIN(ts_start) AS started_at,
				MAX(COALESCE(ts_end, ts_start)) AS ended_at,
				MAX(COALESCE(round_id, 0)) AS round_count,
				SUM(CASE WHEN type = 'tool_call' THEN 1 ELSE 0 END) AS tool_call_count,
				SUM(COALESCE(CAST(json_extract(metrics_json, '$.total_tokens') AS INTEGER), 0)) AS total_tokens,
				SUM(COALESCE(CAST(json_extract(metrics_json, '$.cost_estimate') AS REAL), 0)) AS cost_estimate,
				SUM(CASE WHEN status = 'error' OR type = 'error' THEN 1 ELSE 0 END) AS error_count
			FROM trace_events
			WHERE trace_id = ?
		`,
			[traceId],
		);

		if (!row || row.started_at == null || row.ended_at == null) {
			return null;
		}

		const modelRows = this.query<{ payload_json: string }>(
			`
			SELECT payload_json
			FROM trace_events
			WHERE trace_id = ? AND type = 'llm_request'
		`,
			[traceId],
		);

		const modelSet = new Set<string>();
		for (const modelRow of modelRows) {
			const payload = parseJsonObject(modelRow.payload_json);
			const model = payload?.model;
			if (typeof model === "string" && model.trim().length > 0) {
				modelSet.add(model);
			}
		}

		const projectRow = this.get<{ tags_json: string | null }>(
			`
			SELECT tags_json
			FROM trace_events
			WHERE trace_id = ?
				AND json_extract(tags_json, '$.project_path') IS NOT NULL
			ORDER BY ts_start ASC
			LIMIT 1
		`,
			[traceId],
		);
		const projectTags = parseJsonObject(projectRow?.tags_json || null);
		const projectPath =
			typeof projectTags?.project_path === "string"
				? projectTags.project_path
				: undefined;

		return {
			trace_id: traceId,
			started_at: row.started_at,
			ended_at: row.ended_at,
			status: row.error_count > 0 ? "error" : "ok",
			project_path: projectPath,
			model_set: Array.from(modelSet),
			round_count: row.round_count || 0,
			tool_call_count: row.tool_call_count || 0,
			latency_ms: row.ended_at - row.started_at,
			total_tokens: row.total_tokens || 0,
			cost_estimate: row.cost_estimate || 0,
		};
	}

	private buildTraceFilter(query: ListTracesQuery): {
		whereSql: string;
		havingSql: string;
		params: Array<string | number>;
	} {
		const whereParts: string[] = [];
		const params: Array<string | number> = [];

		if (query.fromTs !== undefined) {
			whereParts.push("ts_start >= ?");
			params.push(query.fromTs);
		}
		if (query.toTs !== undefined) {
			whereParts.push("ts_start <= ?");
			params.push(query.toTs);
		}

		const havingParts: string[] = [];
		if (query.status === "error") {
			havingParts.push(
				"SUM(CASE WHEN status = 'error' OR type = 'error' THEN 1 ELSE 0 END) > 0",
			);
		}
		if (query.status === "ok") {
			havingParts.push(
				"SUM(CASE WHEN status = 'error' OR type = 'error' THEN 1 ELSE 0 END) = 0",
			);
		}

		if (query.model) {
			havingParts.push(
				"SUM(CASE WHEN type = 'llm_request' AND payload_json LIKE ? THEN 1 ELSE 0 END) > 0",
			);
			params.push(`%"model":"${query.model}"%`);
		}
		if (query.projectPath) {
			havingParts.push(
				"SUM(CASE WHEN json_extract(tags_json, '$.project_path') = ? THEN 1 ELSE 0 END) > 0",
			);
			params.push(query.projectPath);
		}

		return {
			whereSql:
				whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "",
			havingSql:
				havingParts.length > 0 ? `HAVING ${havingParts.join(" AND ")}` : "",
			params,
		};
	}

	listTraceSummaries(query: ListTracesQuery): TraceSummary[] {
		const { whereSql, havingSql, params } = this.buildTraceFilter(query);
		const offset = (query.page - 1) * query.pageSize;

		const rows = this.query<{ trace_id: string }>(
			`
			SELECT trace_id
			FROM trace_events
			${whereSql}
			GROUP BY trace_id
			${havingSql}
			ORDER BY MAX(COALESCE(ts_end, ts_start)) DESC
			LIMIT ? OFFSET ?
		`,
			[...params, query.pageSize, offset],
		);

		const summaries: TraceSummary[] = [];
		for (const row of rows) {
			const summary = this.getTraceSummary(row.trace_id);
			if (summary) {
				summaries.push(summary);
			}
		}

		return summaries;
	}

	countTraces(query: ListTracesQuery): number {
		const { whereSql, havingSql, params } = this.buildTraceFilter(query);
		const row = this.get<{ total: number }>(
			`
			SELECT COUNT(*) AS total
			FROM (
				SELECT trace_id
				FROM trace_events
				${whereSql}
				GROUP BY trace_id
				${havingSql}
			) filtered
		`,
			params,
		);
		return row?.total || 0;
	}

	getTraceGraph(traceId: string): TraceGraph {
		const events = this.getTraceEvents(traceId);
		const nodes: TraceGraphNode[] = events.map((event) => ({
			id: event.span_id,
			type: event.type,
			label: `${event.type}${event.round_id ? ` - round ${event.round_id}` : ""}`,
			round_id: event.round_id,
			status: event.status,
			ts_start: event.ts_start,
			ts_end: event.ts_end,
			metrics: event.metrics,
		}));

		const edges: TraceGraphEdge[] = events
			.filter((event) => !!event.parent_span_id)
			.map((event) => ({
				id: `e_${event.parent_span_id}_${event.span_id}`,
				source: event.parent_span_id || "",
				target: event.span_id,
				kind: "parent_child",
			}));

		return {
			trace_id: traceId,
			nodes,
			edges,
		};
	}

	getTraceStats(traceId: string): TraceStats | null {
		const summary = this.getTraceSummary(traceId);
		if (!summary) return null;

		const row = this.get<{
			prompt_tokens: number | null;
			completion_tokens: number | null;
			total_tokens: number | null;
			error_count: number;
		}>(
			`
			SELECT
				SUM(COALESCE(CAST(json_extract(metrics_json, '$.prompt_tokens') AS INTEGER), 0)) AS prompt_tokens,
				SUM(COALESCE(CAST(json_extract(metrics_json, '$.completion_tokens') AS INTEGER), 0)) AS completion_tokens,
				SUM(COALESCE(CAST(json_extract(metrics_json, '$.total_tokens') AS INTEGER), 0)) AS total_tokens,
				SUM(CASE WHEN status = 'error' OR type = 'error' THEN 1 ELSE 0 END) AS error_count
			FROM trace_events
			WHERE trace_id = ?
		`,
			[traceId],
		);

		const firstError = this.get<{
			span_id: string;
			type: string;
		}>(
			`
			SELECT span_id, type
			FROM trace_events
			WHERE trace_id = ? AND (status = 'error' OR type = 'error')
			ORDER BY ts_start ASC
			LIMIT 1
		`,
			[traceId],
		);

		return {
			trace_id: traceId,
			status: summary.status,
			latency_ms: summary.latency_ms,
			round_count: summary.round_count,
			tool_call_count: summary.tool_call_count,
			token_usage: {
				prompt_tokens: row?.prompt_tokens || 0,
				completion_tokens: row?.completion_tokens || 0,
				total_tokens: row?.total_tokens || 0,
			},
			cost_estimate: summary.cost_estimate,
			error_summary: {
				count: row?.error_count || 0,
				first_error_span_id: firstError?.span_id,
				first_error_type: firstError?.type,
			},
		};
	}

	getMaxRoundId(traceId: string): number {
		const row = this.get<{ round_id: number | null }>(
			`
			SELECT MAX(round_id) AS round_id
			FROM trace_events
			WHERE trace_id = ?
		`,
			[traceId],
		);
		return row?.round_id || 0;
	}

	getLatestChainParentSpan(traceId: string): string | null {
		const row = this.get<{ span_id: string }>(
			`
			SELECT span_id
			FROM trace_events
			WHERE trace_id = ? AND type IN ('tool_result', 'llm_response')
			ORDER BY COALESCE(ts_end, ts_start) DESC, ts_start DESC
			LIMIT 1
		`,
			[traceId],
		);
		return row?.span_id || null;
	}

	getLatestToolCallSpan(traceId: string, toolCallId: string): string | null {
		const row = this.get<{ span_id: string }>(
			`
			SELECT span_id
			FROM trace_events
			WHERE trace_id = ? AND type = 'tool_call'
				AND json_extract(payload_json, '$.tool_call_id') = ?
			ORDER BY ts_start DESC
			LIMIT 1
		`,
			[traceId, toolCallId],
		);
		return row?.span_id || null;
	}

	getLatestToolResultSpan(traceId: string, toolCallId: string): string | null {
		const row = this.get<{ span_id: string }>(
			`
			SELECT span_id
			FROM trace_events
			WHERE trace_id = ? AND type = 'tool_result'
				AND json_extract(payload_json, '$.tool_call_id') = ?
			ORDER BY ts_start DESC
			LIMIT 1
		`,
			[traceId, toolCallId],
		);
		return row?.span_id || null;
	}
}
