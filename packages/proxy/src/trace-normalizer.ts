import { createHash } from "node:crypto";
import type { RequestResponse } from "@better-ccflare/types";
import {
	parseAssistantMessage,
	parseRequestMessages,
} from "@better-ccflare/ui-common";
import { resolveTraceIdentity } from "./trace-id";
import type { StartMessage } from "./worker-messages";

const MAX_PAYLOAD_SIZE_BYTES = 64 * 1024;
const MAX_MESSAGE_SUMMARY = 100;
const MAX_TOOL_SUMMARY = 50;
const MAX_PREVIEW_CHARS = 800;
const MAX_REQUEST_EXCERPT_CHARS = 1200;
const MAX_RESPONSE_EXCERPT_CHARS = 1200;

interface RequestLikeBody {
	model?: string;
	messages?: Array<{
		role?: string;
		content?: unknown;
	}>;
	tools?: Array<Record<string, unknown>>;
	tool_choice?: unknown;
	trace_id?: string;
	traceId?: string;
	conversation_id?: string;
	conversationId?: string;
	session_id?: string;
	sessionId?: string;
	metadata?: Record<string, unknown>;
}

interface OpenAIToolCallLike {
	id?: string;
	type?: string;
	function?: {
		name?: string;
		arguments?: string;
	};
}

export interface NormalizedToolCall {
	tool_call_id: string;
	tool_name: string;
	arguments_summary: {
		arguments_hash: string;
		arguments_size: number;
	};
	arguments_preview?: string;
}

export interface NormalizedToolResult {
	tool_call_id: string;
	result_summary: {
		content_hash: string;
		content_size: number;
	};
	result_preview?: string;
	success: boolean;
	execution_latency_ms?: number;
	failure_reason?: string;
	retry_count?: number;
}

export interface NormalizedTraceData {
	traceId: string;
	modelName: string;
	projectPath?: string;
	llmRequestPayload: Record<string, unknown>;
	llmResponsePayload: Record<string, unknown>;
	toolCalls: NormalizedToolCall[];
	toolResults: NormalizedToolResult[];
	errorPayload?: Record<string, unknown>;
}

function safeJsonParse<T>(value: string): T | null {
	try {
		return JSON.parse(value) as T;
	} catch {
		return null;
	}
}

function decodeBase64(body: string | null): string | null {
	if (!body) return null;
	try {
		return Buffer.from(body, "base64").toString("utf-8");
	} catch {
		return null;
	}
}

function hashOf(value: unknown): string {
	const text = typeof value === "string" ? value : JSON.stringify(value);
	return `sha256:${createHash("sha256")
		.update(text || "")
		.digest("hex")}`;
}

function textSize(value: unknown): number {
	if (value == null) return 0;
	if (typeof value === "string") return Buffer.byteLength(value, "utf-8");
	const text = JSON.stringify(value) || "";
	return Buffer.byteLength(text, "utf-8");
}

function summarizeContent(value: unknown): { hash: string; size: number } {
	return {
		hash: hashOf(value),
		size: textSize(value),
	};
}

function truncatePreview(text: string, maxChars: number): string {
	if (text.length <= maxChars) {
		return text;
	}
	const omittedChars = text.length - maxChars;
	return `${text.slice(0, maxChars)}... (truncated ${omittedChars} chars)`;
}

function coercePreviewText(value: unknown): string {
	if (value == null) return "";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}

	if (Array.isArray(value)) {
		const parts: string[] = [];
		for (const item of value) {
			if (typeof item === "string") {
				parts.push(item);
				continue;
			}
			if (!item || typeof item !== "object") continue;
			const record = item as Record<string, unknown>;
			if (typeof record.text === "string") {
				parts.push(record.text);
				continue;
			}
			if (typeof record.content === "string") {
				parts.push(record.content);
				continue;
			}
			const json = JSON.stringify(record);
			if (json) {
				parts.push(json);
			}
		}
		if (parts.length > 0) {
			return parts.join("\n");
		}
	}

	if (typeof value === "object") {
		const record = value as Record<string, unknown>;
		if (typeof record.text === "string") return record.text;
		if (typeof record.content === "string") return record.content;
	}

	return JSON.stringify(value) || "";
}

function toPreview(
	value: unknown,
	maxChars = MAX_PREVIEW_CHARS,
): string | undefined {
	const raw = coercePreviewText(value).trim();
	if (raw.length === 0) return undefined;
	return truncatePreview(raw, maxChars);
}

function capPayloadSize(
	payload: Record<string, unknown>,
): Record<string, unknown> {
	const json = JSON.stringify(payload);
	const size = Buffer.byteLength(json, "utf-8");
	if (size <= MAX_PAYLOAD_SIZE_BYTES) {
		return payload;
	}

	return {
		truncated: true,
		original_size_bytes: size,
		payload_hash: hashOf(json),
	};
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
	body: RequestLikeBody | null,
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

function determineTraceId(
	startMessage: StartMessage,
	requestBody: RequestLikeBody | null,
	requestBodyText: string | null,
): string {
	return resolveTraceIdentity(
		startMessage,
		requestBody as Record<string, unknown> | null,
		requestBodyText,
	).traceId;
}

function normalizeToolName(tool: Record<string, unknown>): string {
	const directName = tool.name;
	if (typeof directName === "string" && directName.length > 0) {
		return directName;
	}

	const fnName = (tool.function as { name?: unknown } | undefined)?.name;
	if (typeof fnName === "string" && fnName.length > 0) {
		return fnName;
	}

	return "unknown";
}

function normalizeToolSchema(tool: Record<string, unknown>): unknown {
	if (tool.input_schema) return tool.input_schema;
	if (tool.parameters) return tool.parameters;
	if (
		tool.function &&
		typeof tool.function === "object" &&
		(tool.function as Record<string, unknown>).parameters
	) {
		return (tool.function as Record<string, unknown>).parameters;
	}
	return tool;
}

function collectToolCallsFromResponse(
	responseBodyText: string | null,
): NormalizedToolCall[] {
	if (!responseBodyText) return [];

	const assistant = parseAssistantMessage(responseBodyText);
	const toolCalls = new Map<string, NormalizedToolCall>();

	if (assistant?.tools) {
		for (const tool of assistant.tools) {
			const toolCallId = tool.id || `call_${tool.name}`;
			const toolName = tool.name || "unknown";
			const args = tool.input || {};
			toolCalls.set(toolCallId, {
				tool_call_id: toolCallId,
				tool_name: toolName,
				arguments_summary: {
					arguments_hash: hashOf(args),
					arguments_size: textSize(args),
				},
				arguments_preview: toPreview(args),
			});
		}
	}

	const jsonResponse = safeJsonParse<{
		choices?: Array<{ message?: { tool_calls?: OpenAIToolCallLike[] } }>;
	}>(responseBodyText);
	const openaiCalls = jsonResponse?.choices?.[0]?.message?.tool_calls || [];
	for (const toolCall of openaiCalls) {
		const id = toolCall.id || `call_${toolCall.function?.name || "unknown"}`;
		const name = toolCall.function?.name || "unknown";
		const rawArgs = toolCall.function?.arguments || "";
		toolCalls.set(id, {
			tool_call_id: id,
			tool_name: name,
			arguments_summary: {
				arguments_hash: hashOf(rawArgs),
				arguments_size: textSize(rawArgs),
			},
			arguments_preview: toPreview(rawArgs),
		});
	}

	return Array.from(toolCalls.values());
}

function collectToolResultsFromRequest(
	requestBodyText: string | null,
): NormalizedToolResult[] {
	if (!requestBodyText) return [];

	const resultsByToolCallId = new Map<string, NormalizedToolResult>();

	const raw = safeJsonParse<{
		messages?: Array<{
			content?: unknown;
		}>;
	}>(requestBodyText);

	const rawMessages = raw?.messages || [];
	for (const message of rawMessages) {
		if (!Array.isArray(message.content)) continue;
		for (const block of message.content) {
			if (!block || typeof block !== "object") continue;
			const record = block as Record<string, unknown>;
			if (record.type !== "tool_result") continue;

			const toolCallId =
				(typeof record.tool_use_id === "string" && record.tool_use_id) ||
				(typeof record.tool_call_id === "string" && record.tool_call_id) ||
				"";
			if (!toolCallId) continue;

			const content = record.content ?? "";
			const isError = record.is_error === true;
			const success = !isError;
			const failureReason =
				typeof record.error_message === "string"
					? record.error_message
					: typeof record.error === "string"
						? record.error
						: isError
							? "tool_result_marked_as_error"
							: undefined;

			const executionLatency = (() => {
				const candidates = [
					record.execution_latency_ms,
					record.latency_ms,
					record.duration_ms,
					(record.meta as Record<string, unknown> | undefined)
						?.execution_latency_ms,
					(record.meta as Record<string, unknown> | undefined)?.latency_ms,
					(record.meta as Record<string, unknown> | undefined)?.duration_ms,
				];
				for (const value of candidates) {
					if (typeof value === "number" && Number.isFinite(value)) {
						return Math.max(0, Math.trunc(value));
					}
					if (typeof value === "string" && value.trim().length > 0) {
						const parsed = Number(value);
						if (Number.isFinite(parsed)) {
							return Math.max(0, Math.trunc(parsed));
						}
					}
				}
				return undefined;
			})();

			const retryCount = (() => {
				const candidates = [
					record.retry_count,
					record.retryCount,
					record.attempt,
					record.retry_attempt,
					(record.meta as Record<string, unknown> | undefined)?.retry_count,
				];
				for (const value of candidates) {
					if (typeof value === "number" && Number.isFinite(value)) {
						return Math.max(0, Math.trunc(value));
					}
					if (typeof value === "string" && value.trim().length > 0) {
						const parsed = Number(value);
						if (Number.isFinite(parsed)) {
							return Math.max(0, Math.trunc(parsed));
						}
					}
				}
				return undefined;
			})();

			resultsByToolCallId.set(toolCallId, {
				tool_call_id: toolCallId,
				result_summary: {
					content_hash: hashOf(content),
					content_size: textSize(content),
				},
				result_preview: toPreview(content),
				success,
				execution_latency_ms: executionLatency,
				failure_reason: failureReason,
				retry_count: retryCount,
			});
		}
	}

	// Fallback: keep compatibility with parsed summary extraction.
	const parsedMessages = parseRequestMessages(requestBodyText);
	for (const message of parsedMessages) {
		if (!message.toolResults || message.toolResults.length === 0) continue;
		for (const result of message.toolResults) {
			if (!result.tool_use_id || resultsByToolCallId.has(result.tool_use_id))
				continue;
			resultsByToolCallId.set(result.tool_use_id, {
				tool_call_id: result.tool_use_id,
				result_summary: {
					content_hash: hashOf(result.content || ""),
					content_size: textSize(result.content || ""),
				},
				result_preview: toPreview(result.content || ""),
				success: true,
			});
		}
	}

	return Array.from(resultsByToolCallId.values());
}

function extractFinishReason(
	responseBodyText: string | null,
	toolCalls: NormalizedToolCall[],
): string {
	if (!responseBodyText) {
		return toolCalls.length > 0 ? "tool_calls" : "unknown";
	}

	const parsed = safeJsonParse<{
		finish_reason?: string;
		stop_reason?: string;
		choices?: Array<{ finish_reason?: string }>;
	}>(responseBodyText);

	const reason =
		parsed?.finish_reason ||
		parsed?.stop_reason ||
		parsed?.choices?.[0]?.finish_reason;
	if (reason) return reason;

	const lines = responseBodyText.split("\n");
	for (const line of lines) {
		if (!line.startsWith("data:")) continue;
		const jsonLine = safeJsonParse<{ type?: string; stop_reason?: string }>(
			line.slice(5).trim(),
		);
		if (jsonLine?.type === "message_stop" && jsonLine.stop_reason) {
			return jsonLine.stop_reason;
		}
	}

	return toolCalls.length > 0 ? "tool_calls" : "stop";
}

function toMessagesSummary(
	requestBody: RequestLikeBody | null,
): Array<{ role: string; length: number; hash: string }> {
	const messages = requestBody?.messages || [];
	return messages.slice(0, MAX_MESSAGE_SUMMARY).map((message) => ({
		role: typeof message.role === "string" ? message.role : "unknown",
		length: textSize(message.content || ""),
		hash: hashOf(message.content || ""),
	}));
}

function toMessagesPreview(
	requestBody: RequestLikeBody | null,
): Array<{ role: string; preview: string }> {
	const messages = requestBody?.messages || [];
	return messages
		.slice(0, MAX_MESSAGE_SUMMARY)
		.map((message) => ({
			role: typeof message.role === "string" ? message.role : "unknown",
			preview: toPreview(message.content) || "",
		}))
		.filter((message) => message.preview.length > 0);
}

function toToolsSummary(
	requestBody: RequestLikeBody | null,
): Array<{ name: string; schema_hash: string; schema_size: number }> {
	const tools = requestBody?.tools || [];
	return tools.slice(0, MAX_TOOL_SUMMARY).map((tool) => {
		const name = normalizeToolName(tool);
		const schema = normalizeToolSchema(tool);
		return {
			name,
			schema_hash: hashOf(schema),
			schema_size: textSize(schema),
		};
	});
}

function getTextCandidates(requestBody: RequestLikeBody | null): string[] {
	if (!requestBody) return [];

	const texts: string[] = [];
	const systemValue = (requestBody as Record<string, unknown>).system;
	if (typeof systemValue === "string" && systemValue.trim().length > 0) {
		texts.push(systemValue);
	}
	if (Array.isArray(systemValue)) {
		for (const item of systemValue) {
			if (!item || typeof item !== "object") continue;
			const text = (item as Record<string, unknown>).text;
			if (typeof text === "string" && text.trim().length > 0) {
				texts.push(text);
			}
		}
	}

	const messages = requestBody.messages || [];
	for (const message of messages) {
		if (
			typeof message.content === "string" &&
			message.content.trim().length > 0
		) {
			texts.push(message.content);
			continue;
		}
		if (Array.isArray(message.content)) {
			for (const part of message.content) {
				if (!part || typeof part !== "object") continue;
				const text = (part as Record<string, unknown>).text;
				if (typeof text === "string" && text.trim().length > 0) {
					texts.push(text);
				}
			}
		}
	}

	return texts;
}

function normalizeProjectPath(rawPath: string): string {
	return rawPath
		.replace(/\\\//g, "/")
		.replace(/^["'\s]+|["'\s]+$/g, "")
		.replace(/[\\/]+$/g, "");
}

function extractProjectPathFromText(content: string): string | null {
	const patterns = [
		/Contents of ([^\r\n]+?)[\\/]+AGENTS\.md/g,
		/Contents of ([^\r\n]+?)[\\/]+CLAUDE\.md/g,
	];

	for (const pattern of patterns) {
		const match = pattern.exec(content);
		if (!match?.[1]) continue;
		const normalized = normalizeProjectPath(match[1]);
		if (normalized.length > 0) {
			return normalized;
		}
	}

	return null;
}

function determineProjectPath(
	startMessage: StartMessage,
	requestBody: RequestLikeBody | null,
): string | undefined {
	const headerPath = getHeader(startMessage.requestHeaders, [
		"x-better-ccflare-project-path",
		"x-project-path",
		"x-workspace-path",
		"x-workspace-root",
		"x-cwd",
	]);
	if (headerPath) {
		return normalizeProjectPath(headerPath);
	}

	const bodyPath = readNestedString(requestBody, [
		"project_path",
		"projectPath",
		"workspace_path",
		"workspacePath",
		"metadata.project_path",
		"metadata.projectPath",
	]);
	if (bodyPath) {
		return normalizeProjectPath(bodyPath);
	}

	const textCandidates = getTextCandidates(requestBody);
	for (const text of textCandidates) {
		const extracted = extractProjectPathFromText(text);
		if (extracted) {
			return extracted;
		}
	}

	return undefined;
}

function normalizeToolChoice(value: unknown): string {
	if (value == null) return "auto";
	if (typeof value === "string") return value;
	return JSON.stringify(value) || "auto";
}

export function normalizeTraceData(
	startMessage: StartMessage,
	responseBodyBase64: string | null,
	summary: RequestResponse,
	errorMessage?: string,
): NormalizedTraceData {
	const requestBodyText = decodeBase64(startMessage.requestBody);
	const responseBodyText = decodeBase64(responseBodyBase64);
	const requestBody =
		(requestBodyText
			? safeJsonParse<RequestLikeBody>(requestBodyText)
			: null) || null;

	const traceId = determineTraceId(startMessage, requestBody, requestBodyText);
	const modelName = requestBody?.model || summary.model || "unknown";
	const projectPath = determineProjectPath(startMessage, requestBody);
	const toolCalls = collectToolCallsFromResponse(responseBodyText);
	const toolResults = collectToolResultsFromRequest(requestBodyText);
	const assistantMessage = parseAssistantMessage(responseBodyText || "");

	const llmRequestPayload = capPayloadSize({
		model: modelName,
		project_path: projectPath,
		endpoint: startMessage.path,
		messages_summary: toMessagesSummary(requestBody),
		messages_preview: toMessagesPreview(requestBody),
		tools_summary: toToolsSummary(requestBody),
		tool_choice: normalizeToolChoice(requestBody?.tool_choice),
		request_id: startMessage.requestId,
		request_excerpt: toPreview(requestBodyText, MAX_REQUEST_EXCERPT_CHARS),
	});

	const llmResponsePayload = capPayloadSize({
		model: modelName,
		finish_reason: extractFinishReason(responseBodyText, toolCalls),
		assistant_content_summary: summarizeContent(
			assistantMessage?.content || "",
		),
		assistant_content_preview: toPreview(assistantMessage?.content || ""),
		response_excerpt: toPreview(responseBodyText, MAX_RESPONSE_EXCERPT_CHARS),
		tool_calls: toolCalls.map((toolCall) => ({
			id: toolCall.tool_call_id,
			name: toolCall.tool_name,
			arguments_hash: toolCall.arguments_summary.arguments_hash,
			arguments_size: toolCall.arguments_summary.arguments_size,
			arguments_preview: toolCall.arguments_preview,
		})),
		usage: {
			prompt_tokens: summary.promptTokens || 0,
			completion_tokens: summary.completionTokens || 0,
			total_tokens: summary.totalTokens || 0,
		},
	});

	const errorPayload = errorMessage
		? capPayloadSize({
				error_message: errorMessage,
				status_code: startMessage.responseStatus,
			})
		: undefined;

	return {
		traceId,
		modelName,
		projectPath,
		llmRequestPayload,
		llmResponsePayload,
		toolCalls,
		toolResults,
		errorPayload,
	};
}
