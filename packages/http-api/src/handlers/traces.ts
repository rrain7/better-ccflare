import { randomUUID } from "node:crypto";
import { validateNumber } from "@better-ccflare/core";
import type { DatabaseOperations } from "@better-ccflare/database";
import { jsonResponse } from "@better-ccflare/http-common";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const TRACE_API_CODE_OK = 0;
const TRACE_API_CODE_INVALID_ARGUMENT = 40001;
const TRACE_API_CODE_TRACE_NOT_FOUND = 40404;
const TRACE_API_CODE_INTERNAL_ERROR = 50000;

function createRequestId(req?: Request): string {
	const fromHeader = req?.headers.get("x-request-id");
	if (fromHeader && fromHeader.trim().length > 0) {
		return fromHeader.trim();
	}
	return `req_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

function traceSuccess(data: unknown, requestId: string): Response {
	return jsonResponse({
		code: TRACE_API_CODE_OK,
		message: "ok",
		request_id: requestId,
		data,
	});
}

function traceError(
	status: number,
	code: number,
	message: string,
	requestId: string,
	details?: Record<string, unknown>,
): Response {
	return jsonResponse(
		{
			code,
			message,
			request_id: requestId,
			error: {
				type:
					status >= 500
						? "INTERNAL_ERROR"
						: status === 404
							? "NOT_FOUND"
							: "VALIDATION_ERROR",
				details,
			},
		},
		status,
	);
}

function parseOptionalTimestamp(value: string | null): number | undefined {
	if (!value) return undefined;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) return undefined;
	return Math.trunc(parsed);
}

export function createTracesListHandler(dbOps: DatabaseOperations) {
	return (req: Request, url: URL): Response => {
		const requestId = createRequestId(req);
		let page: number;
		let pageSize: number;

		try {
			page =
				validateNumber(
					url.searchParams.get("page") || `${DEFAULT_PAGE}`,
					"page",
					{
						min: 1,
						integer: true,
					},
				) || DEFAULT_PAGE;

			pageSize =
				validateNumber(
					url.searchParams.get("page_size") || `${DEFAULT_PAGE_SIZE}`,
					"page_size",
					{
						min: 1,
						max: MAX_PAGE_SIZE,
						integer: true,
					},
				) || DEFAULT_PAGE_SIZE;
		} catch (error) {
			return traceError(
				400,
				TRACE_API_CODE_INVALID_ARGUMENT,
				error instanceof Error ? error.message : "invalid query parameters",
				requestId,
			);
		}

		try {
			const fromTs = parseOptionalTimestamp(url.searchParams.get("from_ts"));
			const toTs = parseOptionalTimestamp(url.searchParams.get("to_ts"));
			const model = url.searchParams.get("model") || undefined;
			const projectPath = url.searchParams.get("project_path") || undefined;

			const rawStatus = url.searchParams.get("status");
			const status: "ok" | "error" | undefined =
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

			return traceSuccess(
				{
					items,
					pagination: {
						page,
						page_size: pageSize,
						total,
					},
				},
				requestId,
			);
		} catch (error) {
			return traceError(
				500,
				TRACE_API_CODE_INTERNAL_ERROR,
				error instanceof Error ? error.message : "internal trace query failure",
				requestId,
			);
		}
	};
}

export function createTraceDetailHandler(dbOps: DatabaseOperations) {
	return (req: Request, traceId: string): Response => {
		const requestId = createRequestId(req);
		try {
			const events = dbOps.getTraceEvents(traceId);
			if (events.length === 0) {
				return traceError(
					404,
					TRACE_API_CODE_TRACE_NOT_FOUND,
					"trace not found",
					requestId,
					{ trace_id: traceId },
				);
			}

			return traceSuccess(
				{
					trace_id: traceId,
					events,
				},
				requestId,
			);
		} catch (error) {
			return traceError(
				500,
				TRACE_API_CODE_INTERNAL_ERROR,
				error instanceof Error ? error.message : "internal trace query failure",
				requestId,
				{ trace_id: traceId },
			);
		}
	};
}

export function createTraceGraphHandler(dbOps: DatabaseOperations) {
	return (req: Request, traceId: string): Response => {
		const requestId = createRequestId(req);
		try {
			const summary = dbOps.getTraceSummary(traceId);
			if (!summary) {
				return traceError(
					404,
					TRACE_API_CODE_TRACE_NOT_FOUND,
					"trace not found",
					requestId,
					{ trace_id: traceId },
				);
			}

			return traceSuccess(dbOps.getTraceGraph(traceId), requestId);
		} catch (error) {
			return traceError(
				500,
				TRACE_API_CODE_INTERNAL_ERROR,
				error instanceof Error ? error.message : "internal trace query failure",
				requestId,
				{ trace_id: traceId },
			);
		}
	};
}

export function createTraceStatsHandler(dbOps: DatabaseOperations) {
	return (req: Request, traceId: string): Response => {
		const requestId = createRequestId(req);
		try {
			const stats = dbOps.getTraceStats(traceId);
			if (!stats) {
				return traceError(
					404,
					TRACE_API_CODE_TRACE_NOT_FOUND,
					"trace not found",
					requestId,
					{ trace_id: traceId },
				);
			}

			return traceSuccess(stats, requestId);
		} catch (error) {
			return traceError(
				500,
				TRACE_API_CODE_INTERNAL_ERROR,
				error instanceof Error ? error.message : "internal trace query failure",
				requestId,
				{ trace_id: traceId },
			);
		}
	};
}

export function createTraceLookupByRequestHandler(dbOps: DatabaseOperations) {
	return (req: Request, linkedRequestId: string): Response => {
		const requestId = createRequestId(req);
		try {
			return traceSuccess(
				{
					request_id: linkedRequestId,
					trace_id: dbOps.getLatestTraceIdForRequest(linkedRequestId),
				},
				requestId,
			);
		} catch (error) {
			return traceError(
				500,
				TRACE_API_CODE_INTERNAL_ERROR,
				error instanceof Error
					? error.message
					: "internal trace lookup failure",
				requestId,
				{ request_id: linkedRequestId },
			);
		}
	};
}
