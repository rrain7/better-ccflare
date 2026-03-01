import { describe, expect, it } from "bun:test";
import { parseToolLifecycleEventsFromBatch } from "./tool-event-logging";

describe("parseToolLifecycleEventsFromBatch", () => {
	it("extracts native tool_call/tool_result events with latency and retry metadata", () => {
		const parsed = parseToolLifecycleEventsFromBatch(
			{
				trace_id: "trace_native_1",
				events: [
					{
						event_name: "tool.execution.start",
						tool_call_id: "call_1",
						tool_name: "search",
						timestamp: 1740816000000,
					},
					{
						event_name: "tool.execution.result",
						tool_call_id: "call_1",
						tool_name: "search",
						timestamp: 1740816000123,
						duration_ms: 123,
						success: false,
						error_message: "tool timeout",
						retry_count: 2,
					},
				],
			},
			{},
			"req_1",
		);

		expect(parsed).toHaveLength(2);

		const call = parsed[0];
		expect(call.kind).toBe("tool_call");
		expect(call.traceId).toBe("tr_trace_native_1");
		expect(call.toolCallId).toBe("call_1");
		expect(call.toolName).toBe("search");

		const result = parsed[1];
		expect(result.kind).toBe("tool_result");
		expect(result.traceId).toBe("tr_trace_native_1");
		expect(result.latencyMs).toBe(123);
		expect(result.success).toBe(false);
		expect(result.failureReason).toBe("tool timeout");
		expect(result.retryCount).toBe(2);
	});

	it("uses session id as trace when explicit trace_id is absent", () => {
		const parsed = parseToolLifecycleEventsFromBatch(
			{
				events: [
					{
						event_name: "tool.execution.start",
						tool_call_id: "call_2",
						tool_name: "read_file",
						timestamp: 1740816000200,
					},
				],
			},
			{
				"x-claude-session-id": "session_abc",
			},
			"req_2",
		);

		expect(parsed).toHaveLength(1);
		expect(parsed[0].traceId).toBe("tr_session_abc");
	});
});
