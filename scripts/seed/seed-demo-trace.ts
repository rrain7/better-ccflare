#!/usr/bin/env bun
import { randomUUID } from "node:crypto";
import { DatabaseOperations, resolveDbPath } from "@better-ccflare/database";
import type { TraceEvent } from "@better-ccflare/types";

interface Options {
	dbPath: string;
	prefix: string;
	help: boolean;
}

function parseArgs(): Options {
	const args = process.argv.slice(2);
	const options: Options = {
		dbPath: resolveDbPath(),
		prefix: "tr_demo",
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
		if (arg === "--prefix" && args[i + 1]) {
			options.prefix = args[i + 1];
			i += 1;
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}

	return options;
}

function spanId() {
	return `sp_${randomUUID().replace(/-/g, "")}`;
}

function reqId(seed: string) {
	return `req_${seed}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

function buildDemoTraceEvents(prefix: string, baseTs: number): TraceEvent[] {
	const traceId1 = `${prefix}_agent_success_${baseTs}`;
	const traceId2 = `${prefix}_tool_error_${baseTs + 1}`;
	const traceId3 = `${prefix}_llm_only_${baseTs + 2}`;
	const traceId4 = `${prefix}_multi_tool_${baseTs + 3}`;
	const traceId5 = `${prefix}_recover_after_error_${baseTs + 4}`;

	const traces: TraceEvent[] = [];

	{
		const requestId = reqId("1");
		const user = spanId();
		const llmReq = spanId();
		const toolCall = spanId();
		const toolRes = spanId();
		const llmRes = spanId();
		traces.push(
			{
				trace_id: traceId1,
				span_id: user,
				type: "user_input",
				actor: "user",
				ts_start: baseTs + 0,
				ts_end: baseTs + 10,
				status: "ok",
				payload: { prompt: "Find latest dependency versions." },
				tags: { project_path: "D:/codes/xh/better-ccflare" },
			},
			{
				trace_id: traceId1,
				span_id: llmReq,
				parent_span_id: user,
				request_id: requestId,
				round_id: 1,
				type: "llm_request",
				actor: "model:claude",
				ts_start: baseTs + 15,
				ts_end: baseTs + 35,
				status: "ok",
				payload: { model: "claude-3-7-sonnet", turn: 1 },
				metrics: { prompt_tokens: 420, total_tokens: 420 },
				tags: { project_path: "D:/codes/xh/better-ccflare" },
			},
			{
				trace_id: traceId1,
				span_id: toolCall,
				parent_span_id: llmReq,
				request_id: requestId,
				round_id: 1,
				type: "tool_call",
				actor: "tool:web_search",
				ts_start: baseTs + 40,
				ts_end: baseTs + 45,
				status: "ok",
				payload: { tool_call_id: "tc_success_1", tool_name: "web_search" },
				tags: { project_path: "D:/codes/xh/better-ccflare" },
			},
			{
				trace_id: traceId1,
				span_id: toolRes,
				parent_span_id: toolCall,
				request_id: requestId,
				round_id: 1,
				type: "tool_result",
				actor: "tool:web_search",
				ts_start: baseTs + 45,
				ts_end: baseTs + 135,
				status: "ok",
				payload: {
					tool_call_id: "tc_success_1",
					result_summary: "3 docs returned",
					success: true,
				},
				metrics: { latency_ms: 90 },
				tags: { project_path: "D:/codes/xh/better-ccflare" },
			},
			{
				trace_id: traceId1,
				span_id: llmRes,
				parent_span_id: toolRes,
				request_id: requestId,
				round_id: 1,
				type: "llm_response",
				actor: "model:claude",
				ts_start: baseTs + 140,
				ts_end: baseTs + 250,
				status: "ok",
				payload: { completion: "Updated dependency list." },
				metrics: {
					completion_tokens: 200,
					total_tokens: 620,
					latency_ms: 110,
					cost_estimate: 0.0096,
				},
				tags: { project_path: "D:/codes/xh/better-ccflare" },
			},
		);
	}

	{
		const start = baseTs + 2000;
		const requestId = reqId("2");
		const user = spanId();
		const llmReq = spanId();
		const toolCall = spanId();
		const toolRes = spanId();
		const err = spanId();
		traces.push(
			{
				trace_id: traceId2,
				span_id: user,
				type: "user_input",
				actor: "user",
				ts_start: start,
				ts_end: start + 8,
				status: "ok",
				payload: { prompt: "Read remote file and summarize errors." },
				tags: { project_path: "D:/codes/xh/better-ccflare" },
			},
			{
				trace_id: traceId2,
				span_id: llmReq,
				parent_span_id: user,
				request_id: requestId,
				round_id: 1,
				type: "llm_request",
				actor: "model:claude",
				ts_start: start + 12,
				ts_end: start + 30,
				status: "ok",
				payload: { model: "claude-3-7-sonnet", turn: 1 },
				metrics: { prompt_tokens: 360, total_tokens: 360 },
				tags: { project_path: "D:/codes/xh/better-ccflare" },
			},
			{
				trace_id: traceId2,
				span_id: toolCall,
				parent_span_id: llmReq,
				request_id: requestId,
				round_id: 1,
				type: "tool_call",
				actor: "tool:read_remote_file",
				ts_start: start + 36,
				ts_end: start + 42,
				status: "ok",
				payload: { tool_call_id: "tc_failure_1", tool_name: "read_remote_file" },
				tags: { project_path: "D:/codes/xh/better-ccflare" },
			},
			{
				trace_id: traceId2,
				span_id: toolRes,
				parent_span_id: toolCall,
				request_id: requestId,
				round_id: 1,
				type: "tool_result",
				actor: "tool:read_remote_file",
				ts_start: start + 42,
				ts_end: start + 150,
				status: "error",
				payload: {
					tool_call_id: "tc_failure_1",
					failure_reason: "ETIMEDOUT",
					success: false,
				},
				metrics: { latency_ms: 108 },
				tags: { project_path: "D:/codes/xh/better-ccflare" },
			},
			{
				trace_id: traceId2,
				span_id: err,
				parent_span_id: toolRes,
				request_id: requestId,
				round_id: 1,
				type: "error",
				actor: "orchestrator",
				ts_start: start + 155,
				ts_end: start + 170,
				status: "error",
				payload: {
					error_type: "tool_timeout",
					message: "remote fetch timeout after 108ms",
				},
				tags: { project_path: "D:/codes/xh/better-ccflare" },
			},
		);
	}

	{
		const start = baseTs + 4000;
		const requestId = reqId("3");
		const user = spanId();
		const llmReq = spanId();
		const llmRes = spanId();
		traces.push(
			{
				trace_id: traceId3,
				span_id: user,
				type: "user_input",
				actor: "user",
				ts_start: start,
				ts_end: start + 6,
				status: "ok",
				payload: { prompt: "Explain this SQL query plan." },
				tags: { project_path: "D:/codes/xh/sql-notes" },
			},
			{
				trace_id: traceId3,
				span_id: llmReq,
				parent_span_id: user,
				request_id: requestId,
				round_id: 1,
				type: "llm_request",
				actor: "model:claude",
				ts_start: start + 10,
				ts_end: start + 20,
				status: "ok",
				payload: { model: "claude-3-5-haiku", turn: 1 },
				metrics: { prompt_tokens: 180, total_tokens: 180 },
				tags: { project_path: "D:/codes/xh/sql-notes" },
			},
			{
				trace_id: traceId3,
				span_id: llmRes,
				parent_span_id: llmReq,
				request_id: requestId,
				round_id: 1,
				type: "llm_response",
				actor: "model:claude",
				ts_start: start + 22,
				ts_end: start + 102,
				status: "ok",
				payload: { completion: "The planner prefers index seek because..." },
				metrics: {
					completion_tokens: 120,
					total_tokens: 300,
					latency_ms: 80,
					cost_estimate: 0.0022,
				},
				tags: { project_path: "D:/codes/xh/sql-notes" },
			},
		);
	}

	{
		const start = baseTs + 6000;
		const requestId = reqId("4");
		const user = spanId();
		const llmReq = spanId();
		const call1 = spanId();
		const res1 = spanId();
		const call2 = spanId();
		const res2 = spanId();
		const llmRes = spanId();
		traces.push(
			{
				trace_id: traceId4,
				span_id: user,
				type: "user_input",
				actor: "user",
				ts_start: start,
				ts_end: start + 7,
				status: "ok",
				payload: { prompt: "Inspect project and run unit tests." },
				tags: { project_path: "D:/codes/xh/better-ccflare" },
			},
			{
				trace_id: traceId4,
				span_id: llmReq,
				parent_span_id: user,
				request_id: requestId,
				round_id: 1,
				type: "llm_request",
				actor: "model:claude",
				ts_start: start + 12,
				ts_end: start + 28,
				status: "ok",
				payload: { model: "claude-3-7-sonnet", turn: 1 },
				metrics: { prompt_tokens: 520, total_tokens: 520 },
				tags: { project_path: "D:/codes/xh/better-ccflare" },
			},
			{
				trace_id: traceId4,
				span_id: call1,
				parent_span_id: llmReq,
				request_id: requestId,
				round_id: 1,
				type: "tool_call",
				actor: "tool:list_files",
				ts_start: start + 33,
				ts_end: start + 36,
				status: "ok",
				payload: { tool_call_id: "tc_multi_1", tool_name: "list_files" },
				tags: { project_path: "D:/codes/xh/better-ccflare" },
			},
			{
				trace_id: traceId4,
				span_id: res1,
				parent_span_id: call1,
				request_id: requestId,
				round_id: 1,
				type: "tool_result",
				actor: "tool:list_files",
				ts_start: start + 36,
				ts_end: start + 82,
				status: "ok",
				payload: { tool_call_id: "tc_multi_1", success: true, count: 124 },
				metrics: { latency_ms: 46 },
				tags: { project_path: "D:/codes/xh/better-ccflare" },
			},
			{
				trace_id: traceId4,
				span_id: call2,
				parent_span_id: res1,
				request_id: requestId,
				round_id: 2,
				type: "tool_call",
				actor: "tool:run_tests",
				ts_start: start + 86,
				ts_end: start + 90,
				status: "ok",
				payload: { tool_call_id: "tc_multi_2", tool_name: "run_tests" },
				tags: { project_path: "D:/codes/xh/better-ccflare" },
			},
			{
				trace_id: traceId4,
				span_id: res2,
				parent_span_id: call2,
				request_id: requestId,
				round_id: 2,
				type: "tool_result",
				actor: "tool:run_tests",
				ts_start: start + 90,
				ts_end: start + 280,
				status: "ok",
				payload: { tool_call_id: "tc_multi_2", success: true, failed: 0 },
				metrics: { latency_ms: 190 },
				tags: { project_path: "D:/codes/xh/better-ccflare" },
			},
			{
				trace_id: traceId4,
				span_id: llmRes,
				parent_span_id: res2,
				request_id: requestId,
				round_id: 2,
				type: "llm_response",
				actor: "model:claude",
				ts_start: start + 286,
				ts_end: start + 390,
				status: "ok",
				payload: { completion: "All tests passed. No regressions found." },
				metrics: {
					completion_tokens: 160,
					total_tokens: 680,
					latency_ms: 104,
					cost_estimate: 0.0112,
				},
				tags: { project_path: "D:/codes/xh/better-ccflare" },
			},
		);
	}

	{
		const start = baseTs + 8000;
		const requestId = reqId("5");
		const user = spanId();
		const llmReq = spanId();
		const callErr = spanId();
		const resErr = spanId();
		const callOk = spanId();
		const resOk = spanId();
		const llmRes = spanId();
		traces.push(
			{
				trace_id: traceId5,
				span_id: user,
				type: "user_input",
				actor: "user",
				ts_start: start,
				ts_end: start + 8,
				status: "ok",
				payload: { prompt: "Fetch changelog and summarize security fixes." },
				tags: { project_path: "D:/codes/xh/better-ccflare" },
			},
			{
				trace_id: traceId5,
				span_id: llmReq,
				parent_span_id: user,
				request_id: requestId,
				round_id: 1,
				type: "llm_request",
				actor: "model:claude",
				ts_start: start + 12,
				ts_end: start + 22,
				status: "ok",
				payload: { model: "claude-3-7-sonnet", turn: 1 },
				metrics: { prompt_tokens: 410, total_tokens: 410 },
				tags: { project_path: "D:/codes/xh/better-ccflare" },
			},
			{
				trace_id: traceId5,
				span_id: callErr,
				parent_span_id: llmReq,
				request_id: requestId,
				round_id: 1,
				type: "tool_call",
				actor: "tool:http_get",
				ts_start: start + 28,
				ts_end: start + 30,
				status: "ok",
				payload: { tool_call_id: "tc_retry_1", tool_name: "http_get" },
				tags: { project_path: "D:/codes/xh/better-ccflare" },
			},
			{
				trace_id: traceId5,
				span_id: resErr,
				parent_span_id: callErr,
				request_id: requestId,
				round_id: 1,
				type: "tool_result",
				actor: "tool:http_get",
				ts_start: start + 30,
				ts_end: start + 120,
				status: "error",
				payload: {
					tool_call_id: "tc_retry_1",
					success: false,
					failure_reason: "HTTP 503",
					retry_count: 1,
				},
				metrics: { latency_ms: 90 },
				tags: { project_path: "D:/codes/xh/better-ccflare" },
			},
			{
				trace_id: traceId5,
				span_id: callOk,
				parent_span_id: resErr,
				request_id: requestId,
				round_id: 2,
				type: "tool_call",
				actor: "tool:http_get",
				ts_start: start + 128,
				ts_end: start + 132,
				status: "ok",
				payload: { tool_call_id: "tc_retry_2", tool_name: "http_get" },
				tags: { project_path: "D:/codes/xh/better-ccflare" },
			},
			{
				trace_id: traceId5,
				span_id: resOk,
				parent_span_id: callOk,
				request_id: requestId,
				round_id: 2,
				type: "tool_result",
				actor: "tool:http_get",
				ts_start: start + 132,
				ts_end: start + 215,
				status: "ok",
				payload: {
					tool_call_id: "tc_retry_2",
					success: true,
					result_summary: "200 OK",
				},
				metrics: { latency_ms: 83 },
				tags: { project_path: "D:/codes/xh/better-ccflare" },
			},
			{
				trace_id: traceId5,
				span_id: llmRes,
				parent_span_id: resOk,
				request_id: requestId,
				round_id: 2,
				type: "llm_response",
				actor: "model:claude",
				ts_start: start + 220,
				ts_end: start + 318,
				status: "ok",
				payload: { completion: "Security fixes include token redaction and CSP hardening." },
				metrics: {
					completion_tokens: 145,
					total_tokens: 555,
					latency_ms: 98,
					cost_estimate: 0.0081,
				},
				tags: { project_path: "D:/codes/xh/better-ccflare" },
			},
		);
	}

	return traces;
}

function main() {
	const options = parseArgs();
	if (options.help) {
		console.log(`
Usage:
  bun scripts/seed/seed-demo-trace.ts [--db-path <path>] [--prefix <trace-prefix>]

Creates 5 demo traces with:
  - successful tool call chains
  - failed tool call chains
  - multi-round traces
		`.trim());
		return;
	}

	const baseTs = Date.now();
	const events = buildDemoTraceEvents(options.prefix, baseTs);
	const dbOps = new DatabaseOperations(options.dbPath, undefined, undefined, true);

	try {
		dbOps.saveTraceEvents(events);
		const traceIds = Array.from(new Set(events.map((event) => event.trace_id)));
		console.log(`Seeded ${traceIds.length} demo traces and ${events.length} events.`);
		console.log(`Database: ${options.dbPath}`);
		for (const traceId of traceIds) {
			console.log(`- ${traceId}`);
		}
	} finally {
		dbOps.close();
	}
}

if (import.meta.main) {
	main();
}

