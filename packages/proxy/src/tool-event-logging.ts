import { createHash, randomUUID } from "node:crypto";
import { debugEvents } from "@better-ccflare/core";
import type { DatabaseOperations } from "@better-ccflare/database";
import { jsonResponse } from "@better-ccflare/http-common";
import { Logger } from "@better-ccflare/logger";
import type { TraceEvent } from "@better-ccflare/types";
import type { ProxyContext } from "./handlers/proxy-types";
import { resolveTraceIdentity } from "./trace-id";
import { getTraceToolSpanIds } from "./trace-normalizer";

const log = new Logger("ToolEventLogging");

type ToolLifecycleEventKind = "tool_call" | "tool_result";

interface ParsedToolLifecycleEvent {
	kind: ToolLifecycleEventKind;
	traceId: string;
	requestId?: string;
	toolCallId: string;
	toolName: string;
	eventName: string;
	ts: number;
	latencyMs: number;
	success: boolean;
	failureReason?: string;
	resultPreview?: string;
	retryCount?: number;
}

function readPath(obj: unknown, path: string): unknown {
	if (!obj || typeof obj !== "object") return undefined;
	const parts = path.split(".");
	let current: unknown = obj;
	for (const part of parts) {
		if (!current || typeof current !== "object") {
			return undefined;
		}
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

function pickString(obj: unknown, paths: string[]): string | undefined {
	for (const path of paths) {
		const value = readPath(obj, path);
		if (typeof value === "string" && value.trim().length > 0) {
			return value.trim();
		}
	}
	return undefined;
}

function pickNumber(obj: unknown, paths: string[]): number | undefined {
	for (const path of paths) {
		const value = readPath(obj, path);
		if (typeof value === "number" && Number.isFinite(value)) {
			return value;
		}
		if (typeof value === "string" && value.trim().length > 0) {
			const parsed = Number(value);
			if (Number.isFinite(parsed)) {
				return parsed;
			}
		}
	}
	return undefined;
}

function pickBoolean(obj: unknown, paths: string[]): boolean | undefined {
	for (const path of paths) {
		const value = readPath(obj, path);
		if (typeof value === "boolean") {
			return value;
		}
		if (typeof value === "string") {
			const lowered = value.trim().toLowerCase();
			if (lowered === "true") return true;
			if (lowered === "false") return false;
		}
	}
	return undefined;
}

function toTimestamp(raw: unknown): number | undefined {
	if (typeof raw === "number" && Number.isFinite(raw)) {
		// Heuristic: convert seconds to milliseconds if needed.
		return raw < 10_000_000_000 ? Math.trunc(raw * 1000) : Math.trunc(raw);
	}
	if (typeof raw === "string" && raw.trim().length > 0) {
		const asNumber = Number(raw);
		if (Number.isFinite(asNumber)) {
			return asNumber < 10_000_000_000
				? Math.trunc(asNumber * 1000)
				: Math.trunc(asNumber);
		}
		const parsedDate = Date.parse(raw);
		if (Number.isFinite(parsedDate)) {
			return parsedDate;
		}
	}
	return undefined;
}

function toContentSummary(value: unknown): {
	content_hash: string;
	content_size: number;
} {
	const text = typeof value === "string" ? value : JSON.stringify(value) || "";
	return {
		content_hash: `sha256:${createHash("sha256").update(text).digest("hex")}`,
		content_size: Buffer.byteLength(text, "utf-8"),
	};
}

function toPreviewText(value: unknown): string | undefined {
	if (value == null) return undefined;
	const raw =
		typeof value === "string" ? value : JSON.stringify(value) || String(value);
	const trimmed = raw.trim();
	if (!trimmed) return undefined;
	if (trimmed.length <= 800) {
		return trimmed;
	}
	return `${trimmed.slice(0, 800)}... (truncated ${trimmed.length - 800} chars)`;
}

function classifyEventKind(
	eventName: string,
	raw: unknown,
): ToolLifecycleEventKind | null {
	const normalized = eventName.toLowerCase();
	const phase = (
		pickString(raw, [
			"phase",
			"state",
			"status",
			"event_data.phase",
			"event_data.state",
		]) || ""
	)
		.toLowerCase()
		.trim();
	const signal = `${normalized} ${phase}`;

	const hasResultField =
		pickBoolean(raw, ["success", "ok", "is_error", "event_data.success"]) !==
			undefined ||
		pickNumber(raw, [
			"execution_latency_ms",
			"latency_ms",
			"duration_ms",
			"elapsed_ms",
			"event_data.execution_latency_ms",
			"event_data.duration_ms",
		]) !== undefined ||
		pickString(raw, [
			"error",
			"error_message",
			"failure_reason",
			"event_data.error",
			"event_data.error_message",
		]) !== undefined;

	if (
		hasResultField ||
		/result|complete|finish|finished|error|failed|failure|end|exit/.test(signal)
	) {
		return "tool_result";
	}
	if (/tool/.test(signal) && /start|call|invoke|use|exec/.test(signal)) {
		return "tool_call";
	}
	return null;
}

function listEventObjects(batchPayload: unknown): Record<string, unknown>[] {
	if (Array.isArray(batchPayload)) {
		return batchPayload.filter(
			(item): item is Record<string, unknown> =>
				!!item && typeof item === "object" && !Array.isArray(item),
		);
	}
	if (!batchPayload || typeof batchPayload !== "object") {
		return [];
	}

	const eventArrays = ["events", "items", "batch", "logs", "entries"].map(
		(key) => (batchPayload as Record<string, unknown>)[key],
	);

	for (const candidate of eventArrays) {
		if (!Array.isArray(candidate)) continue;
		return candidate.filter(
			(item): item is Record<string, unknown> =>
				!!item && typeof item === "object" && !Array.isArray(item),
		);
	}

	return [batchPayload as Record<string, unknown>];
}

export function parseToolLifecycleEventsFromBatch(
	batchPayload: unknown,
	requestHeaders: Record<string, string>,
	requestId: string,
): ParsedToolLifecycleEvent[] {
	const events = listEventObjects(batchPayload);
	if (events.length === 0) return [];

	const batchContext =
		batchPayload &&
		typeof batchPayload === "object" &&
		!Array.isArray(batchPayload)
			? (batchPayload as Record<string, unknown>)
			: {};
	const headerRequestId =
		Object.entries(requestHeaders).find(
			([key]) => key.toLowerCase() === "x-request-id",
		)?.[1] || undefined;

	const parsed: ParsedToolLifecycleEvent[] = [];
	for (const event of events) {
		const mergedEvent = { ...batchContext, ...event };
		const eventName =
			pickString(mergedEvent, [
				"event_name",
				"eventName",
				"event",
				"type",
				"event_type",
				"eventType",
				"kind",
				"event_data.event_name",
				"event_data.type",
			]) || "tool_event";
		const kind = classifyEventKind(eventName, mergedEvent);
		if (!kind) continue;

		const toolCallId = pickString(mergedEvent, [
			"tool_call_id",
			"toolCallId",
			"tool_use_id",
			"toolUseId",
			"call_id",
			"callId",
			"event_data.tool_call_id",
			"event_data.toolCallId",
			"event_data.tool_use_id",
			"event_data.call_id",
			"data.tool_call_id",
			"data.tool_use_id",
		]);
		if (!toolCallId) continue;

		const toolName =
			pickString(mergedEvent, [
				"tool_name",
				"toolName",
				"name",
				"event_data.tool_name",
				"event_data.toolName",
				"event_data.name",
				"data.tool_name",
			]) || "unknown";

		const ts =
			toTimestamp(
				readPath(mergedEvent, "timestamp") ||
					readPath(mergedEvent, "ts") ||
					readPath(mergedEvent, "time") ||
					readPath(mergedEvent, "created_at") ||
					readPath(mergedEvent, "event_data.timestamp"),
			) || Date.now();

		const executionLatency =
			pickNumber(mergedEvent, [
				"execution_latency_ms",
				"latency_ms",
				"duration_ms",
				"elapsed_ms",
				"event_data.execution_latency_ms",
				"event_data.latency_ms",
				"event_data.duration_ms",
			]) || 0;

		const successField = pickBoolean(mergedEvent, [
			"success",
			"ok",
			"event_data.success",
			"event_data.ok",
		]);
		const isError = pickBoolean(mergedEvent, [
			"is_error",
			"event_data.is_error",
		]);
		const failureReason = pickString(mergedEvent, [
			"error",
			"error_message",
			"failure_reason",
			"event_data.error",
			"event_data.error_message",
			"event_data.failure_reason",
		]);
		const success =
			successField !== undefined
				? successField
				: isError !== undefined
					? !isError
					: !failureReason;

		const retryCount = pickNumber(mergedEvent, [
			"retry_count",
			"retryCount",
			"attempt",
			"attempt_count",
			"retry_attempt",
			"event_data.retry_count",
			"event_data.retryCount",
			"event_data.attempt",
		]);

		const perEventRequestId = pickString(mergedEvent, [
			"request_id",
			"requestId",
			"event_data.request_id",
		]);

		const resultPreview = toPreviewText(
			readPath(mergedEvent, "result") ??
				readPath(mergedEvent, "output") ??
				readPath(mergedEvent, "content") ??
				readPath(mergedEvent, "response") ??
				readPath(mergedEvent, "event_data.result") ??
				readPath(mergedEvent, "event_data.output") ??
				readPath(mergedEvent, "event_data.content") ??
				readPath(mergedEvent, "data.result") ??
				readPath(mergedEvent, "data.output") ??
				failureReason,
		);

		const traceIdentity = resolveTraceIdentity(
			{
				requestHeaders,
				requestId: perEventRequestId || headerRequestId || requestId,
			},
			mergedEvent,
			JSON.stringify(mergedEvent),
		);

		parsed.push({
			kind,
			traceId: traceIdentity.traceId,
			requestId: perEventRequestId || headerRequestId || undefined,
			toolCallId,
			toolName,
			eventName,
			ts,
			latencyMs: Math.max(0, Math.trunc(executionLatency)),
			success: kind === "tool_call" ? true : success,
			failureReason: kind === "tool_result" ? failureReason : undefined,
			resultPreview: kind === "tool_result" ? resultPreview : undefined,
			retryCount:
				retryCount !== undefined
					? Math.max(0, Math.trunc(retryCount))
					: undefined,
		});
	}

	return parsed;
}

function persistToolLifecycleEvents(
	dbOps: DatabaseOperations,
	parsedEvents: ParsedToolLifecycleEvent[],
): { persisted: number; events: TraceEvent[] } {
	const traceEvents: TraceEvent[] = [];
	let persisted = 0;

	for (const event of parsedEvents) {
		const roundId = Math.max(1, dbOps.getTraceMaxRoundId(event.traceId));

		if (event.kind === "tool_call") {
			const existing = dbOps.getLatestTraceToolCallSpan(
				event.traceId,
				event.toolCallId,
			);
			if (existing) continue;

			traceEvents.push({
				trace_id: event.traceId,
				span_id: getTraceToolSpanIds(event.traceId, event.toolCallId)
					.toolCallSpanId,
				parent_span_id:
					dbOps.getLatestTraceChainParentSpan(event.traceId) || undefined,
				request_id: event.requestId,
				round_id: roundId,
				type: "tool_call",
				actor: `tool:${event.toolName}`,
				ts_start: event.ts,
				ts_end: event.ts,
				status: "ok",
				payload: {
					tool_call_id: event.toolCallId,
					tool_name: event.toolName,
					source: "native_event_logging",
					raw_event_name: event.eventName,
				},
				tags: {
					event_source: "native_tool_executor",
				},
			});
			persisted += 1;
			continue;
		}

		const existingResult = dbOps.getLatestTraceToolResultSpan(
			event.traceId,
			event.toolCallId,
		);
		if (existingResult) continue;

		const linkedToolCallSpan = dbOps.getLatestTraceToolCallSpan(
			event.traceId,
			event.toolCallId,
		);
		const endTs = event.ts;
		const startTs =
			event.latencyMs > 0 ? Math.max(0, endTs - event.latencyMs) : endTs;

		traceEvents.push({
			trace_id: event.traceId,
			span_id: getTraceToolSpanIds(event.traceId, event.toolCallId)
				.toolResultSpanId,
			parent_span_id:
				linkedToolCallSpan ||
				dbOps.getLatestTraceChainParentSpan(event.traceId) ||
				undefined,
			request_id: event.requestId,
			round_id: roundId,
			type: "tool_result",
			actor: `tool:${event.toolName}`,
			ts_start: startTs,
			ts_end: endTs,
			status: event.success ? "ok" : "error",
			payload: {
				tool_call_id: event.toolCallId,
				result_summary: toContentSummary({
					status: event.success ? "ok" : "error",
					failure_reason: event.failureReason,
				}),
				result_preview: event.resultPreview,
				execution_latency_ms: event.latencyMs,
				success: event.success,
				failure_reason: event.failureReason,
				retry_count: event.retryCount,
				source: "native_event_logging",
				raw_event_name: event.eventName,
			},
			metrics: {
				latency_ms: event.latencyMs || undefined,
			},
			tags: {
				event_source: "native_tool_executor",
			},
		});
		persisted += 1;
	}

	if (traceEvents.length > 0) {
		dbOps.saveTraceEvents(traceEvents);
	}

	return {
		persisted,
		events: traceEvents,
	};
}

export async function handleInternalEventLoggingBatch(
	req: Request,
	ctx: ProxyContext,
): Promise<Response> {
	let bodyText = "";
	try {
		bodyText = await req.text();
		if (!bodyText || bodyText.trim().length === 0) {
			return jsonResponse({ success: true, ingested: 0 });
		}
	} catch (error) {
		log.warn("Failed to read event logging request body", error);
		return jsonResponse({ success: true, ingested: 0 });
	}

	let payload: unknown;
	try {
		payload = JSON.parse(bodyText);
	} catch (error) {
		log.warn("Invalid JSON in /api/event_logging/batch payload", error);
		return jsonResponse({ success: true, ingested: 0 });
	}

	const requestHeaders = Object.fromEntries(req.headers.entries());
	const parsedEvents = parseToolLifecycleEventsFromBatch(
		payload,
		requestHeaders,
		`event_batch_${randomUUID().replace(/-/g, "")}`,
	);
	if (parsedEvents.length === 0) {
		return jsonResponse({ success: true, ingested: 0 });
	}

	ctx.asyncWriter.enqueue(() => {
		try {
			const result = persistToolLifecycleEvents(ctx.dbOps, parsedEvents);
			if (result.persisted > 0) {
				const emittedByRequest = new Map<
					string,
					{ traceId: string; events: TraceEvent[] }
				>();
				for (const traceEvent of result.events) {
					if (!traceEvent.request_id) continue;
					const existing = emittedByRequest.get(traceEvent.request_id);
					if (existing) {
						existing.events.push(traceEvent);
						continue;
					}
					emittedByRequest.set(traceEvent.request_id, {
						traceId: traceEvent.trace_id,
						events: [traceEvent],
					});
				}
				for (const [requestId, payload] of emittedByRequest) {
					debugEvents.emit("event", {
						type: "trace_events",
						requestId,
						traceId: payload.traceId,
						events: payload.events,
						source: "native_tool_logging",
					});
				}
				log.debug(
					`Persisted ${result.persisted} native tool lifecycle trace events`,
				);
			}
		} catch (error) {
			log.warn("Failed to persist native tool lifecycle events", error);
		}
	});

	return jsonResponse({ success: true, ingested: parsedEvents.length });
}
