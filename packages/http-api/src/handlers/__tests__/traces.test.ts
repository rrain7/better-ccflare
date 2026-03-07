import { describe, expect, it } from "bun:test";
import type { DatabaseOperations } from "@better-ccflare/database";
import {
	createTraceDetailHandler,
	createTraceGraphHandler,
	createTraceLookupByRequestHandler,
	createTraceStatsHandler,
	createTracesListHandler,
} from "../traces";

function createMockDbOps(
	overrides: Partial<DatabaseOperations> = {},
): DatabaseOperations {
	return {
		listTraceSummaries: () => [],
		countTraces: () => 0,
		getTraceEvents: () => [],
		getTraceSummary: () => null,
		getTraceGraph: () => ({ trace_id: "tr_1", nodes: [], edges: [] }),
		getTraceStats: () => null,
		getLatestTraceIdForRequest: () => null,
		...overrides,
	} as unknown as DatabaseOperations;
}

describe("Trace handlers response envelope", () => {
	it("returns unified success envelope for trace list", async () => {
		const dbOps = createMockDbOps({
			listTraceSummaries: () => [
				{
					trace_id: "tr_1",
					started_at: 1,
					ended_at: 2,
					status: "ok",
					model_set: ["m1"],
					round_count: 1,
					tool_call_count: 0,
					latency_ms: 1,
					total_tokens: 10,
					cost_estimate: 0.01,
				},
			],
			countTraces: () => 1,
		});

		const handler = createTracesListHandler(dbOps);
		const req = new Request("http://localhost/api/traces", {
			headers: { "x-request-id": "req-test-list" },
		});
		const url = new URL("http://localhost/api/traces?page=1&page_size=20");
		const response = handler(req, url);
		const body = (await response.json()) as Record<string, unknown>;

		expect(response.status).toBe(200);
		expect(body.code).toBe(0);
		expect(body.message).toBe("ok");
		expect(body.request_id).toBe("req-test-list");
		expect((body.data as Record<string, unknown>).pagination).toBeDefined();
	});

	it("returns unified validation error envelope for invalid query", async () => {
		const handler = createTracesListHandler(createMockDbOps());
		const req = new Request("http://localhost/api/traces");
		const url = new URL("http://localhost/api/traces?page=0");
		const response = handler(req, url);
		const body = (await response.json()) as Record<string, unknown>;

		expect(response.status).toBe(400);
		expect(body.code).toBe(40001);
		expect(body.message).toBeDefined();
		expect(body.request_id).toBeDefined();
		expect((body.error as Record<string, unknown>).type).toBe(
			"VALIDATION_ERROR",
		);
	});

	it("returns unified not found envelope for missing trace", async () => {
		const dbOps = createMockDbOps({
			getTraceEvents: () => [],
		});
		const handler = createTraceDetailHandler(dbOps);
		const req = new Request("http://localhost/api/traces/tr_missing", {
			headers: { "x-request-id": "req-test-detail" },
		});
		const response = handler(req, "tr_missing");
		const body = (await response.json()) as Record<string, unknown>;

		expect(response.status).toBe(404);
		expect(body.code).toBe(40404);
		expect(body.message).toBe("trace not found");
		expect(body.request_id).toBe("req-test-detail");
	});

	it("wraps graph and stats in unified success envelope", async () => {
		const dbOps = createMockDbOps({
			getTraceSummary: () => ({
				trace_id: "tr_1",
				started_at: 1,
				ended_at: 2,
				status: "ok",
				model_set: ["m1"],
				round_count: 1,
				tool_call_count: 1,
				latency_ms: 1,
				total_tokens: 10,
				cost_estimate: 0.01,
			}),
			getTraceGraph: () => ({
				trace_id: "tr_1",
				nodes: [],
				edges: [],
			}),
			getTraceStats: () => ({
				trace_id: "tr_1",
				status: "ok",
				latency_ms: 1,
				round_count: 1,
				tool_call_count: 1,
				token_usage: {
					prompt_tokens: 1,
					completion_tokens: 1,
					total_tokens: 2,
				},
				cost_estimate: 0.01,
				error_summary: {
					count: 0,
				},
			}),
		});

		const graphHandler = createTraceGraphHandler(dbOps);
		const statsHandler = createTraceStatsHandler(dbOps);
		const req = new Request("http://localhost/api/traces/tr_1/graph");

		const graphRes = graphHandler(req, "tr_1");
		const graphBody = (await graphRes.json()) as Record<string, unknown>;
		expect(graphRes.status).toBe(200);
		expect(graphBody.code).toBe(0);
		expect((graphBody.data as Record<string, unknown>).trace_id).toBe("tr_1");

		const statsRes = statsHandler(req, "tr_1");
		const statsBody = (await statsRes.json()) as Record<string, unknown>;
		expect(statsRes.status).toBe(200);
		expect(statsBody.code).toBe(0);
		expect((statsBody.data as Record<string, unknown>).trace_id).toBe("tr_1");
	});

	it("returns trace lookup by request id in unified success envelope", async () => {
		const dbOps = createMockDbOps({
			getLatestTraceIdForRequest: () => "tr_lookup_1",
		});

		const handler = createTraceLookupByRequestHandler(dbOps);
		const req = new Request("http://localhost/api/traces/by-request/req_1", {
			headers: { "x-request-id": "req-test-lookup" },
		});
		const response = handler(req, "req_1");
		const body = (await response.json()) as Record<string, unknown>;

		expect(response.status).toBe(200);
		expect(body.code).toBe(0);
		expect(body.request_id).toBe("req-test-lookup");
		expect((body.data as Record<string, unknown>).request_id).toBe("req_1");
		expect((body.data as Record<string, unknown>).trace_id).toBe("tr_lookup_1");
	});
});
