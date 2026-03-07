import type { TraceEvent } from "@better-ccflare/types";
import {
	formatCost,
	formatDuration,
	formatTokens,
} from "@better-ccflare/ui-common";
import {
	Bot,
	Bug,
	ChevronRight,
	Clock3,
	Eye,
	Filter,
	GitBranch,
	LoaderCircle,
	Minus,
	Plus,
	RefreshCw,
	SquareTerminal,
	X,
} from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RequestPayload, RequestSummary } from "../api";
import {
	useRequestPayload,
	useRequests,
	useTraceDetail,
	useTraceLookup,
} from "../hooks/queries";
import { useDebugStream } from "../hooks/useDebugStream";
import { useRequestStream } from "../hooks/useRequestStream";
import { cn } from "../lib/utils";
import { ConversationView } from "./ConversationView";
import { CopyButton } from "./CopyButton";
import { RequestDetailsModal } from "./RequestDetailsModal";
import { TokenUsageDisplay } from "./TokenUsageDisplay";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

const PANEL_REQUEST_LIMIT = 30;

type TraceInspectorEvent = TraceEvent & {
	isLive?: boolean;
};

function formatPanelTimestamp(timestamp: number): string {
	return new Date(timestamp).toLocaleString();
}

function decodeBase64(value: string | null): string {
	if (!value) return "No data";
	try {
		if (value === "[streamed]") {
			return "[Streaming data not captured]";
		}
		return atob(value);
	} catch {
		return value;
	}
}

function formatJsonLike(value: string): string {
	try {
		return JSON.stringify(JSON.parse(value), null, 2);
	} catch {
		return value;
	}
}

function stringifyJson(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function eventTypeVariant(type: TraceEvent["type"]) {
	if (type === "tool_call" || type === "tool_result") return "warning";
	if (type === "error") return "destructive";
	if (type === "llm_request" || type === "llm_response") return "secondary";
	return "outline";
}

function statusVariant(status: "ok" | "error" | undefined) {
	return status === "error" ? "destructive" : "success";
}

function getEventLatency(event: TraceEvent): number {
	if (typeof event.metrics?.latency_ms === "number") {
		return Math.max(0, Math.round(event.metrics.latency_ms));
	}
	if (typeof event.ts_end === "number") {
		return Math.max(0, event.ts_end - event.ts_start);
	}
	return 0;
}

function mergeTraceInspectorEvents(
	persistedEvents: TraceEvent[],
	liveEvents: TraceEvent[],
): TraceInspectorEvent[] {
	const merged = new Map<string, TraceInspectorEvent>();

	for (const event of persistedEvents) {
		merged.set(`${event.trace_id}:${event.span_id}`, {
			...event,
			isLive: false,
		});
	}

	for (const event of liveEvents) {
		const key = `${event.trace_id}:${event.span_id}`;
		const existing = merged.get(key);
		if (existing) {
			merged.set(key, {
				...existing,
				isLive: true,
			});
			continue;
		}
		merged.set(key, {
			...event,
			isLive: true,
		});
	}

	return Array.from(merged.values()).sort((left, right) => {
		if (left.ts_start !== right.ts_start) {
			return left.ts_start - right.ts_start;
		}
		return left.span_id.localeCompare(right.span_id);
	});
}

function extractProjectPath(request: RequestPayload | null): string | null {
	if (!request) return null;

	const headerEntries = Object.entries(request.request.headers || {});
	const headerMap = new Map<string, string>(
		headerEntries.map(([key, value]) => [key.toLowerCase(), value]),
	);

	const headerPath =
		headerMap.get("x-better-ccflare-project-path") ||
		headerMap.get("x-project-path") ||
		headerMap.get("x-workspace-path") ||
		headerMap.get("x-workspace-root") ||
		headerMap.get("x-cwd");
	if (headerPath && headerPath.trim().length > 0) {
		return headerPath
			.replace(/\\\//g, "/")
			.replace(/[\\/]+$/g, "")
			.trim();
	}

	if (!request.request.body) return null;

	try {
		const decoded = JSON.parse(decodeBase64(request.request.body)) as Record<
			string,
			unknown
		>;
		const candidates = [
			decoded.project_path,
			decoded.projectPath,
			decoded.workspace_path,
			decoded.workspacePath,
			(decoded.metadata as Record<string, unknown> | undefined)?.project_path,
			(decoded.metadata as Record<string, unknown> | undefined)?.projectPath,
		];
		for (const candidate of candidates) {
			if (typeof candidate === "string" && candidate.trim().length > 0) {
				return candidate
					.replace(/\\\//g, "/")
					.replace(/[\\/]+$/g, "")
					.trim();
			}
		}
	} catch {
		return null;
	}

	return null;
}

function RequestListItem({
	request,
	summary,
	isSelected,
	onSelect,
}: {
	request: RequestPayload;
	summary: RequestSummary | undefined;
	isSelected: boolean;
	onSelect: () => void;
}) {
	const isPending = request.meta.pending === true;
	const isError =
		request.error ||
		request.meta.success === false ||
		(summary?.success === false && !isPending);
	const statusCode = request.response?.status ?? summary?.statusCode ?? null;

	return (
		<button
			type="button"
			className={cn(
				"w-full border-l-2 border-transparent px-3 py-2 text-left transition-colors",
				isSelected
					? "border-l-primary bg-accent/15"
					: "border-b hover:bg-muted/40",
			)}
			onClick={onSelect}
		>
			<div className="flex flex-wrap items-center gap-2">
				<Badge
					variant={
						isPending ? "secondary" : isError ? "destructive" : "success"
					}
				>
					{isPending ? "pending" : isError ? "error" : "ok"}
				</Badge>
				{summary?.agentUsed && (
					<Badge variant="outline" className="max-w-[140px] truncate">
						{summary.agentUsed}
					</Badge>
				)}
				{statusCode !== null && (
					<span className="text-xs text-muted-foreground">{statusCode}</span>
				)}
			</div>
			<div className="mt-2 space-y-1">
				<div className="text-sm font-medium leading-5">
					{request.meta.path || summary?.path || "Request"}
				</div>
				<div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
					<span>{formatPanelTimestamp(request.meta.timestamp)}</span>
					{summary?.model && <span>{summary.model}</span>}
					{summary?.responseTimeMs && (
						<span>{formatDuration(summary.responseTimeMs)}</span>
					)}
				</div>
			</div>
		</button>
	);
}

function TraceInspector({
	events,
	isLoading,
	error,
}: {
	events: TraceInspectorEvent[];
	isLoading: boolean;
	error: string | null;
}) {
	const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);

	useEffect(() => {
		if (events.length === 0) {
			setSelectedSpanId(null);
			return;
		}
		if (
			!selectedSpanId ||
			!events.some((event) => event.span_id === selectedSpanId)
		) {
			setSelectedSpanId(events[0].span_id);
		}
	}, [events, selectedSpanId]);

	const selectedEvent = useMemo(
		() => events.find((event) => event.span_id === selectedSpanId) || null,
		[events, selectedSpanId],
	);

	if (isLoading) {
		return (
			<div className="flex items-center gap-2 text-sm text-muted-foreground">
				<LoaderCircle className="h-4 w-4 animate-spin" />
				Loading trace events...
			</div>
		);
	}

	if (error) {
		return <p className="text-sm text-destructive">{error}</p>;
	}

	if (events.length === 0) {
		return (
			<p className="text-sm text-muted-foreground">
				No trace events available.
			</p>
		);
	}

	return (
		<div className="grid grid-cols-1 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)] gap-3">
			<div className="max-h-[360px] overflow-auto border bg-muted/10">
				{events.map((event) => (
					<button
						key={event.span_id}
						type="button"
						className={cn(
							"w-full border-l-2 border-transparent border-b px-3 py-2 text-left transition-colors",
							selectedSpanId === event.span_id
								? "border-l-primary bg-accent/15"
								: "hover:bg-muted/40",
						)}
						onClick={() => setSelectedSpanId(event.span_id)}
					>
						<div className="flex flex-wrap items-center gap-2">
							<Badge variant={eventTypeVariant(event.type)}>{event.type}</Badge>
							<Badge variant={statusVariant(event.status)}>
								{event.status || "ok"}
							</Badge>
							{event.isLive && <Badge variant="secondary">live</Badge>}
						</div>
						<div className="mt-1 text-xs text-muted-foreground">
							<div>{event.actor}</div>
							<div>
								{formatPanelTimestamp(event.ts_start)}
								{getEventLatency(event) > 0
									? ` · ${formatDuration(getEventLatency(event))}`
									: ""}
							</div>
						</div>
					</button>
				))}
			</div>
			<div className="border bg-muted/10 p-3">
				{selectedEvent ? (
					<div className="space-y-3">
						<div className="flex flex-wrap items-center gap-2">
							<Badge variant={eventTypeVariant(selectedEvent.type)}>
								{selectedEvent.type}
							</Badge>
							<Badge variant={statusVariant(selectedEvent.status)}>
								{selectedEvent.status || "ok"}
							</Badge>
							{selectedEvent.isLive && <Badge variant="secondary">live</Badge>}
							<Badge variant="outline">{selectedEvent.actor}</Badge>
						</div>
						<div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-muted-foreground">
							<div>Span: {selectedEvent.span_id}</div>
							<div>Request: {selectedEvent.request_id || "-"}</div>
							<div>Round: {selectedEvent.round_id ?? "-"}</div>
							<div>Started: {formatPanelTimestamp(selectedEvent.ts_start)}</div>
						</div>
						<div>
							<div className="mb-1 flex items-center justify-between">
								<p className="text-xs font-medium">Payload</p>
								<CopyButton
									variant="ghost"
									size="sm"
									getValue={() => stringifyJson(selectedEvent.payload)}
								>
									Copy
								</CopyButton>
							</div>
							<pre className="max-h-[220px] overflow-auto rounded bg-background p-3 text-xs font-mono">
								{stringifyJson(selectedEvent.payload)}
							</pre>
						</div>
						{selectedEvent.metrics && (
							<div>
								<div className="mb-1 flex items-center justify-between">
									<p className="text-xs font-medium">Metrics</p>
									<CopyButton
										variant="ghost"
										size="sm"
										getValue={() => stringifyJson(selectedEvent.metrics)}
									>
										Copy
									</CopyButton>
								</div>
								<pre className="max-h-[160px] overflow-auto rounded bg-background p-3 text-xs font-mono">
									{stringifyJson(selectedEvent.metrics)}
								</pre>
							</div>
						)}
					</div>
				) : (
					<p className="text-sm text-muted-foreground">
						Select a trace event to inspect payload.
					</p>
				)}
			</div>
		</div>
	);
}

type FlowNodeTone = "user" | "agent" | "success" | "error" | "neutral";

type FlowNode = {
	id: string;
	title: string;
	subtitle?: string;
	meta?: string;
	tone: FlowNodeTone;
	details?: string;
};

const FLOW_NODE_MIN_WIDTH = 180;
const FLOW_NODE_MAX_WIDTH = 320;
const FLOW_CHAR_WIDTH = 7;
const FLOW_NODE_PADDING_H = 16;
const FLOW_NODE_GAP_Y = 18;
const FLOW_CANVAS_PADDING = 24;
const FLOW_VIEWPORT_PADDING = 240;
const FLOW_PAN_THRESHOLD = 6;
const FLOW_ZOOM_LEVELS = [0.7, 0.85, 1, 1.15, 1.35, 1.6];

function measureFlowNodeWidth(title: string, subtitle?: string): number {
	const titleWidth = title.length * FLOW_CHAR_WIDTH + FLOW_NODE_PADDING_H * 2;
	const subtitleWidth = subtitle
		? subtitle.length * (FLOW_CHAR_WIDTH - 1) + FLOW_NODE_PADDING_H * 2
		: 0;
	return Math.min(
		FLOW_NODE_MAX_WIDTH,
		Math.max(FLOW_NODE_MIN_WIDTH, titleWidth, subtitleWidth),
	);
}

function toneClasses(tone: FlowNodeTone): string {
	if (tone === "user") {
		return "border-[#3a76ad] bg-[#111b2a] text-[#d7e7fb]";
	}
	if (tone === "agent") {
		return "border-[#3a76ad] bg-[#111b2a] text-[#d7e7fb]";
	}
	if (tone === "success") {
		return "border-[#3b8e69] bg-[#101d18] text-[#d7f6e6]";
	}
	if (tone === "error") {
		return "border-[#aa6250] bg-[#1c1413] text-[#f8e0d8]";
	}
	return "border-[#5b6c84] bg-[#121923] text-[#d3dae3]";
}

function getUserPromptPreview(requestBodyText: string | null): string {
	if (!requestBodyText) return "No prompt content captured.";

	try {
		const parsed = JSON.parse(requestBodyText) as {
			messages?: Array<{
				role?: string;
				content?: unknown;
			}>;
		};
		const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
		for (let index = messages.length - 1; index >= 0; index -= 1) {
			const message = messages[index];
			if (message.role !== "user") continue;
			if (typeof message.content === "string") {
				return message.content;
			}
			if (Array.isArray(message.content)) {
				const textChunk = message.content
					.map((part) => {
						if (typeof part === "string") return part;
						if (typeof part === "object" && part !== null && "text" in part) {
							const value = (part as { text?: unknown }).text;
							return typeof value === "string" ? value : "";
						}
						return "";
					})
					.join(" ")
					.trim();
				if (textChunk.length > 0) {
					return textChunk;
				}
			}
		}
	} catch {
		return requestBodyText;
	}

	return requestBodyText;
}

function getEventNodeTitle(event: TraceInspectorEvent): string {
	if (event.type === "tool_call" || event.type === "tool_result") {
		const toolName =
			typeof event.payload?.tool_name === "string"
				? event.payload.tool_name
				: event.actor.replace(/^tool:/, "");
		return toolName || event.type;
	}

	if (event.type === "error") {
		const errorType =
			typeof event.payload?.error_type === "string"
				? event.payload.error_type
				: "error";
		return errorType;
	}

	return event.type;
}

function buildFlowNodes({
	summary,
	request,
	requestBodyText,
	events,
}: {
	summary: RequestSummary | undefined;
	request: RequestPayload | null;
	requestBodyText: string | null;
	events: TraceInspectorEvent[];
}): {
	leftNodes: FlowNode[];
	rightNodes: FlowNode[];
} {
	const userPrompt = getUserPromptPreview(requestBodyText).trim();
	const userNode: FlowNode = {
		id: "user",
		title: "User",
		subtitle:
			userPrompt.length > 0 ? userPrompt : "No prompt content captured.",
		tone: "user",
		details: requestBodyText || undefined,
	};

	const tokenText =
		typeof summary?.totalTokens === "number"
			? `${formatTokens(summary.totalTokens)} tokens`
			: "tokens n/a";
	const latencyText =
		typeof summary?.responseTimeMs === "number"
			? formatDuration(summary.responseTimeMs)
			: "latency n/a";

	const agentNode: FlowNode = {
		id: "agent",
		title: summary?.agentUsed || summary?.model || "agent",
		subtitle: `${summary?.path || request?.meta.path || "panel/editAgent"}`,
		meta: `${tokenText} · ${latencyText}`,
		tone: "agent",
	};

	const leftNodes: FlowNode[] = [userNode, agentNode];
	const rightNodes: FlowNode[] = [];

	for (const event of events.slice(0, 40)) {
		const isToolNode =
			event.type === "tool_call" || event.type === "tool_result";
		const isErrorNode = event.type === "error" || event.status === "error";
		const node: FlowNode = {
			id: `${event.trace_id}:${event.span_id}`,
			title: getEventNodeTitle(event),
			subtitle: isErrorNode ? "error" : event.status || "success",
			meta: `${formatPanelTimestamp(event.ts_start)}${
				getEventLatency(event) > 0
					? ` · ${formatDuration(getEventLatency(event))}`
					: ""
			}`,
			tone: isErrorNode ? "error" : "success",
			details: stringifyJson(event.payload),
		};

		if (isToolNode) {
			rightNodes.push(node);
		} else {
			leftNodes.push(node);
		}
	}

	return {
		leftNodes,
		rightNodes,
	};
}

function AgentFlowChart({
	summary,
	request,
	requestBodyText,
	events,
	isLoading,
	error,
}: {
	summary: RequestSummary | undefined;
	request: RequestPayload | null;
	requestBodyText: string | null;
	events: TraceInspectorEvent[];
	isLoading: boolean;
	error: string | null;
}) {
	type CanvasNode = {
		node: FlowNode;
		x: number;
		y: number;
		width: number;
		height: number;
	};

	type CanvasEdge = {
		id: string;
		fromId: string;
		toId: string;
	};

	const [filterText, setFilterText] = useState("");
	const [selectedNodeId, setSelectedNodeId] = useState<string>("user");
	const [showDetails, setShowDetails] = useState(true);
	const [isPanning, setIsPanning] = useState(false);
	const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
	const [scale, setScale] = useState(1);
	const viewportRef = useRef<HTMLDivElement | null>(null);
	const panStateRef = useRef<{
		pointerId: number;
		startX: number;
		startY: number;
		originX: number;
		originY: number;
		moved: boolean;
	} | null>(null);
	const hasInitializedPanRef = useRef(false);
	const suppressNodeClickRef = useRef(false);

	const { leftNodes, rightNodes } = useMemo(
		() =>
			buildFlowNodes({
				summary,
				request,
				requestBodyText,
				events,
			}),
		[summary, request, requestBodyText, events],
	);

	const normalizedFilter = filterText.trim().toLowerCase();
	const filteredLeftNodes = useMemo(() => {
		if (!normalizedFilter) return leftNodes;
		return leftNodes.filter((node) =>
			`${node.title} ${node.subtitle || ""} ${node.meta || ""}`
				.toLowerCase()
				.includes(normalizedFilter),
		);
	}, [leftNodes, normalizedFilter]);

	const filteredRightNodes = useMemo(() => {
		if (!normalizedFilter) return rightNodes;
		return rightNodes.filter((node) =>
			`${node.title} ${node.subtitle || ""} ${node.meta || ""}`
				.toLowerCase()
				.includes(normalizedFilter),
		);
	}, [rightNodes, normalizedFilter]);

	const layout = useMemo(() => {
		const visibleMainNodes = filteredLeftNodes.slice(0, 18);
		const visibleToolNodes = filteredRightNodes.slice(0, 12);

		const startY = FLOW_CANVAS_PADDING;
		const mainX = FLOW_CANVAS_PADDING;
		const toolX = 420;

		const nodes: CanvasNode[] = [];

		const getNodeHeight = (node: FlowNode): number => {
			if (node.meta) return 82;
			if (node.subtitle) return 68;
			return 50;
		};

		const mainYMap = new Map<string, number>();
		let mainCursorY = startY;

		for (const node of visibleMainNodes) {
			const width = measureFlowNodeWidth(node.title, node.subtitle);
			const height = getNodeHeight(node);
			nodes.push({
				node,
				x: mainX,
				y: mainCursorY,
				width,
				height,
			});
			mainYMap.set(node.id, mainCursorY);
			mainCursorY += height + FLOW_NODE_GAP_Y;
		}

		const anchorMainIndex = Math.min(
			2,
			Math.max(0, visibleMainNodes.length - 1),
		);
		const toolStartY =
			visibleMainNodes.length > 0
				? (mainYMap.get(visibleMainNodes[anchorMainIndex].id) ?? startY)
				: startY;

		let toolCursorY = toolStartY;
		for (const node of visibleToolNodes) {
			const width = measureFlowNodeWidth(node.title, node.subtitle);
			const height = getNodeHeight(node);
			nodes.push({
				node,
				x: toolX,
				y: toolCursorY,
				width,
				height,
			});
			toolCursorY += height + FLOW_NODE_GAP_Y;
		}

		const edges: CanvasEdge[] = [];

		for (let index = 0; index < visibleMainNodes.length - 1; index += 1) {
			edges.push({
				id: `main:${index}`,
				fromId: visibleMainNodes[index].id,
				toId: visibleMainNodes[index + 1].id,
			});
		}

		if (visibleMainNodes.length > 1 && visibleToolNodes.length > 0) {
			edges.push({
				id: "branch:main-tool",
				fromId: visibleMainNodes[Math.min(1, visibleMainNodes.length - 1)].id,
				toId: visibleToolNodes[0].id,
			});
		}

		for (let index = 0; index < visibleToolNodes.length - 1; index += 1) {
			edges.push({
				id: `tool:${index}`,
				fromId: visibleToolNodes[index].id,
				toId: visibleToolNodes[index + 1].id,
			});
		}

		const chartHeight =
			nodes.reduce(
				(max, current) => Math.max(max, current.y + current.height),
				0,
			) + FLOW_CANVAS_PADDING;
		const chartWidth =
			nodes.reduce(
				(max, current) => Math.max(max, current.x + current.width),
				0,
			) + FLOW_CANVAS_PADDING;

		return {
			nodes,
			edges,
			chartWidth: Math.max(860, chartWidth),
			chartHeight,
		};
	}, [filteredLeftNodes, filteredRightNodes]);

	const sceneWidth = layout.chartWidth + FLOW_VIEWPORT_PADDING * 2;
	const sceneHeight = layout.chartHeight + FLOW_VIEWPORT_PADDING * 2;

	const nodeMap = useMemo(
		() => new Map(layout.nodes.map((entry) => [entry.node.id, entry])),
		[layout.nodes],
	);

	const clampPanOffset = useCallback(
		(x: number, y: number) => {
			const viewport = viewportRef.current;
			if (!viewport) {
				return { x, y };
			}

			const clampAxis = (
				value: number,
				sceneSize: number,
				viewportSize: number,
				targetScale: number,
			) => {
				const scaledSceneSize = sceneSize * targetScale;
				const slack = Math.max(160, Math.round(viewportSize * 0.2));
				if (scaledSceneSize <= viewportSize) {
					const center = Math.round((viewportSize - scaledSceneSize) / 2);
					return Math.min(center + slack, Math.max(center - slack, value));
				}
				const min = viewportSize - scaledSceneSize - slack;
				return Math.min(slack, Math.max(min, value));
			};

			return {
				x: clampAxis(x, sceneWidth, viewport.clientWidth, scale),
				y: clampAxis(y, sceneHeight, viewport.clientHeight, scale),
			};
		},
		[sceneHeight, sceneWidth, scale],
	);

	function clampPanOffsetAtScale(x: number, y: number, targetScale: number) {
		const viewport = viewportRef.current;
		if (!viewport) {
			return { x, y };
		}

		const clampAxis = (
			value: number,
			sceneSize: number,
			viewportSize: number,
		) => {
			const scaledSceneSize = sceneSize * targetScale;
			const slack = Math.max(160, Math.round(viewportSize * 0.2));
			if (scaledSceneSize <= viewportSize) {
				const center = Math.round((viewportSize - scaledSceneSize) / 2);
				return Math.min(center + slack, Math.max(center - slack, value));
			}
			const min = viewportSize - scaledSceneSize - slack;
			return Math.min(slack, Math.max(min, value));
		};

		return {
			x: clampAxis(x, sceneWidth, viewport.clientWidth),
			y: clampAxis(y, sceneHeight, viewport.clientHeight),
		};
	}

	function updateScale(nextScale: number) {
		const viewport = viewportRef.current;
		if (!viewport) {
			setScale(nextScale);
			return;
		}

		const centerX = viewport.clientWidth / 2;
		const centerY = viewport.clientHeight / 2;
		const anchorX = (centerX - panOffset.x) / scale;
		const anchorY = (centerY - panOffset.y) / scale;
		const nextOffset = clampPanOffsetAtScale(
			centerX - anchorX * nextScale,
			centerY - anchorY * nextScale,
			nextScale,
		);

		setScale(nextScale);
		setPanOffset(nextOffset);
	}

	function stepZoom(direction: -1 | 1) {
		const closestIndex = FLOW_ZOOM_LEVELS.reduce((bestIndex, level, index) => {
			const bestDistance = Math.abs(FLOW_ZOOM_LEVELS[bestIndex] - scale);
			const distance = Math.abs(level - scale);
			return distance < bestDistance ? index : bestIndex;
		}, 0);
		const nextIndex = Math.min(
			FLOW_ZOOM_LEVELS.length - 1,
			Math.max(0, closestIndex + direction),
		);
		updateScale(FLOW_ZOOM_LEVELS[nextIndex]);
	}

	function centerOnNode(entry: CanvasNode) {
		const viewport = viewportRef.current;
		if (!viewport) return;

		const nextOffset = clampPanOffsetAtScale(
			viewport.clientWidth / 2 -
				(FLOW_VIEWPORT_PADDING + entry.x + entry.width / 2) * scale,
			viewport.clientHeight / 2 -
				(FLOW_VIEWPORT_PADDING + entry.y + entry.height / 2) * scale,
			scale,
		);
		setPanOffset(nextOffset);
	}

	function edgePath(edge: CanvasEdge): string {
		const from = nodeMap.get(edge.fromId);
		const to = nodeMap.get(edge.toId);
		if (!from || !to) return "";

		const fromX = from.x + from.width / 2;
		const fromY = from.y + from.height;
		const toX = to.x + to.width / 2;
		const toY = to.y;

		const dy = Math.max(20, Math.round((toY - fromY) * 0.5));
		const c1x = fromX;
		const c1y = fromY + dy;
		const c2x = toX;
		const c2y = toY - dy;
		return `M ${fromX} ${fromY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${toX} ${toY}`;
	}

	const selectedNode = useMemo(() => {
		const allNodes = [...filteredLeftNodes, ...filteredRightNodes];
		return (
			allNodes.find((node) => node.id === selectedNodeId) || allNodes[0] || null
		);
	}, [filteredLeftNodes, filteredRightNodes, selectedNodeId]);
	const selectedNodeDetailsText = useMemo(
		() =>
			formatJsonLike(
				selectedNode?.details || "No detail payload for this node.",
			),
		[selectedNode?.details],
	);

	useEffect(() => {
		if (!selectedNode) return;
		if (selectedNode.id !== selectedNodeId) {
			setSelectedNodeId(selectedNode.id);
		}
	}, [selectedNode, selectedNodeId]);

	useEffect(() => {
		setPanOffset((current) => {
			const initial = {
				x: 32 - FLOW_VIEWPORT_PADDING,
				y: 24 - FLOW_VIEWPORT_PADDING,
			};
			const next = clampPanOffset(
				hasInitializedPanRef.current ? current.x : initial.x,
				hasInitializedPanRef.current ? current.y : initial.y,
			);
			hasInitializedPanRef.current = true;
			if (next.x === current.x && next.y === current.y) {
				return current;
			}
			return next;
		});
	}, [clampPanOffset]);

	useEffect(() => {
		const handleResize = () => {
			setPanOffset((current) => clampPanOffset(current.x, current.y));
		};

		window.addEventListener("resize", handleResize);
		return () => window.removeEventListener("resize", handleResize);
	}, [clampPanOffset]);

	function handleViewportPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
		if (event.button !== 0) return;
		const target = event.target as HTMLElement;
		if (target.closest("[data-flow-node='true']")) {
			return;
		}

		const viewport = viewportRef.current;
		if (!viewport) return;

		panStateRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			originX: panOffset.x,
			originY: panOffset.y,
			moved: false,
		};
		setIsPanning(false);
		viewport.setPointerCapture(event.pointerId);
	}

	function handleViewportPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
		const panState = panStateRef.current;
		const viewport = viewportRef.current;
		if (!panState || !viewport || panState.pointerId !== event.pointerId) {
			return;
		}

		const dx = event.clientX - panState.startX;
		const dy = event.clientY - panState.startY;
		if (
			!panState.moved &&
			(Math.abs(dx) >= FLOW_PAN_THRESHOLD || Math.abs(dy) >= FLOW_PAN_THRESHOLD)
		) {
			panState.moved = true;
			suppressNodeClickRef.current = true;
			setIsPanning(true);
		}

		if (!panState.moved) {
			return;
		}

		setPanOffset(clampPanOffset(panState.originX + dx, panState.originY + dy));
		event.preventDefault();
	}

	function stopViewportPan(event: ReactPointerEvent<HTMLDivElement>) {
		const viewport = viewportRef.current;
		if (viewport?.hasPointerCapture(event.pointerId)) {
			viewport.releasePointerCapture(event.pointerId);
		}
		if (panStateRef.current?.moved) {
			window.setTimeout(() => {
				suppressNodeClickRef.current = false;
			}, 0);
		}
		panStateRef.current = null;
		setIsPanning(false);
	}

	if (isLoading) {
		return (
			<div className="flex h-full items-center gap-2 text-sm text-muted-foreground">
				<LoaderCircle className="h-4 w-4 animate-spin" />
				Loading flow chart...
			</div>
		);
	}

	if (error) {
		return <p className="text-sm text-destructive">{error}</p>;
	}

	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-[#262a32] bg-[#0d1117] text-[#d4d4d4] [&_*]:transition-none">
			<div className="border-b border-[#262a32] px-3 py-2 text-xs text-[#97a0ac]">
				<span>Agent Debug Panel</span>
				<ChevronRight className="mx-1 inline h-3 w-3" />
				<span>{summary?.agentUsed || summary?.model || "Session"}</span>
				<ChevronRight className="mx-1 inline h-3 w-3" />
				<span>Flow Chart</span>
			</div>
			<div className="border-b border-[#262a32] p-3">
				<div className="flex flex-wrap items-center gap-3">
					<div className="relative min-w-[240px] flex-1">
						<Filter className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8d98a8]" />
						<Input
							value={filterText}
							onChange={(event) => setFilterText(event.target.value)}
							placeholder="Filter nodes..."
							className="h-8 rounded-lg border-[#2c3340] bg-[#161b24] pr-9 text-xs text-[#d5d9e0] placeholder:text-[#7f8792] focus-visible:ring-[#41618b]"
						/>
					</div>
					<div className="flex items-center gap-1 rounded-lg border border-[#283243] bg-[#131923] p-1">
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="h-7 w-7 text-[#b4bfcc]"
							onClick={() => stepZoom(-1)}
							disabled={scale <= FLOW_ZOOM_LEVELS[0]}
						>
							<Minus className="h-3.5 w-3.5" />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-7 min-w-[64px] px-2 text-xs text-[#d5dae2]"
							onClick={() => updateScale(1)}
						>
							{Math.round(scale * 100)}%
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="h-7 w-7 text-[#b4bfcc]"
							onClick={() => stepZoom(1)}
							disabled={scale >= FLOW_ZOOM_LEVELS[FLOW_ZOOM_LEVELS.length - 1]}
						>
							<Plus className="h-3.5 w-3.5" />
						</Button>
					</div>
					{selectedNode && (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-8 border border-[#283243] bg-[#131923] text-xs text-[#c6cfda]"
							onClick={() => {
								const entry = layout.nodes.find(
									(nodeEntry) => nodeEntry.node.id === selectedNode.id,
								);
								if (entry) {
									centerOnNode(entry);
								}
							}}
						>
							Center Selected
						</Button>
					)}
				</div>
			</div>
			<div className="flex min-h-0 flex-1 overflow-hidden">
				<div
					ref={viewportRef}
					className={cn(
						"relative min-h-0 min-w-0 flex-1 overflow-hidden p-4",
						isPanning ? "cursor-grabbing select-none" : "cursor-grab",
					)}
					onPointerDown={handleViewportPointerDown}
					onPointerMove={handleViewportPointerMove}
					onPointerUp={stopViewportPan}
					onPointerCancel={stopViewportPan}
					style={{ touchAction: "none" }}
				>
					<div
						className="absolute left-0 top-0"
						style={{
							transform: `translate(${panOffset.x}px, ${panOffset.y}px)`,
						}}
					>
						<div
							className="relative"
							style={{
								width: `${sceneWidth}px`,
								height: `${sceneHeight}px`,
								transform: `scale(${scale})`,
								transformOrigin: "top left",
							}}
						>
							<div
								className="absolute rounded-xl border border-[#232833] bg-[#0a0f15]"
								style={{
									left: `${FLOW_VIEWPORT_PADDING}px`,
									top: `${FLOW_VIEWPORT_PADDING}px`,
									width: `${layout.chartWidth}px`,
									height: `${layout.chartHeight}px`,
								}}
							>
								<svg
									width={layout.chartWidth}
									height={layout.chartHeight}
									viewBox={`0 0 ${layout.chartWidth} ${layout.chartHeight}`}
									className="absolute inset-0 z-0"
								>
									<title>Flow connections</title>
									<defs>
										<marker
											id="flow-arrow"
											viewBox="0 0 10 10"
											refX="8"
											refY="5"
											markerWidth="6"
											markerHeight="6"
											orient="auto"
										>
											<path d="M 0 0 L 10 5 L 0 10 z" fill="#6e7887" />
										</marker>
									</defs>
									{layout.edges.map((edge) => {
										const path = edgePath(edge);
										if (!path) return null;
										return (
											<path
												key={edge.id}
												d={path}
												fill="none"
												stroke="#606b7d"
												strokeWidth="1.5"
												strokeLinecap="round"
												strokeLinejoin="round"
												markerEnd="url(#flow-arrow)"
											/>
										);
									})}
								</svg>

								{layout.nodes.map((entry) => (
									<button
										key={entry.node.id}
										type="button"
										data-flow-node="true"
										onClick={(event) => {
											if (suppressNodeClickRef.current) {
												event.preventDefault();
												return;
											}
											setSelectedNodeId(entry.node.id);
											setShowDetails(true);
										}}
										onDoubleClick={(event) => {
											if (suppressNodeClickRef.current) {
												event.preventDefault();
												return;
											}
											centerOnNode(entry);
										}}
										onDragStart={(event) => event.preventDefault()}
										className={cn(
											"absolute z-10 rounded-xl border px-3 py-2 text-left shadow-[0_8px_20px_rgba(3,7,18,0.22)]",
											toneClasses(entry.node.tone),
											selectedNode?.id === entry.node.id
												? "ring-2 ring-[#8db8e6]"
												: "hover:border-[#6f8097]",
										)}
										style={{
											left: `${entry.x}px`,
											top: `${entry.y}px`,
											width: `${entry.width}px`,
											height: `${entry.height}px`,
										}}
									>
										<div className="flex h-full min-h-0 flex-col overflow-hidden">
											<div className="truncate text-[13px] font-medium leading-5">
												{entry.node.title}
											</div>
											{entry.node.subtitle && (
												<div className="mt-0.5 line-clamp-1 text-[11px] text-white/72">
													{entry.node.subtitle}
												</div>
											)}
											{entry.node.meta && (
												<div className="mt-auto truncate pt-1 text-[11px] text-white/52">
													{entry.node.meta}
												</div>
											)}
										</div>
									</button>
								))}
							</div>
						</div>
					</div>
				</div>

				{showDetails ? (
					<div className="flex min-h-0 w-[min(42vw,480px)] min-w-[340px] max-w-[480px] flex-col border-l border-[#262a32] bg-[#12161d]">
						<div className="border-b border-[#262a32] px-4 py-3">
							<div className="flex items-start justify-between gap-3">
								<div>
									<p className="text-xs font-medium uppercase tracking-[0.18em] text-[#97a0ac]">
										Node Details
									</p>
									<p className="mt-1 text-sm text-[#d5dae2]">
										{selectedNode?.title || "Select a node"}
									</p>
								</div>
								<div className="flex items-center gap-2">
									{selectedNode && (
										<CopyButton
											variant="ghost"
											size="sm"
											getValue={() => selectedNodeDetailsText}
										>
											Copy
										</CopyButton>
									)}
									<Button
										variant="ghost"
										size="sm"
										onClick={() => setShowDetails(false)}
									>
										Hide
									</Button>
								</div>
							</div>
						</div>
						{selectedNode ? (
							<div className="flex min-h-0 flex-1 flex-col">
								<div className="space-y-3 border-b border-[#262a32] px-4 py-3">
									<div className="rounded-lg border border-[#303846] bg-[#0d1118] px-3 py-2 text-sm text-[#d8dde5]">
										{selectedNode.title}
									</div>
									{selectedNode.subtitle && (
										<div className="rounded-lg border border-[#283242] bg-[#101720] px-3 py-2 text-xs leading-5 text-[#b7c0cc]">
											{selectedNode.subtitle}
										</div>
									)}
									{selectedNode.meta && (
										<div className="text-xs text-[#8f9bab]">
											{selectedNode.meta}
										</div>
									)}
								</div>
								<div className="flex min-h-0 flex-1 flex-col px-4 py-3">
									<div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-[#97a0ac]">
										Payload
									</div>
									<pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-[#2f3743] bg-[#0d1118] p-3 text-xs leading-5 text-[#c9ced6]">
										{selectedNodeDetailsText}
									</pre>
								</div>
							</div>
						) : (
							<div className="flex flex-1 items-center justify-center px-4 text-sm text-[#97a0ac]">
								Select a node to inspect details.
							</div>
						)}
					</div>
				) : (
					<div className="flex w-[88px] items-start justify-center border-l border-[#262a32] bg-[#12161d] p-2">
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setShowDetails(true)}
						>
							Show Details
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}

export function DebugPanel() {
	const [isVisible, setIsVisible] = useState(false);
	const [activeTab, setActiveTab] = useState("flow");
	const [selectedRequestId, setSelectedRequestId] = useState<string | null>(
		null,
	);
	const [showRequestModal, setShowRequestModal] = useState(false);

	const {
		data: requestData,
		isLoading: requestsLoading,
		error: requestsError,
		refetch: refetchRequests,
	} = useRequests(PANEL_REQUEST_LIMIT, undefined, isVisible);

	const traceLiveMode = isVisible && activeTab === "trace";
	useRequestStream(PANEL_REQUEST_LIMIT, traceLiveMode);
	const { eventsByRequestId } = useDebugStream(traceLiveMode);

	const requestState = useMemo(() => {
		if (!requestData) return null;
		return {
			requests: requestData.requests,
			summaries:
				requestData.detailsMap instanceof Map
					? requestData.detailsMap
					: new Map(
							(requestData.detailsMap as RequestSummary[]).map((summary) => [
								summary.id,
								summary,
							]),
						),
		};
	}, [requestData]);

	const requests = requestState?.requests || [];
	const summaries =
		requestState?.summaries || new Map<string, RequestSummary>();
	const pendingCount = requests.filter(
		(request) => request.meta.pending,
	).length;

	useEffect(() => {
		if (!isVisible) return;
		if (requests.length === 0) {
			setSelectedRequestId(null);
			return;
		}
		if (
			!selectedRequestId ||
			!requests.some((request) => request.id === selectedRequestId)
		) {
			setSelectedRequestId(requests[0].id);
		}
	}, [isVisible, requests, selectedRequestId]);

	const selectedListRequest = useMemo(
		() => requests.find((request) => request.id === selectedRequestId) || null,
		[requests, selectedRequestId],
	);

	const selectedSummary = selectedRequestId
		? summaries.get(selectedRequestId)
		: undefined;

	const requestPayloadQuery = useRequestPayload(selectedRequestId, isVisible);
	const selectedRequest =
		requestPayloadQuery.data || selectedListRequest || null;
	const projectPath = extractProjectPath(selectedRequest);
	const selectedLiveBucket = selectedRequestId
		? eventsByRequestId[selectedRequestId] || null
		: null;
	const liveTraceId = selectedLiveBucket?.traceId || null;

	const traceLookupQuery = useTraceLookup(
		selectedRequestId,
		isVisible,
		traceLiveMode && selectedRequestId && !liveTraceId ? 2000 : false,
	);
	const traceId = traceLookupQuery.data?.trace_id || liveTraceId || null;
	const traceDetailQuery = useTraceDetail(
		traceId,
		traceLiveMode && traceId ? 2000 : false,
	);
	const mergedTraceEvents = useMemo(
		() =>
			mergeTraceInspectorEvents(
				traceDetailQuery.data?.events || [],
				selectedLiveBucket?.events || [],
			),
		[traceDetailQuery.data?.events, selectedLiveBucket?.events],
	);

	const requestBodyText = selectedRequest?.request.body
		? decodeBase64(selectedRequest.request.body)
		: null;
	const responseBodyText = selectedRequest?.response?.body
		? decodeBase64(selectedRequest.response.body)
		: null;

	const traceErrorMessage =
		mergedTraceEvents.length > 0
			? null
			: traceDetailQuery.error
				? traceDetailQuery.error instanceof Error
					? traceDetailQuery.error.message
					: String(traceDetailQuery.error)
				: traceLookupQuery.error
					? traceLookupQuery.error instanceof Error
						? traceLookupQuery.error.message
						: String(traceLookupQuery.error)
					: null;

	if (!isVisible) {
		return (
			<Button
				onClick={() => setIsVisible(true)}
				className="fixed bottom-4 right-4 z-50 rounded-sm border border-border shadow-lg"
				size="sm"
			>
				<Bug className="h-4 w-4" />
				Debug Panel
				{pendingCount > 0 && (
					<Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">
						{pendingCount}
					</Badge>
				)}
			</Button>
		);
	}

	return (
		<>
			<div className="fixed inset-x-0 bottom-0 top-20 z-50 border-t bg-background">
				<div className="flex h-11 items-center justify-between border-b px-3">
					<div className="flex items-center gap-2 text-sm font-medium">
						<Bug className="h-4 w-4 text-primary" />
						<span>Agent Debug Panel</span>
						<span className="text-xs text-muted-foreground">
							Live request and trace inspection
						</span>
					</div>
					<div className="flex items-center gap-2">
						<Button
							variant="ghost"
							size="sm"
							onClick={() => {
								void refetchRequests();
								if (selectedRequestId) {
									void requestPayloadQuery.refetch();
									void traceLookupQuery.refetch();
									if (traceId) {
										void traceDetailQuery.refetch();
									}
								}
							}}
						>
							<RefreshCw className="h-4 w-4" />
							Refresh
						</Button>
						<Button
							variant="ghost"
							size="icon"
							onClick={() => setIsVisible(false)}
						>
							<X className="h-4 w-4" />
						</Button>
					</div>
				</div>
				<div className="grid h-[calc(100%-44px)] grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)]">
					<div className="border-r bg-muted/10">
						<div className="flex items-center justify-between border-b px-4 py-3">
							<div>
								<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
									Activity
								</p>
								<p className="text-xs text-muted-foreground">
									{pendingCount} active / {requests.length} loaded
								</p>
							</div>
						</div>
						<div className="max-h-[calc(100vh-12rem)] overflow-auto">
							{requestsLoading ? (
								<div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
									<LoaderCircle className="h-4 w-4 animate-spin" />
									Loading requests...
								</div>
							) : requestsError ? (
								<p className="px-3 py-3 text-sm text-destructive">
									{requestsError instanceof Error
										? requestsError.message
										: String(requestsError)}
								</p>
							) : requests.length === 0 ? (
								<p className="px-3 py-3 text-sm text-muted-foreground">
									No request activity yet.
								</p>
							) : (
								requests.map((request) => (
									<RequestListItem
										key={request.id}
										request={request}
										summary={summaries.get(request.id)}
										isSelected={request.id === selectedRequestId}
										onSelect={() => setSelectedRequestId(request.id)}
									/>
								))
							)}
						</div>
					</div>

					<div className="flex min-h-0 flex-col bg-background">
						{selectedRequest ? (
							<>
								<div className="border-b px-4 py-3">
									<div className="flex flex-wrap items-center gap-2">
										<Badge
											variant={
												selectedListRequest?.meta.pending
													? "secondary"
													: selectedSummary?.success === false
														? "destructive"
														: "success"
											}
										>
											{selectedListRequest?.meta.pending
												? "pending"
												: selectedSummary?.success === false
													? "error"
													: "ok"}
										</Badge>
										{selectedSummary?.model && (
											<Badge variant="secondary">{selectedSummary.model}</Badge>
										)}
										{selectedSummary?.agentUsed && (
											<Badge variant="outline">
												<Bot className="mr-1 h-3 w-3" />
												{selectedSummary.agentUsed}
											</Badge>
										)}
										{traceId && (
											<Badge variant="outline">
												<GitBranch className="mr-1 h-3 w-3" />
												{traceId}
											</Badge>
										)}
									</div>
									<div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
										<span>
											{formatPanelTimestamp(selectedRequest.meta.timestamp)}
										</span>
										{selectedSummary?.responseTimeMs && (
											<span>
												{formatDuration(selectedSummary.responseTimeMs)}
											</span>
										)}
										{selectedSummary?.totalTokens && (
											<span>
												{formatTokens(selectedSummary.totalTokens)} tokens
											</span>
										)}
										{selectedSummary?.costUsd &&
											selectedSummary.costUsd > 0 && (
												<span>{formatCost(selectedSummary.costUsd)}</span>
											)}
										{projectPath && <span>{projectPath}</span>}
									</div>
									<div className="mt-3 flex flex-wrap gap-2">
										<Button
											variant="outline"
											size="sm"
											onClick={() => setShowRequestModal(true)}
										>
											<Eye className="h-4 w-4" />
											Open Full Request Detail
										</Button>
										<CopyButton
											variant="outline"
											size="sm"
											getValue={() =>
												stringifyJson({
													request: selectedRequest,
													summary: selectedSummary,
													trace_id: traceId,
												})
											}
										>
											Copy Snapshot
										</CopyButton>
									</div>
								</div>

								<Tabs
									defaultValue="flow"
									value={activeTab}
									onValueChange={setActiveTab}
									className="flex min-h-0 flex-1 flex-col"
								>
									<TabsList className="h-10 w-full justify-start rounded-none border-b bg-muted/10 px-2">
										<TabsTrigger value="flow">
											<GitBranch className="mr-1.5 h-4 w-4" />
											Flow
										</TabsTrigger>
										<TabsTrigger value="overview">
											<Clock3 className="mr-1.5 h-4 w-4" />
											Overview
										</TabsTrigger>
										<TabsTrigger value="conversation">
											<SquareTerminal className="mr-1.5 h-4 w-4" />
											Conversation
										</TabsTrigger>
										<TabsTrigger value="trace">
											<GitBranch className="mr-1.5 h-4 w-4" />
											Trace
										</TabsTrigger>
										<TabsTrigger value="raw">Raw</TabsTrigger>
									</TabsList>

									<TabsContent
										value="flow"
										className="min-h-0 flex-1 overflow-hidden p-4"
									>
										<AgentFlowChart
											summary={selectedSummary}
											request={selectedRequest}
											requestBodyText={requestBodyText}
											events={mergedTraceEvents}
											isLoading={
												traceLookupQuery.isFetching ||
												traceDetailQuery.isLoading
											}
											error={traceErrorMessage}
										/>
									</TabsContent>

									<TabsContent
										value="overview"
										className="min-h-0 flex-1 overflow-auto p-4"
									>
										<div className="grid grid-cols-1 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)] gap-4">
											<div className="space-y-4">
												<Card>
													<CardHeader className="pb-3">
														<CardTitle className="text-sm">
															Request Summary
														</CardTitle>
													</CardHeader>
													<CardContent className="space-y-2 text-sm">
														<div>
															<span className="text-muted-foreground">
																Path:
															</span>{" "}
															{selectedRequest.meta.path ||
																selectedSummary?.path ||
																"-"}
														</div>
														<div>
															<span className="text-muted-foreground">
																Method:
															</span>{" "}
															{selectedRequest.meta.method ||
																selectedSummary?.method ||
																"-"}
														</div>
														<div>
															<span className="text-muted-foreground">
																Request ID:
															</span>{" "}
															{selectedRequest.id}
														</div>
														<div>
															<span className="text-muted-foreground">
																Project:
															</span>{" "}
															{projectPath || "-"}
														</div>
													</CardContent>
												</Card>
												<TokenUsageDisplay summary={selectedSummary} />
											</div>
											<Card>
												<CardHeader className="pb-3">
													<CardTitle className="text-sm">
														Payload Snapshot
													</CardTitle>
												</CardHeader>
												<CardContent>
													<pre className="max-h-[360px] overflow-auto rounded bg-muted/60 p-3 text-xs font-mono">
														{stringifyJson({
															request_headers: selectedRequest.request.headers,
															response_headers:
																selectedRequest.response?.headers || {},
															trace_id: traceId,
														})}
													</pre>
												</CardContent>
											</Card>
										</div>
									</TabsContent>

									<TabsContent
										value="conversation"
										className="min-h-0 flex-1 overflow-hidden p-4"
									>
										{requestBodyText || responseBodyText ? (
											<ConversationView
												requestBody={requestBodyText}
												responseBody={responseBodyText}
											/>
										) : requestPayloadQuery.isLoading ? (
											<div className="flex items-center gap-2 text-sm text-muted-foreground">
												<LoaderCircle className="h-4 w-4 animate-spin" />
												Loading request payload...
											</div>
										) : (
											<p className="text-sm text-muted-foreground">
												Conversation payload is not available for this request
												yet.
											</p>
										)}
									</TabsContent>

									<TabsContent
										value="trace"
										className="min-h-0 flex-1 overflow-auto p-4"
									>
										<div className="space-y-4">
											<div className="flex items-center gap-2 text-xs text-muted-foreground">
												{traceLookupQuery.isFetching && !traceId ? (
													<>
														<LoaderCircle className="h-4 w-4 animate-spin" />
														Resolving trace for request...
													</>
												) : traceId ? (
													<>
														<GitBranch className="h-4 w-4" />
														Trace {traceId}
														{selectedLiveBucket?.events.length ? (
															<span>
																· {selectedLiveBucket.events.length} live event
																{selectedLiveBucket.events.length === 1
																	? ""
																	: "s"}
															</span>
														) : null}
													</>
												) : (
													"No trace activity linked to this request yet."
												)}
											</div>
											<TraceInspector
												events={mergedTraceEvents}
												isLoading={
													traceLookupQuery.isFetching ||
													traceDetailQuery.isLoading
												}
												error={traceErrorMessage}
											/>
										</div>
									</TabsContent>

									<TabsContent
										value="raw"
										className="min-h-0 flex-1 overflow-auto p-4"
									>
										<div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
											<Card>
												<CardHeader className="pb-3">
													<CardTitle className="text-sm">Request</CardTitle>
												</CardHeader>
												<CardContent className="space-y-3">
													<div>
														<div className="mb-1 flex items-center justify-between">
															<p className="text-xs font-medium">Headers</p>
															<CopyButton
																variant="ghost"
																size="sm"
																getValue={() =>
																	stringifyJson(selectedRequest.request.headers)
																}
															>
																Copy
															</CopyButton>
														</div>
														<pre className="max-h-[180px] overflow-auto rounded bg-muted/60 p-3 text-xs font-mono">
															{stringifyJson(selectedRequest.request.headers)}
														</pre>
													</div>
													<div>
														<div className="mb-1 flex items-center justify-between">
															<p className="text-xs font-medium">Body</p>
															<CopyButton
																variant="ghost"
																size="sm"
																getValue={() =>
																	formatJsonLike(requestBodyText || "No data")
																}
															>
																Copy
															</CopyButton>
														</div>
														<pre className="max-h-[260px] overflow-auto rounded bg-muted/60 p-3 text-xs font-mono">
															{formatJsonLike(requestBodyText || "No data")}
														</pre>
													</div>
												</CardContent>
											</Card>
											<Card>
												<CardHeader className="pb-3">
													<CardTitle className="text-sm">Response</CardTitle>
												</CardHeader>
												<CardContent className="space-y-3">
													<div>
														<div className="mb-1 flex items-center justify-between">
															<p className="text-xs font-medium">Headers</p>
															<CopyButton
																variant="ghost"
																size="sm"
																getValue={() =>
																	stringifyJson(
																		selectedRequest.response?.headers || {},
																	)
																}
															>
																Copy
															</CopyButton>
														</div>
														<pre className="max-h-[180px] overflow-auto rounded bg-muted/60 p-3 text-xs font-mono">
															{stringifyJson(
																selectedRequest.response?.headers || {},
															)}
														</pre>
													</div>
													<div>
														<div className="mb-1 flex items-center justify-between">
															<p className="text-xs font-medium">Body</p>
															<CopyButton
																variant="ghost"
																size="sm"
																getValue={() =>
																	formatJsonLike(responseBodyText || "No data")
																}
															>
																Copy
															</CopyButton>
														</div>
														<pre className="max-h-[260px] overflow-auto rounded bg-muted/60 p-3 text-xs font-mono">
															{formatJsonLike(responseBodyText || "No data")}
														</pre>
													</div>
												</CardContent>
											</Card>
										</div>
									</TabsContent>
								</Tabs>
							</>
						) : (
							<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
								Select a request to inspect.
							</div>
						)}
					</div>
				</div>
			</div>

			{showRequestModal && selectedRequest && (
				<RequestDetailsModal
					request={selectedRequest}
					summary={selectedSummary}
					isOpen={showRequestModal}
					onClose={() => setShowRequestModal(false)}
				/>
			)}
		</>
	);
}
