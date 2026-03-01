#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { resolveDbPath } from "@better-ccflare/database";

type TraceType =
	| "user_input"
	| "orchestration_decision"
	| "llm_request"
	| "llm_response"
	| "tool_call"
	| "tool_result"
	| "error";

interface TraceEventRow {
	trace_id: string;
	span_id: string;
	parent_span_id: string | null;
	type: TraceType;
	ts_start: number;
	status: string | null;
	payload_json: string;
}

interface VerifyIssue {
	traceId: string;
	spanId: string;
	level: "error" | "warning";
	message: string;
}

function parseArgs() {
	const args = process.argv.slice(2);
	const options: { dbPath: string; traceId?: string; help: boolean } = {
		dbPath: resolveDbPath(),
		help: false,
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--help" || arg === "-h") {
			options.help = true;
			return options;
		}
		if (arg === "--db-path" && args[i + 1]) {
			options.dbPath = args[i + 1];
			i += 1;
			continue;
		}
		if (arg === "--trace-id" && args[i + 1]) {
			options.traceId = args[i + 1];
			i += 1;
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}

	return options;
}

function parsePayload(value: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(value) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		return {};
	} catch {
		return {};
	}
}

function verifyTraceRows(rows: TraceEventRow[]): VerifyIssue[] {
	const issues: VerifyIssue[] = [];
	const bySpanId = new Map(rows.map((row) => [row.span_id, row] as const));
	const toolCallsById = new Map<string, TraceEventRow[]>();

	for (const row of rows) {
		if (row.parent_span_id) {
			const parent = bySpanId.get(row.parent_span_id);
			if (!parent) {
				issues.push({
					traceId: row.trace_id,
					spanId: row.span_id,
					level: "error",
					message: `parent_span_id ${row.parent_span_id} not found in same trace`,
				});
			} else if (parent.span_id === row.span_id) {
				issues.push({
					traceId: row.trace_id,
					spanId: row.span_id,
					level: "error",
					message: "parent_span_id points to itself",
				});
			} else if (parent.ts_start > row.ts_start) {
				issues.push({
					traceId: row.trace_id,
					spanId: row.span_id,
					level: "warning",
					message: `parent starts later than child (${parent.ts_start} > ${row.ts_start})`,
				});
			}
		}

		if (row.type !== "tool_call") continue;
		const payload = parsePayload(row.payload_json);
		const toolCallId = payload.tool_call_id;
		if (typeof toolCallId !== "string" || toolCallId.trim().length === 0) {
			issues.push({
				traceId: row.trace_id,
				spanId: row.span_id,
				level: "error",
				message: "tool_call missing payload.tool_call_id",
			});
			continue;
		}
		if (!toolCallsById.has(toolCallId)) {
			toolCallsById.set(toolCallId, []);
		}
		toolCallsById.get(toolCallId)?.push(row);
	}

	for (const row of rows) {
		if (row.type !== "tool_result") continue;
		const payload = parsePayload(row.payload_json);
		const toolCallId = payload.tool_call_id;
		if (typeof toolCallId !== "string" || toolCallId.trim().length === 0) {
			issues.push({
				traceId: row.trace_id,
				spanId: row.span_id,
				level: "error",
				message: "tool_result missing payload.tool_call_id",
			});
			continue;
		}

		const linkedCalls = toolCallsById.get(toolCallId) || [];
		if (linkedCalls.length === 0) {
			issues.push({
				traceId: row.trace_id,
				spanId: row.span_id,
				level: "error",
				message: `tool_result references unknown tool_call_id ${toolCallId}`,
			});
			continue;
		}

		const linkedSpanSet = new Set(linkedCalls.map((call) => call.span_id));
		if (row.parent_span_id && !linkedSpanSet.has(row.parent_span_id)) {
			issues.push({
				traceId: row.trace_id,
				spanId: row.span_id,
				level: "warning",
				message: `parent_span_id ${row.parent_span_id} does not match linked tool_call spans`,
			});
		}

		const earliestCallTs = Math.min(...linkedCalls.map((call) => call.ts_start));
		if (row.ts_start < earliestCallTs) {
			issues.push({
				traceId: row.trace_id,
				spanId: row.span_id,
				level: "warning",
				message: `tool_result starts before tool_call (${row.ts_start} < ${earliestCallTs})`,
			});
		}
	}

	return issues;
}

function main() {
	const options = parseArgs();
	if (options.help) {
		console.log(`
Usage:
  bun scripts/check/verify-trace-links.ts [--db-path <path>] [--trace-id <id>]

Checks:
  - parent_span_id exists in the same trace
  - tool_call/tool_result payload.tool_call_id linkage
  - parent/tool_call timing consistency (warning level)
		`.trim());
		return;
	}

	const db = new Database(options.dbPath, { readonly: true });
	try {
		const whereSql = options.traceId ? "WHERE trace_id = ?" : "";
		const rows = db
			.query(
				`
				SELECT trace_id, span_id, parent_span_id, type, ts_start, status, payload_json
				FROM trace_events
				${whereSql}
				ORDER BY trace_id ASC, ts_start ASC, span_id ASC
				`,
			)
			.all(...(options.traceId ? [options.traceId] : [])) as TraceEventRow[];

		if (rows.length === 0) {
			console.log("No trace events found.");
			return;
		}

		const grouped = new Map<string, TraceEventRow[]>();
		for (const row of rows) {
			if (!grouped.has(row.trace_id)) grouped.set(row.trace_id, []);
			grouped.get(row.trace_id)?.push(row);
		}

		const issues: VerifyIssue[] = [];
		for (const [traceId, traceRows] of grouped) {
			const traceIssues = verifyTraceRows(traceRows);
			issues.push(...traceIssues);
			if (traceIssues.length === 0) {
				console.log(`OK ${traceId}: ${traceRows.length} events`);
			}
		}

		const errors = issues.filter((issue) => issue.level === "error");
		const warnings = issues.filter((issue) => issue.level === "warning");

		for (const issue of issues) {
			const marker = issue.level === "error" ? "ERR" : "WARN";
			console.log(`${marker} ${issue.traceId} ${issue.spanId} - ${issue.message}`);
		}

		console.log(
			`\nChecked ${grouped.size} traces, ${rows.length} events. ` +
				`Errors: ${errors.length}, Warnings: ${warnings.length}`,
		);

		if (errors.length > 0) {
			process.exitCode = 1;
		}
	} finally {
		db.close();
	}
}

if (import.meta.main) {
	main();
}

