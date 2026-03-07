#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { ensureSchema, resolveDbPath, runMigrations } from "@better-ccflare/database";
import type { TraceEvent } from "@better-ccflare/types";

interface Options {
	dbPath: string;
	prefix: string;
	purgeOnly: boolean;
	help: boolean;
}

interface DemoRequestSeed {
	requestId: string;
	traceId: string;
	timestamp: number;
	method: string;
	path: string;
	statusCode: number;
	success: boolean;
	errorMessage: string | null;
	responseTimeMs: number;
	failoverAttempts: number;
	model: string;
	agentUsed: string;
	projectPath: string;
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	costUsd: number;
	inputTokens: number;
	outputTokens: number;
	tokensPerSecond: number;
	requestHeaders: Record<string, string>;
	responseHeaders: Record<string, string>;
	requestBody: Record<string, unknown>;
	responseBody: Record<string, unknown>;
	traceEvents: TraceEvent[];
}

function parseArgs(): Options {
	const args = process.argv.slice(2);
	const options: Options = {
		dbPath: resolveDbPath(),
		prefix: "demo_debug_panel",
		purgeOnly: false,
		help: false,
	};

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--help" || arg === "-h") {
			options.help = true;
			return options;
		}
		if (arg === "--db-path" && args[index + 1]) {
			options.dbPath = args[index + 1];
			index += 1;
			continue;
		}
		if (arg === "--prefix" && args[index + 1]) {
			options.prefix = args[index + 1];
			index += 1;
			continue;
		}
		if (arg === "--purge-only") {
			options.purgeOnly = true;
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}

	return options;
}

function toBase64Json(value: unknown): string {
	return Buffer.from(JSON.stringify(value), "utf-8").toString("base64");
}

function span(traceKey: string, name: string): string {
	return `sp_${traceKey}_${name}`.replace(/[^a-zA-Z0-9_]/g, "_");
}

function buildRequestPayload(seed: DemoRequestSeed): string {
	return JSON.stringify({
		request: {
			headers: seed.requestHeaders,
			body: toBase64Json(seed.requestBody),
		},
		response: {
			status: seed.statusCode,
			headers: seed.responseHeaders,
			body: toBase64Json(seed.responseBody),
		},
		meta: {
			timestamp: seed.timestamp,
			success: seed.success,
			path: seed.path,
			method: seed.method,
			agentUsed: seed.agentUsed,
			retry: 0,
		},
	});
}

function buildSeeds(prefix: string, now: number): DemoRequestSeed[] {
	const requestA = `${prefix}_req_repo_audit`;
	const traceA = `tr_${prefix}_repo_audit`;
	const requestB = `${prefix}_req_tool_timeout`;
	const traceB = `tr_${prefix}_tool_timeout`;
	const requestC = `${prefix}_req_llm_only`;
	const traceC = `tr_${prefix}_llm_only`;
	const requestD = `${prefix}_req_recovery`;
	const traceD = `tr_${prefix}_recovery`;

	const projectMain = "D:/codes/xh/better-ccflare";
	const projectDocs = "D:/codes/xh/sql-notes";

	return [
		{
			requestId: requestA,
			traceId: traceA,
			timestamp: now - 45_000,
			method: "POST",
			path: "/v1/messages",
			statusCode: 200,
			success: true,
			errorMessage: null,
			responseTimeMs: 1820,
			failoverAttempts: 0,
			model: "claude-sonnet-4-6",
			agentUsed: "codex",
			projectPath: projectMain,
			promptTokens: 1240,
			completionTokens: 486,
			totalTokens: 1726,
			costUsd: 0.0264,
			inputTokens: 1240,
			outputTokens: 486,
			tokensPerSecond: 42.6,
			requestHeaders: {
				"content-type": "application/json",
				"x-request-id": requestA,
				"x-better-ccflare-project-path": projectMain,
			},
			responseHeaders: {
				"content-type": "application/json",
				"x-trace-id": traceA,
			},
			requestBody: {
				model: "claude-sonnet-4-6",
				system:
					"You are a coding agent. Inspect the project and verify the debug panel pipeline.",
				messages: [
					{
						role: "user",
						content: [
							{
								type: "text",
								text: "Audit the new debug panel trace flow and verify the latest changes.",
							},
						],
					},
				],
				tools: [
					{
						name: "read_file",
						input_schema: { type: "object", properties: { path: { type: "string" } } },
					},
					{
						name: "run_tests",
						input_schema: {
							type: "object",
							properties: { command: { type: "string" }, cwd: { type: "string" } },
						},
					},
				],
			},
			responseBody: {
				content: [
					{
						type: "thinking",
						thinking:
							"Need to inspect the proxy trace pipeline, then validate the SSE handler and dashboard panel.",
					},
					{
						type: "tool_use",
						id: "tool_repo_read",
						name: "read_file",
						input: { path: "packages/proxy/src/response-handler.ts" },
					},
					{
						type: "tool_use",
						id: "tool_repo_tests",
						name: "run_tests",
						input: {
							command:
								"bun test packages/http-api/src/handlers/__tests__/debug-stream.test.ts",
							cwd: "D:/codes/xh/better-ccflare",
						},
					},
					{
						type: "text",
						text: "I verified the new debug panel live trace path. The SSE stream, request lookup, and persisted trace chain are consistent.",
					},
				],
			},
			traceEvents: [
				{
					trace_id: traceA,
					span_id: span(traceA, "user"),
					request_id: requestA,
					type: "user_input",
					actor: "user",
					ts_start: now - 45_000,
					ts_end: now - 44_995,
					status: "ok",
					payload: {
						content_preview:
							"Audit the new debug panel trace flow and verify the latest changes.",
					},
					tags: { project_path: projectMain },
				},
				{
					trace_id: traceA,
					span_id: span(traceA, "orch"),
					parent_span_id: span(traceA, "user"),
					request_id: requestA,
					type: "orchestration_decision",
					actor: "orchestrator",
					ts_start: now - 44_990,
					ts_end: now - 44_990,
					status: "ok",
					payload: {
						model: "claude-sonnet-4-6",
						tool_choice: "auto",
						agent_used: "codex",
					},
					tags: { project_path: projectMain },
				},
				{
					trace_id: traceA,
					span_id: span(traceA, "llm_req"),
					parent_span_id: span(traceA, "orch"),
					request_id: requestA,
					round_id: 1,
					type: "llm_request",
					actor: "model:claude-sonnet-4-6",
					ts_start: now - 44_985,
					ts_end: now - 44_985,
					status: "ok",
					payload: {
						model: "claude-sonnet-4-6",
						request_excerpt:
							"Audit the new debug panel trace flow and verify the latest changes.",
					},
					tags: { project_path: projectMain, provider: "anthropic" },
				},
				{
					trace_id: traceA,
					span_id: span(traceA, "tool_read"),
					parent_span_id: span(traceA, "llm_req"),
					request_id: requestA,
					round_id: 1,
					type: "tool_call",
					actor: "tool:read_file",
					ts_start: now - 44_970,
					ts_end: now - 44_968,
					status: "ok",
					payload: {
						tool_call_id: "tool_repo_read",
						tool_name: "read_file",
						arguments_preview:
							'{"path":"packages/proxy/src/response-handler.ts"}',
					},
					tags: { project_path: projectMain },
				},
				{
					trace_id: traceA,
					span_id: span(traceA, "tool_read_result"),
					parent_span_id: span(traceA, "tool_read"),
					request_id: requestA,
					round_id: 1,
					type: "tool_result",
					actor: "tool:read_file",
					ts_start: now - 44_968,
					ts_end: now - 44_920,
					status: "ok",
					payload: {
						tool_call_id: "tool_repo_read",
						success: true,
						result_preview:
							"forwardToClient emits request start events and sends worker start messages.",
					},
					metrics: { latency_ms: 48 },
					tags: { project_path: projectMain },
				},
				{
					trace_id: traceA,
					span_id: span(traceA, "tool_test"),
					parent_span_id: span(traceA, "tool_read_result"),
					request_id: requestA,
					round_id: 2,
					type: "tool_call",
					actor: "tool:run_tests",
					ts_start: now - 44_910,
					ts_end: now - 44_907,
					status: "ok",
					payload: {
						tool_call_id: "tool_repo_tests",
						tool_name: "run_tests",
						arguments_preview:
							'{"command":"bun test packages/http-api/src/handlers/__tests__/debug-stream.test.ts","cwd":"D:/codes/xh/better-ccflare"}',
					},
					tags: { project_path: projectMain },
				},
				{
					trace_id: traceA,
					span_id: span(traceA, "tool_test_result"),
					parent_span_id: span(traceA, "tool_test"),
					request_id: requestA,
					round_id: 2,
					type: "tool_result",
					actor: "tool:run_tests",
					ts_start: now - 44_907,
					ts_end: now - 44_790,
					status: "ok",
					payload: {
						tool_call_id: "tool_repo_tests",
						success: true,
						result_preview: "debug-stream.test.ts: 1 pass, 0 fail",
					},
					metrics: { latency_ms: 117 },
					tags: { project_path: projectMain },
				},
				{
					trace_id: traceA,
					span_id: span(traceA, "llm_res"),
					parent_span_id: span(traceA, "tool_test_result"),
					request_id: requestA,
					round_id: 2,
					type: "llm_response",
					actor: "model:claude-sonnet-4-6",
					ts_start: now - 44_780,
					ts_end: now - 43_180,
					status: "ok",
					payload: {
						assistant_content_preview:
							"I verified the new debug panel live trace path. The SSE stream, request lookup, and persisted trace chain are consistent.",
					},
					metrics: {
						latency_ms: 1600,
						prompt_tokens: 1240,
						completion_tokens: 486,
						total_tokens: 1726,
						cost_estimate: 0.0264,
					},
					tags: { project_path: projectMain, provider: "anthropic" },
				},
			],
		},
		{
			requestId: requestB,
			traceId: traceB,
			timestamp: now - 30_000,
			method: "POST",
			path: "/v1/messages",
			statusCode: 500,
			success: false,
			errorMessage: "remote fetch timeout after 108ms",
			responseTimeMs: 960,
			failoverAttempts: 0,
			model: "claude-sonnet-4-6",
			agentUsed: "codex",
			projectPath: projectMain,
			promptTokens: 820,
			completionTokens: 82,
			totalTokens: 902,
			costUsd: 0.0117,
			inputTokens: 820,
			outputTokens: 82,
			tokensPerSecond: 12.3,
			requestHeaders: {
				"content-type": "application/json",
				"x-request-id": requestB,
				"x-better-ccflare-project-path": projectMain,
			},
			responseHeaders: {
				"content-type": "application/json",
			},
			requestBody: {
				model: "claude-sonnet-4-6",
				messages: [
					{
						role: "user",
						content: [
							{
								type: "text",
								text: "Fetch the latest remote error log and summarize the root cause.",
							},
						],
					},
				],
				tools: [
					{
						name: "read_remote_file",
						input_schema: { type: "object", properties: { url: { type: "string" } } },
					},
				],
			},
			responseBody: {
				type: "error",
				error: {
					type: "tool_timeout",
					message: "remote fetch timeout after 108ms",
				},
			},
			traceEvents: [
				{
					trace_id: traceB,
					span_id: span(traceB, "user"),
					request_id: requestB,
					type: "user_input",
					actor: "user",
					ts_start: now - 30_000,
					ts_end: now - 29_996,
					status: "ok",
					payload: {
						content_preview:
							"Fetch the latest remote error log and summarize the root cause.",
					},
					tags: { project_path: projectMain },
				},
				{
					trace_id: traceB,
					span_id: span(traceB, "orch"),
					parent_span_id: span(traceB, "user"),
					request_id: requestB,
					type: "orchestration_decision",
					actor: "orchestrator",
					ts_start: now - 29_992,
					ts_end: now - 29_992,
					status: "ok",
					payload: {
						model: "claude-sonnet-4-6",
						tool_choice: "auto",
					},
					tags: { project_path: projectMain },
				},
				{
					trace_id: traceB,
					span_id: span(traceB, "llm_req"),
					parent_span_id: span(traceB, "orch"),
					request_id: requestB,
					round_id: 1,
					type: "llm_request",
					actor: "model:claude-sonnet-4-6",
					ts_start: now - 29_988,
					ts_end: now - 29_988,
					status: "error",
					payload: {
						model: "claude-sonnet-4-6",
						request_excerpt:
							"Fetch the latest remote error log and summarize the root cause.",
					},
					tags: { project_path: projectMain, provider: "anthropic" },
				},
				{
					trace_id: traceB,
					span_id: span(traceB, "tool_call"),
					parent_span_id: span(traceB, "llm_req"),
					request_id: requestB,
					round_id: 1,
					type: "tool_call",
					actor: "tool:read_remote_file",
					ts_start: now - 29_970,
					ts_end: now - 29_969,
					status: "ok",
					payload: {
						tool_call_id: "tool_timeout_read",
						tool_name: "read_remote_file",
						arguments_preview:
							'{"url":"https://example.com/logs/error.log"}',
					},
					tags: { project_path: projectMain },
				},
				{
					trace_id: traceB,
					span_id: span(traceB, "tool_result"),
					parent_span_id: span(traceB, "tool_call"),
					request_id: requestB,
					round_id: 1,
					type: "tool_result",
					actor: "tool:read_remote_file",
					ts_start: now - 29_969,
					ts_end: now - 29_861,
					status: "error",
					payload: {
						tool_call_id: "tool_timeout_read",
						success: false,
						failure_reason: "ETIMEDOUT",
						result_preview:
							"request timed out after 108ms while fetching remote file",
					},
					metrics: { latency_ms: 108 },
					tags: { project_path: projectMain },
				},
				{
					trace_id: traceB,
					span_id: span(traceB, "error"),
					parent_span_id: span(traceB, "tool_result"),
					request_id: requestB,
					round_id: 1,
					type: "error",
					actor: "orchestrator",
					ts_start: now - 29_858,
					ts_end: now - 29_040,
					status: "error",
					payload: {
						error_type: "tool_timeout",
						message: "remote fetch timeout after 108ms",
					},
					tags: { project_path: projectMain },
				},
			],
		},
		{
			requestId: requestC,
			traceId: traceC,
			timestamp: now - 15_000,
			method: "POST",
			path: "/v1/messages",
			statusCode: 200,
			success: true,
			errorMessage: null,
			responseTimeMs: 420,
			failoverAttempts: 0,
			model: "claude-3-5-haiku",
			agentUsed: "claude-code",
			projectPath: projectDocs,
			promptTokens: 220,
			completionTokens: 138,
			totalTokens: 358,
			costUsd: 0.0028,
			inputTokens: 220,
			outputTokens: 138,
			tokensPerSecond: 31.1,
			requestHeaders: {
				"content-type": "application/json",
				"x-request-id": requestC,
				"x-better-ccflare-project-path": projectDocs,
			},
			responseHeaders: {
				"content-type": "application/json",
			},
			requestBody: {
				model: "claude-3-5-haiku",
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: "Explain this SQL query plan in plain English." }],
					},
				],
			},
			responseBody: {
				content: [
					{
						type: "text",
						text: "The planner chooses an index seek because the filter is selective and the index already covers the requested columns.",
					},
				],
			},
			traceEvents: [
				{
					trace_id: traceC,
					span_id: span(traceC, "user"),
					request_id: requestC,
					type: "user_input",
					actor: "user",
					ts_start: now - 15_000,
					ts_end: now - 14_997,
					status: "ok",
					payload: {
						content_preview: "Explain this SQL query plan in plain English.",
					},
					tags: { project_path: projectDocs },
				},
				{
					trace_id: traceC,
					span_id: span(traceC, "llm_req"),
					parent_span_id: span(traceC, "user"),
					request_id: requestC,
					round_id: 1,
					type: "llm_request",
					actor: "model:claude-3-5-haiku",
					ts_start: now - 14_994,
					ts_end: now - 14_994,
					status: "ok",
					payload: {
						model: "claude-3-5-haiku",
						request_excerpt: "Explain this SQL query plan in plain English.",
					},
					tags: { project_path: projectDocs, provider: "anthropic" },
				},
				{
					trace_id: traceC,
					span_id: span(traceC, "llm_res"),
					parent_span_id: span(traceC, "llm_req"),
					request_id: requestC,
					round_id: 1,
					type: "llm_response",
					actor: "model:claude-3-5-haiku",
					ts_start: now - 14_992,
					ts_end: now - 14_580,
					status: "ok",
					payload: {
						assistant_content_preview:
							"The planner chooses an index seek because the filter is selective and the index already covers the requested columns.",
					},
					metrics: {
						latency_ms: 412,
						prompt_tokens: 220,
						completion_tokens: 138,
						total_tokens: 358,
						cost_estimate: 0.0028,
					},
					tags: { project_path: projectDocs, provider: "anthropic" },
				},
			],
		},
		{
			requestId: requestD,
			traceId: traceD,
			timestamp: now - 5_000,
			method: "POST",
			path: "/v1/messages",
			statusCode: 200,
			success: true,
			errorMessage: null,
			responseTimeMs: 1340,
			failoverAttempts: 1,
			model: "claude-sonnet-4-6",
			agentUsed: "codex",
			projectPath: projectMain,
			promptTokens: 960,
			completionTokens: 280,
			totalTokens: 1240,
			costUsd: 0.0182,
			inputTokens: 960,
			outputTokens: 280,
			tokensPerSecond: 24.4,
			requestHeaders: {
				"content-type": "application/json",
				"x-request-id": requestD,
				"x-better-ccflare-project-path": projectMain,
			},
			responseHeaders: {
				"content-type": "application/json",
			},
			requestBody: {
				model: "claude-sonnet-4-6",
				messages: [
					{
						role: "user",
						content: [
							{
								type: "text",
								text: "Fetch the changelog, recover from transient failures, and summarize security fixes.",
							},
						],
					},
					{
						role: "user",
						content: [
							{
								type: "tool_result",
								tool_use_id: "tool_retry_first",
								content: "HTTP 503 Service Unavailable",
							},
						],
					},
				],
				tools: [
					{
						name: "http_get",
						input_schema: { type: "object", properties: { url: { type: "string" } } },
					},
				],
			},
			responseBody: {
				content: [
					{
						type: "thinking",
						thinking:
							"The first fetch failed with a transient 503, so retrying the same endpoint should be sufficient.",
					},
					{
						type: "tool_use",
						id: "tool_retry_second",
						name: "http_get",
						input: { url: "https://example.com/changelog" },
					},
					{
						type: "text",
						text: "The changelog shows two security fixes: token redaction in logs and stricter dashboard CSP headers.",
					},
				],
			},
			traceEvents: [
				{
					trace_id: traceD,
					span_id: span(traceD, "user"),
					request_id: requestD,
					type: "user_input",
					actor: "user",
					ts_start: now - 5_000,
					ts_end: now - 4_997,
					status: "ok",
					payload: {
						content_preview:
							"Fetch the changelog, recover from transient failures, and summarize security fixes.",
					},
					tags: { project_path: projectMain },
				},
				{
					trace_id: traceD,
					span_id: span(traceD, "orch"),
					parent_span_id: span(traceD, "user"),
					request_id: requestD,
					type: "orchestration_decision",
					actor: "orchestrator",
					ts_start: now - 4_994,
					ts_end: now - 4_994,
					status: "ok",
					payload: {
						model: "claude-sonnet-4-6",
						failover_attempts: 1,
					},
					tags: { project_path: projectMain },
				},
				{
					trace_id: traceD,
					span_id: span(traceD, "retry_call"),
					parent_span_id: span(traceD, "orch"),
					request_id: requestD,
					round_id: 2,
					type: "tool_call",
					actor: "tool:http_get",
					ts_start: now - 4_980,
					ts_end: now - 4_978,
					status: "ok",
					payload: {
						tool_call_id: "tool_retry_second",
						tool_name: "http_get",
						arguments_preview:
							'{"url":"https://example.com/changelog"}',
					},
					tags: { project_path: projectMain },
				},
				{
					trace_id: traceD,
					span_id: span(traceD, "retry_result"),
					parent_span_id: span(traceD, "retry_call"),
					request_id: requestD,
					round_id: 2,
					type: "tool_result",
					actor: "tool:http_get",
					ts_start: now - 4_978,
					ts_end: now - 4_860,
					status: "ok",
					payload: {
						tool_call_id: "tool_retry_second",
						success: true,
						result_preview:
							"Fetched changelog entries for v1.4.0..v1.4.2 with 2 security fixes.",
					},
					metrics: { latency_ms: 118 },
					tags: { project_path: projectMain },
				},
				{
					trace_id: traceD,
					span_id: span(traceD, "llm_res"),
					parent_span_id: span(traceD, "retry_result"),
					request_id: requestD,
					round_id: 2,
					type: "llm_response",
					actor: "model:claude-sonnet-4-6",
					ts_start: now - 4_850,
					ts_end: now - 3_660,
					status: "ok",
					payload: {
						assistant_content_preview:
							"The changelog shows two security fixes: token redaction in logs and stricter dashboard CSP headers.",
					},
					metrics: {
						latency_ms: 1190,
						prompt_tokens: 960,
						completion_tokens: 280,
						total_tokens: 1240,
						cost_estimate: 0.0182,
					},
					tags: { project_path: projectMain, provider: "anthropic" },
				},
			],
		},
	];
}

function purgeExisting(db: Database, prefix: string) {
	const requestLike = `${prefix}%`;
	const traceLike = `tr_${prefix}%`;
	const deletedTraceEvents = db
		.prepare(
			"DELETE FROM trace_events WHERE trace_id LIKE ? OR request_id LIKE ?",
		)
		.run(traceLike, requestLike).changes;
	const deletedPayloads = db
		.prepare("DELETE FROM request_payloads WHERE id LIKE ?")
		.run(requestLike).changes;
	const deletedRequests = db
		.prepare("DELETE FROM requests WHERE id LIKE ?")
		.run(requestLike).changes;

	return {
		deletedTraceEvents,
		deletedPayloads,
		deletedRequests,
	};
}

function insertSeeds(db: Database, seeds: DemoRequestSeed[]) {
	const insertRequest = db.prepare(`
		INSERT OR REPLACE INTO requests (
			id, timestamp, method, path, account_used,
			status_code, success, error_message, response_time_ms, failover_attempts,
			model, prompt_tokens, completion_tokens, total_tokens, cost_usd,
			input_tokens, cache_read_input_tokens, cache_creation_input_tokens, output_tokens,
			agent_used, output_tokens_per_second, api_key_id, api_key_name
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`);

	const insertPayload = db.prepare(`
		INSERT OR REPLACE INTO request_payloads (id, json)
		VALUES (?, ?)
	`);

	const insertTraceEvent = db.prepare(`
		INSERT OR REPLACE INTO trace_events (
			trace_id, span_id, parent_span_id, request_id, round_id, type, actor,
			ts_start, ts_end, status, payload_json, metrics_json, tags_json
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`);

	const run = db.transaction((items: DemoRequestSeed[]) => {
		for (const seed of items) {
			insertRequest.run(
				seed.requestId,
				seed.timestamp,
				seed.method,
				seed.path,
				null,
				seed.statusCode,
				seed.success ? 1 : 0,
				seed.errorMessage,
				seed.responseTimeMs,
				seed.failoverAttempts,
				seed.model,
				seed.promptTokens,
				seed.completionTokens,
				seed.totalTokens,
				seed.costUsd,
				seed.inputTokens,
				null,
				null,
				seed.outputTokens,
				seed.agentUsed,
				seed.tokensPerSecond,
				null,
				null,
			);

			insertPayload.run(seed.requestId, buildRequestPayload(seed));

			for (const event of seed.traceEvents) {
				insertTraceEvent.run(
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
		}
	});

	run(seeds);
}

function main() {
	const options = parseArgs();
	if (options.help) {
		console.log(
			[
				"Usage:",
				"  bun scripts/seed/seed-debug-panel-demo.ts [--db-path <path>] [--prefix <prefix>] [--purge-only]",
				"",
				"Seeds request rows, request payloads, and trace events tailored for the Debug Panel.",
				"Default prefix: demo_debug_panel",
			].join("\n"),
		);
		return;
	}

	const db = new Database(options.dbPath, { create: true });
	try {
		ensureSchema(db);
		runMigrations(db, options.dbPath);
		const purge = purgeExisting(db, options.prefix);

		if (options.purgeOnly) {
			console.log(
				[
					`Purged debug panel demo data from ${options.dbPath}`,
					`- requests: ${purge.deletedRequests}`,
					`- payloads: ${purge.deletedPayloads}`,
					`- trace events: ${purge.deletedTraceEvents}`,
				].join("\n"),
			);
			return;
		}

		const seeds = buildSeeds(options.prefix, Date.now());
		insertSeeds(db, seeds);

		console.log(
			[
				`Seeded debug panel demo data into ${options.dbPath}`,
				`- requests: ${seeds.length}`,
				`- payloads: ${seeds.length}`,
				`- trace events: ${seeds.reduce((sum, seed) => sum + seed.traceEvents.length, 0)}`,
				"",
				"Request IDs:",
				...seeds.map((seed) => `- ${seed.requestId}`),
				"",
				"Trace IDs:",
				...seeds.map((seed) => `- ${seed.traceId}`),
			].join("\n"),
		);
	} finally {
		db.close();
	}
}

if (import.meta.main) {
	main();
}
