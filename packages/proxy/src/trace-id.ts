import { createHash } from "node:crypto";
import type { StartMessage } from "./worker-messages";

export interface TraceIdResolutionResult {
	traceId: string;
	source:
		| "explicit_trace_id"
		| "session_or_conversation"
		| "request_scoped"
		| "content_fingerprint"
		| "request_id_fallback";
}

interface RequestLikeBody {
	model?: string;
	messages?: Array<{
		role?: string;
		content?: unknown;
	}>;
}

function sanitizeId(raw: string): string {
	return raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}

function getHeader(
	headers: Record<string, string>,
	names: string[],
): string | null {
	const lowered = new Map<string, string>();
	for (const [key, value] of Object.entries(headers)) {
		lowered.set(key.toLowerCase(), value);
	}

	for (const name of names) {
		const value = lowered.get(name.toLowerCase());
		if (value && value.trim().length > 0) {
			return value.trim();
		}
	}
	return null;
}

function readNestedString(
	body: Record<string, unknown> | null,
	paths: string[],
): string | null {
	if (!body) return null;
	for (const path of paths) {
		const parts = path.split(".");
		let current: unknown = body;
		for (const part of parts) {
			if (!current || typeof current !== "object") {
				current = null;
				break;
			}
			current = (current as Record<string, unknown>)[part];
		}
		if (typeof current === "string" && current.trim().length > 0) {
			return current.trim();
		}
	}
	return null;
}

function extractConversationSeed(
	requestBody: RequestLikeBody | null,
	requestBodyText: string | null,
): string {
	if (!requestBody) {
		return requestBodyText || "";
	}

	const model = requestBody.model || "";
	const messages = requestBody.messages || [];
	const firstUser = messages.find((msg) => msg.role === "user");
	const firstSystem = messages.find((msg) => msg.role === "system");

	const userContent = firstUser?.content || "";
	const systemContent = firstSystem?.content || "";
	return `${model}\n${JSON.stringify(systemContent)}\n${JSON.stringify(userContent)}`;
}

export function resolveTraceIdentity(
	startMessage: Pick<StartMessage, "requestHeaders" | "requestId">,
	requestBody: Record<string, unknown> | null,
	requestBodyText: string | null,
): TraceIdResolutionResult {
	const explicitTraceHeader = getHeader(startMessage.requestHeaders, [
		"x-better-ccflare-trace-id",
		"x-trace-id",
		"x-traceid",
	]);
	if (explicitTraceHeader) {
		return {
			traceId: `tr_${sanitizeId(explicitTraceHeader)}`,
			source: "explicit_trace_id",
		};
	}

	const explicitTraceBody = readNestedString(requestBody, [
		"trace_id",
		"traceId",
		"metadata.trace_id",
		"metadata.traceId",
	]);
	if (explicitTraceBody) {
		return {
			traceId: `tr_${sanitizeId(explicitTraceBody)}`,
			source: "explicit_trace_id",
		};
	}

	const sessionHeader = getHeader(startMessage.requestHeaders, [
		"x-conversation-id",
		"x-session-id",
		"x-claude-session-id",
	]);
	if (sessionHeader) {
		return {
			traceId: `tr_${sanitizeId(sessionHeader)}`,
			source: "session_or_conversation",
		};
	}

	const sessionBody = readNestedString(requestBody, [
		"conversation_id",
		"conversationId",
		"session_id",
		"sessionId",
		"metadata.conversation_id",
		"metadata.conversationId",
		"metadata.session_id",
		"metadata.sessionId",
	]);
	if (sessionBody) {
		return {
			traceId: `tr_${sanitizeId(sessionBody)}`,
			source: "session_or_conversation",
		};
	}

	const requestScopedHeader = getHeader(startMessage.requestHeaders, [
		"x-request-id",
	]);
	if (requestScopedHeader) {
		return {
			traceId: `tr_${sanitizeId(requestScopedHeader)}`,
			source: "request_scoped",
		};
	}

	const seed = extractConversationSeed(
		(requestBody as RequestLikeBody | null) || null,
		requestBodyText,
	);
	if (seed) {
		return {
			traceId: `tr_${createHash("sha256").update(seed).digest("hex").slice(0, 24)}`,
			source: "content_fingerprint",
		};
	}

	return {
		traceId: `tr_${sanitizeId(startMessage.requestId)}`,
		source: "request_id_fallback",
	};
}
