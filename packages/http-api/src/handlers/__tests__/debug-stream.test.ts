import { afterEach, describe, expect, it } from "bun:test";
import { debugEvents } from "@better-ccflare/core";
import type { TraceEvent } from "@better-ccflare/types";
import { createDebugStreamHandler } from "../debug-stream";

const decoder = new TextDecoder();

afterEach(() => {
	debugEvents.removeAllListeners("event");
});

describe("debug stream handler", () => {
	it("streams connected message and debug trace events", async () => {
		const handler = createDebugStreamHandler();
		const response = handler(new Request("http://localhost/api/debug/stream"));
		const reader = response.body?.getReader();

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("text/event-stream");
		expect(reader).toBeDefined();

		const firstChunk = await reader?.read();
		expect(decoder.decode(firstChunk.value)).toContain("event: connected");

		const traceEvent: TraceEvent = {
			trace_id: "tr_live_1",
			span_id: "sp_live_1",
			type: "tool_call",
			actor: "tool:bash",
			ts_start: 1000,
			ts_end: 1000,
			status: "ok",
			payload: {
				tool_name: "bash",
			},
		};

		debugEvents.emit("event", {
			type: "trace_events",
			requestId: "req_live_1",
			traceId: "tr_live_1",
			events: [traceEvent],
			source: "native_tool_logging",
		});

		const eventChunk = await reader?.read();
		const message = decoder.decode(eventChunk.value);
		expect(message).toContain('"type":"trace_events"');
		expect(message).toContain('"requestId":"req_live_1"');
		expect(message).toContain('"traceId":"tr_live_1"');

		await reader?.cancel();
	});
});
