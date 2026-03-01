import type { DatabaseOperations } from "@better-ccflare/database";
import { validateNumber } from "@better-ccflare/core";
import { jsonResponse } from "@better-ccflare/http-common";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function parseOptionalTimestamp(value: string | null): number | undefined {
	if (!value) return undefined;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) return undefined;
	return Math.trunc(parsed);
}

export function createTracesListHandler(dbOps: DatabaseOperations) {
	return (url: URL): Response => {
		const page =
			validateNumber(url.searchParams.get("page") || `${DEFAULT_PAGE}`, "page", {
				min: 1,
				integer: true,
			}) || DEFAULT_PAGE;

		const pageSize =
			validateNumber(
				url.searchParams.get("page_size") || `${DEFAULT_PAGE_SIZE}`,
				"page_size",
				{
					min: 1,
					max: MAX_PAGE_SIZE,
					integer: true,
				},
			) || DEFAULT_PAGE_SIZE;

		const fromTs = parseOptionalTimestamp(url.searchParams.get("from_ts"));
		const toTs = parseOptionalTimestamp(url.searchParams.get("to_ts"));
		const model = url.searchParams.get("model") || undefined;
		const projectPath = url.searchParams.get("project_path") || undefined;

		const rawStatus = url.searchParams.get("status");
		const status =
			rawStatus === "ok" || rawStatus === "error" ? rawStatus : undefined;

		const query = {
			page,
			pageSize,
			fromTs,
			toTs,
			model,
			projectPath,
			status,
		};

		const items = dbOps.listTraceSummaries(query);
		const total = dbOps.countTraces(query);

		return jsonResponse({
			items,
			pagination: {
				page,
				page_size: pageSize,
				total,
			},
		});
	};
}

export function createTraceDetailHandler(dbOps: DatabaseOperations) {
	return (traceId: string): Response => {
		const events = dbOps.getTraceEvents(traceId);
		if (events.length === 0) {
			return jsonResponse({ error: "trace not found" }, 404);
		}

		return jsonResponse({
			trace_id: traceId,
			events,
		});
	};
}

export function createTraceGraphHandler(dbOps: DatabaseOperations) {
	return (traceId: string): Response => {
		const summary = dbOps.getTraceSummary(traceId);
		if (!summary) {
			return jsonResponse({ error: "trace not found" }, 404);
		}

		return jsonResponse(dbOps.getTraceGraph(traceId));
	};
}

export function createTraceStatsHandler(dbOps: DatabaseOperations) {
	return (traceId: string): Response => {
		const stats = dbOps.getTraceStats(traceId);
		if (!stats) {
			return jsonResponse({ error: "trace not found" }, 404);
		}

		return jsonResponse(stats);
	};
}
