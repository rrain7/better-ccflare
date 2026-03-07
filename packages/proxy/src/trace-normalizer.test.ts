import { describe, expect, it } from "bun:test";
import {
	buildTraceStartEvents,
	getTraceStartSpanIds,
} from "./trace-normalizer";
import type { StartMessage } from "./worker-messages";

function createStartMessage(
	overrides: Partial<StartMessage> = {},
): StartMessage {
	return {
		type: "start",
		requestId: "req_trace_start_1",
		accountId: "acc_1",
		method: "POST",
		path: "/v1/messages",
		timestamp: 1740816000000,
		requestHeaders: {
			"x-better-ccflare-project-path": "D:/codes/demo-app",
		},
		requestBody: Buffer.from(
			JSON.stringify({
				model: "claude-sonnet-4-6",
				tool_choice: { type: "auto" },
				messages: [
					{ role: "system", content: "system prompt" },
					{ role: "user", content: "open AGENTS.md and inspect traces" },
				],
				tools: [{ name: "read_file", input_schema: { type: "object" } }],
			}),
		).toString("base64"),
		responseStatus: 200,
		responseHeaders: {},
		isStream: true,
		providerName: "anthropic",
		agentUsed: "codex",
		apiKeyId: null,
		apiKeyName: null,
		retryAttempt: 0,
		failoverAttempts: 0,
		...overrides,
	};
}

describe("buildTraceStartEvents", () => {
	it("creates deterministic user_input and orchestration events", () => {
		const startMessage = createStartMessage();
		const spanIds = getTraceStartSpanIds(startMessage.requestId);
		const result = buildTraceStartEvents(startMessage, "sp_prev_round");

		expect(result.traceId.startsWith("tr_")).toBe(true);
		expect(result.events).toHaveLength(2);

		expect(result.events[0].span_id).toBe(spanIds.userInputSpanId);
		expect(result.events[0].type).toBe("user_input");
		expect(result.events[0].parent_span_id).toBe("sp_prev_round");
		expect(result.events[0].payload.content_preview).toBe(
			"open AGENTS.md and inspect traces",
		);

		expect(result.events[1].span_id).toBe(spanIds.orchestrationSpanId);
		expect(result.events[1].type).toBe("orchestration_decision");
		expect(result.events[1].parent_span_id).toBe(spanIds.userInputSpanId);
		expect(result.events[1].payload.model).toBe("claude-sonnet-4-6");
		expect(result.events[1].payload.project_path).toBe("D:/codes/demo-app");
		expect(result.events[1].payload.agent_used).toBe("codex");
	});
});
