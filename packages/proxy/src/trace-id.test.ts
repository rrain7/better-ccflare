import { describe, expect, it } from "bun:test";
import { resolveTraceIdentity } from "./trace-id";

describe("resolveTraceIdentity", () => {
	it("prefers explicit trace header over everything else", () => {
		const resolved = resolveTraceIdentity(
			{
				requestHeaders: {
					"x-better-ccflare-trace-id": "trace-explicit",
					"x-session-id": "sess-1",
					"x-request-id": "req-scope-1",
				},
				requestId: "fallback-req-id",
			},
			{
				trace_id: "trace-from-body",
				session_id: "sess-body",
			},
			JSON.stringify({ messages: [] }),
		);

		expect(resolved.source).toBe("explicit_trace_id");
		expect(resolved.traceId).toBe("tr_trace-explicit");
	});

	it("uses explicit trace field in body when header not provided", () => {
		const resolved = resolveTraceIdentity(
			{
				requestHeaders: {
					"x-session-id": "sess-1",
				},
				requestId: "fallback-req-id",
			},
			{
				trace_id: "trace-body",
				conversation_id: "conv-body",
			},
			null,
		);

		expect(resolved.source).toBe("explicit_trace_id");
		expect(resolved.traceId).toBe("tr_trace-body");
	});

	it("uses session/conversation identifiers before request-scoped headers", () => {
		const resolved = resolveTraceIdentity(
			{
				requestHeaders: {
					"x-conversation-id": "conversation-xyz",
					"x-request-id": "request-only",
				},
				requestId: "fallback-req-id",
			},
			null,
			null,
		);

		expect(resolved.source).toBe("session_or_conversation");
		expect(resolved.traceId).toBe("tr_conversation-xyz");
	});

	it("uses x-request-id only as request-scoped fallback", () => {
		const resolved = resolveTraceIdentity(
			{
				requestHeaders: {
					"x-request-id": "request-abc",
				},
				requestId: "fallback-req-id",
			},
			null,
			null,
		);

		expect(resolved.source).toBe("request_scoped");
		expect(resolved.traceId).toBe("tr_request-abc");
	});

	it("falls back to content fingerprint when no ids are present", () => {
		const body = {
			model: "claude-test",
			messages: [
				{ role: "system", content: "sys prompt" },
				{ role: "user", content: "hello" },
			],
		};

		const resolvedA = resolveTraceIdentity(
			{
				requestHeaders: {},
				requestId: "fallback-1",
			},
			body,
			JSON.stringify(body),
		);
		const resolvedB = resolveTraceIdentity(
			{
				requestHeaders: {},
				requestId: "fallback-2",
			},
			body,
			JSON.stringify(body),
		);

		expect(resolvedA.source).toBe("content_fingerprint");
		expect(resolvedA.traceId).toBe(resolvedB.traceId);
		expect(resolvedA.traceId.startsWith("tr_")).toBe(true);
	});

	it("uses request id as final fallback when body is empty", () => {
		const resolved = resolveTraceIdentity(
			{
				requestHeaders: {},
				requestId: "req-final-1",
			},
			null,
			null,
		);

		expect(resolved.source).toBe("request_id_fallback");
		expect(resolved.traceId).toBe("tr_req-final-1");
	});
});
