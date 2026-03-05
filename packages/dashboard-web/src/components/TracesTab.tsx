import type { TraceEvent, TraceGraphNode } from "@better-ccflare/types";
import { formatCost, formatTokens } from "@better-ccflare/ui-common";
import {
	ArrowRightLeft,
	Clock,
	Filter,
	GitBranch,
	RefreshCw,
	Search,
	SquareDashedBottomCode,
	Timer,
	Wrench,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { TraceListQuery } from "../api";
import { useTraceDetail, useTraceGraph, useTraces } from "../hooks/queries";
import { cn } from "../lib/utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "./ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

type StatusFilter = "all" | "ok" | "error";
type TraceLane = "orchestrator" | "model" | "tool";

const TRACE_LANES: TraceLane[] = ["orchestrator", "model", "tool"];

function toTimestamp(value: string): number | undefined {
	if (!value) return undefined;
	const ts = new Date(value).getTime();
	return Number.isFinite(ts) ? ts : undefined;
}

function formatTimestamp(ts: number): string {
	return new Date(ts).toLocaleString();
}

function formatLatency(ms: number): string {
	if (ms < 1000) return `${ms} ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(2)} s`;
	return `${(ms / 60000).toFixed(2)} min`;
}

function statusVariant(status: "ok" | "error" | undefined) {
	return status === "error" ? "destructive" : "success";
}

function eventTypeVariant(type: TraceEvent["type"]) {
	if (type === "tool_call" || type === "tool_result") return "warning";
	if (type === "error") return "destructive";
	if (type === "llm_request" || type === "llm_response") return "secondary";
	return "outline";
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

function laneForEvent(event: TraceEvent): TraceLane {
	if (event.type === "tool_call" || event.type === "tool_result") return "tool";
	if (event.type === "llm_request" || event.type === "llm_response")
		return "model";
	return "orchestrator";
}

function laneLabel(lane: TraceLane): string {
	if (lane === "orchestrator") return "orchestrator";
	if (lane === "model") return "model";
	return "tool";
}

function actorDisplayName(actor: string): string {
	if (actor === "client") return "client";
	if (actor.startsWith("model:")) return actor.replace("model:", "model/");
	if (actor.startsWith("tool:")) return actor.replace("tool:", "tool/");
	return actor;
}

function getEventSequenceLabel(event: TraceEvent): string {
	if (event.type === "tool_call" || event.type === "tool_result") {
		const toolName =
			typeof event.payload.tool_name === "string"
				? event.payload.tool_name
				: null;
		const toolCallId =
			typeof event.payload.tool_call_id === "string"
				? event.payload.tool_call_id
				: null;
		if (toolName && toolCallId) return `${toolName} (${toolCallId})`;
		if (toolName) return toolName;
		if (toolCallId) return toolCallId;
	}
	if (event.type === "llm_request" || event.type === "llm_response") {
		const model =
			typeof event.payload.model === "string" ? event.payload.model : "";
		if (model) return model;
	}
	if (event.type === "error") {
		const errorType =
			typeof event.payload.error_type === "string"
				? event.payload.error_type
				: "";
		if (errorType) return errorType;
	}
	return event.type;
}

function tryParseJsonLikeString(value: string): unknown | null {
	const trimmed = value.trim();
	if (!trimmed) return null;

	const parseCandidate = (candidate: string): unknown | null => {
		const target = candidate.trim();
		if (!(target.startsWith("{") || target.startsWith("["))) {
			return null;
		}
		try {
			return JSON.parse(target);
		} catch {
			return null;
		}
	};

	const direct = parseCandidate(trimmed);
	if (direct !== null) return direct;

	if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
		try {
			const unwrapped = JSON.parse(trimmed);
			if (typeof unwrapped === "string") {
				return parseCandidate(unwrapped);
			}
		} catch {
			return null;
		}
	}

	return null;
}

function expandJsonLikeStrings(value: unknown, depth = 0): unknown {
	if (depth > 6) return value;

	if (typeof value === "string") {
		const parsed = tryParseJsonLikeString(value);
		return parsed === null ? value : expandJsonLikeStrings(parsed, depth + 1);
	}

	if (Array.isArray(value)) {
		return value.map((item) => expandJsonLikeStrings(item, depth + 1));
	}

	if (value && typeof value === "object") {
		const source = value as Record<string, unknown>;
		const next: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(source)) {
			next[key] = expandJsonLikeStrings(item, depth + 1);
		}
		return next;
	}

	return value;
}

function renderJsonPrimitive(value: unknown): ReactNode {
	if (value === null) {
		return <span className="text-muted-foreground italic">null</span>;
	}
	if (typeof value === "string") {
		return (
			<span className="text-emerald-600 dark:text-emerald-400 break-all">
				"{value}"
			</span>
		);
	}
	if (typeof value === "number") {
		return <span className="text-sky-600 dark:text-sky-400">{value}</span>;
	}
	if (typeof value === "boolean") {
		return (
			<span className="text-amber-600 dark:text-amber-400">
				{value ? "true" : "false"}
			</span>
		);
	}
	if (typeof value === "undefined") {
		return <span className="text-muted-foreground italic">undefined</span>;
	}
	return <span className="text-foreground">{String(value)}</span>;
}

function JsonValueTree({ value, depth = 0 }: { value: unknown; depth?: number }) {
	if (depth > 10) {
		return (
			<span className="text-muted-foreground italic">
				[Max depth reached]
			</span>
		);
	}

	if (!value || typeof value !== "object") {
		return renderJsonPrimitive(value);
	}

	const isArray = Array.isArray(value);
	const entries = isArray
		? (value as unknown[]).map((item, index) => [String(index), item] as const)
		: Object.entries(value as Record<string, unknown>);

	if (entries.length === 0) {
		return (
			<span className="text-muted-foreground">{isArray ? "[]" : "{}"}</span>
		);
	}

	return (
		<details open={depth < 1} className="group">
			<summary className="cursor-pointer list-none select-none text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
				<span>{isArray ? "[" : "{"}</span>
				<span>{isArray ? `Array(${entries.length})` : `Object(${entries.length})`}</span>
				<span>{isArray ? "]" : "}"}</span>
			</summary>
			<div className="ml-2 mt-1 border-l border-border/60 pl-3 space-y-0.5">
				{entries.map(([key, item]) => (
					<div key={`${depth}-${key}`} className="font-mono text-[11px] leading-5">
						{isArray ? (
							<span className="text-muted-foreground">[{key}]</span>
						) : (
							<span className="text-violet-600 dark:text-violet-400">
								"{key}"
							</span>
						)}
						<span className="text-muted-foreground">: </span>
						{item && typeof item === "object" ? (
							<JsonValueTree value={item} depth={depth + 1} />
						) : (
							renderJsonPrimitive(item)
						)}
					</div>
				))}
			</div>
		</details>
	);
}

function EventPayloadPanel({ event }: { event: TraceEvent | null }) {
	if (!event) {
		return (
			<div className="border rounded-lg p-3 text-sm text-muted-foreground">
				Click a node or timeline block to inspect payload.
			</div>
		);
	}

	const formattedPayload = useMemo(
		() => expandJsonLikeStrings(event.payload),
		[event.payload],
	);
	const formattedMetrics = useMemo(
		() => expandJsonLikeStrings(event.metrics || {}),
		[event.metrics],
	);

	return (
		<div className="border rounded-lg p-3 space-y-3">
			<div className="flex flex-wrap gap-2">
				<Badge variant={eventTypeVariant(event.type)}>{event.type}</Badge>
				<Badge variant={statusVariant(event.status)}>
					{event.status || "ok"}
				</Badge>
				<Badge variant="outline">{event.span_id}</Badge>
				<Badge variant="outline">{event.actor}</Badge>
			</div>
			<div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-muted-foreground">
				<div>Start: {formatTimestamp(event.ts_start)}</div>
				<div>Latency: {formatLatency(getEventLatency(event))}</div>
				<div>Round: {event.round_id ?? "-"}</div>
				<div>Request ID: {event.request_id || "-"}</div>
			</div>
			<div className="space-y-2">
				<div>
					<p className="text-xs font-medium mb-1">payload (click to fold)</p>
					<div className="rounded bg-muted/60 p-2 text-xs overflow-auto max-h-[300px] font-mono">
						<JsonValueTree value={formattedPayload} />
					</div>
				</div>
				<div>
					<p className="text-xs font-medium mb-1">metrics (click to fold)</p>
					<div className="rounded bg-muted/60 p-2 text-xs overflow-auto max-h-[220px] font-mono">
						<JsonValueTree value={formattedMetrics} />
					</div>
				</div>
			</div>
		</div>
	);
}

export function TracesTab() {
	const [page, setPage] = useState(1);
	const [pageSize, setPageSize] = useState(20);
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
	const [modelFilter, setModelFilter] = useState("");
	const [projectPathFilter, setProjectPathFilter] = useState("");
	const [dateFrom, setDateFrom] = useState("");
	const [dateTo, setDateTo] = useState("");
	const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
	const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
	const [zoom, setZoom] = useState(1.5);
	const [visibleLanes, setVisibleLanes] = useState<Set<TraceLane>>(
		new Set(TRACE_LANES),
	);

	const query = useMemo<TraceListQuery>(
		() => ({
			page,
			pageSize,
			fromTs: toTimestamp(dateFrom),
			toTs: toTimestamp(dateTo),
			model: modelFilter.trim() || undefined,
			projectPath: projectPathFilter.trim() || undefined,
			status: statusFilter === "all" ? undefined : statusFilter,
		}),
		[
			page,
			pageSize,
			dateFrom,
			dateTo,
			modelFilter,
			projectPathFilter,
			statusFilter,
		],
	);

	const tracesQuery = useTraces(query);
	const traces = tracesQuery.data?.items || [];
	const pagination = tracesQuery.data?.pagination;

	useEffect(() => {
		if (traces.length === 0) {
			setSelectedTraceId(null);
			return;
		}
		if (
			!selectedTraceId ||
			!traces.some((trace) => trace.trace_id === selectedTraceId)
		) {
			setSelectedTraceId(traces[0].trace_id);
		}
	}, [traces, selectedTraceId]);

	const traceDetailQuery = useTraceDetail(selectedTraceId);
	const traceGraphQuery = useTraceGraph(selectedTraceId);
	const traceEvents = traceDetailQuery.data?.events || [];

	useEffect(() => {
		if (traceEvents.length === 0) {
			setSelectedSpanId(null);
			return;
		}
		if (
			!selectedSpanId ||
			!traceEvents.some((event) => event.span_id === selectedSpanId)
		) {
			setSelectedSpanId(traceEvents[0].span_id);
		}
	}, [traceEvents, selectedSpanId]);

	const selectedSummary = useMemo(() => {
		if (!selectedTraceId) return null;
		return traces.find((trace) => trace.trace_id === selectedTraceId) || null;
	}, [traces, selectedTraceId]);

	const eventBySpanId = useMemo(() => {
		return new Map(traceEvents.map((event) => [event.span_id, event] as const));
	}, [traceEvents]);

	const selectedEvent = selectedSpanId
		? eventBySpanId.get(selectedSpanId) || null
		: null;

	const graphNodesById = useMemo(() => {
		const graph = traceGraphQuery.data;
		if (!graph) return new Map<string, TraceGraphNode>();
		return new Map(graph.nodes.map((node) => [node.id, node] as const));
	}, [traceGraphQuery.data]);

	const treeRoots = useMemo(() => {
		const graph = traceGraphQuery.data;
		if (!graph) return [];
		const hasParent = new Set(graph.edges.map((edge) => edge.target));
		const roots = graph.nodes
			.filter((node) => !hasParent.has(node.id))
			.map((node) => node.id);
		return roots.length > 0 ? roots : graph.nodes.map((node) => node.id);
	}, [traceGraphQuery.data]);

	const childrenByParent = useMemo(() => {
		const graph = traceGraphQuery.data;
		const children = new Map<string, string[]>();
		if (!graph) return children;
		for (const edge of graph.edges) {
			if (!children.has(edge.source)) {
				children.set(edge.source, []);
			}
			children.get(edge.source)?.push(edge.target);
		}
		return children;
	}, [traceGraphQuery.data]);

	const timeline = useMemo(() => {
		if (traceEvents.length === 0) {
			return null;
		}
		const minTs = Math.min(...traceEvents.map((event) => event.ts_start));
		const maxTs = Math.max(
			...traceEvents.map((event) => event.ts_end ?? event.ts_start),
		);
		const duration = Math.max(1, maxTs - minTs);
		const lanes: Record<TraceLane, TraceEvent[]> = {
			orchestrator: [],
			model: [],
			tool: [],
		};

		for (const event of traceEvents) {
			lanes[laneForEvent(event)].push(event);
		}
		for (const lane of TRACE_LANES) {
			lanes[lane].sort((a, b) => a.ts_start - b.ts_start);
		}

		return {
			minTs,
			maxTs,
			duration,
			lanes,
		};
	}, [traceEvents]);

	const timelineWidth = Math.max(900, Math.round(900 * zoom));
	const sequence = useMemo(() => {
		if (traceEvents.length === 0) return null;

		const bySpan = new Map(
			traceEvents.map((event) => [event.span_id, event] as const),
		);
		const ordered = [...traceEvents].sort((a, b) => a.ts_start - b.ts_start);
		const participants: string[] = [];
		const indexes = new Map<string, number>();

		const ensureParticipant = (actor: string) => {
			if (indexes.has(actor)) return indexes.get(actor) as number;
			const index = participants.length;
			participants.push(actor);
			indexes.set(actor, index);
			return index;
		};

		const steps = ordered.map((event) => {
			const targetActor = event.actor || "unknown";
			const parent = event.parent_span_id
				? bySpan.get(event.parent_span_id)
				: undefined;
			const sourceActor =
				parent?.actor ||
				(event.type === "user_input" ? "client" : "orchestrator");
			const sourceIndex = ensureParticipant(sourceActor);
			const targetIndex = ensureParticipant(targetActor);
			return {
				event,
				sourceActor,
				targetActor,
				sourceIndex,
				targetIndex,
				label: getEventSequenceLabel(event),
			};
		});

		return {
			participants,
			steps,
		};
	}, [traceEvents]);
	const sequenceColWidth = 180;
	const sequenceWidth = sequence
		? Math.max(780, sequence.participants.length * sequenceColWidth)
		: 780;
	const totalPages = pagination
		? Math.max(1, Math.ceil(pagination.total / pagination.page_size))
		: 1;

	const resetFilters = () => {
		setPage(1);
		setStatusFilter("all");
		setModelFilter("");
		setProjectPathFilter("");
		setDateFrom("");
		setDateTo("");
	};

	const toggleLane = (lane: TraceLane) => {
		setVisibleLanes((prev) => {
			const next = new Set(prev);
			if (next.has(lane)) {
				if (next.size === 1) return next;
				next.delete(lane);
				return next;
			}
			next.add(lane);
			return next;
		});
	};

	const renderTreeRows = (
		nodeId: string,
		depth: number,
		visited: Set<string>,
	): ReactNode[] => {
		if (visited.has(nodeId)) {
			return [];
		}
		const node = graphNodesById.get(nodeId);
		if (!node) {
			return [];
		}
		const nextVisited = new Set(visited);
		nextVisited.add(nodeId);
		const event = eventBySpanId.get(node.id);
		const row = (
			<button
				key={node.id}
				type="button"
				className={cn(
					"w-full rounded border px-2 py-1.5 text-left transition-colors",
					selectedSpanId === node.id
						? "border-primary bg-primary/10"
						: "hover:bg-muted/60",
				)}
				style={{ marginLeft: `${depth * 14}px` }}
				onClick={() => setSelectedSpanId(node.id)}
			>
				<div className="flex flex-wrap items-center gap-2">
					<Badge variant={eventTypeVariant(node.type)}>{node.type}</Badge>
					<Badge variant={statusVariant(node.status)}>
						{node.status || "ok"}
					</Badge>
					<span className="text-xs text-muted-foreground">{node.id}</span>
				</div>
				<div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
					<span>{node.label}</span>
					{event?.actor && <span>actor: {event.actor}</span>}
					<span>
						latency:{" "}
						{formatLatency(getEventLatency(event || ({} as TraceEvent)))}
					</span>
					{typeof node.metrics?.total_tokens === "number" && (
						<span>tokens: {formatTokens(node.metrics.total_tokens)}</span>
					)}
				</div>
			</button>
		);

		const children = childrenByParent.get(nodeId) || [];
		const childRows = children.flatMap((child) =>
			renderTreeRows(child, depth + 1, nextVisited),
		);
		return [row, ...childRows];
	};

	return (
		<div className="space-y-4">
			<Card>
				<CardHeader>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div>
							<CardTitle>Trace Filters</CardTitle>
							<CardDescription>
								Filter trace chain by status, model, project path, and time.
							</CardDescription>
						</div>
						<div className="flex items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() => tracesQuery.refetch()}
							>
								<RefreshCw className="h-4 w-4 mr-1.5" />
								Refresh
							</Button>
							<Button variant="ghost" size="sm" onClick={resetFilters}>
								Clear
							</Button>
						</div>
					</div>
				</CardHeader>
				<CardContent>
					<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
						<div>
							<Label className="text-xs mb-1.5 inline-block">Status</Label>
							<Select
								value={statusFilter}
								onValueChange={(value) => {
									setPage(1);
									setStatusFilter(value as StatusFilter);
								}}
							>
								<SelectTrigger className="h-9">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All</SelectItem>
									<SelectItem value="ok">OK</SelectItem>
									<SelectItem value="error">Error</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div>
							<Label className="text-xs mb-1.5 inline-block">Model</Label>
							<div className="relative">
								<Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
								<Input
									className="h-9 pl-8"
									placeholder="claude-3-7-sonnet"
									value={modelFilter}
									onChange={(event) => {
										setPage(1);
										setModelFilter(event.target.value);
									}}
								/>
							</div>
						</div>
						<div className="md:col-span-2">
							<Label className="text-xs mb-1.5 inline-block">
								Project Path
							</Label>
							<Input
								className="h-9"
								placeholder="D:\\codes\\xh\\better-ccflare"
								value={projectPathFilter}
								onChange={(event) => {
									setPage(1);
									setProjectPathFilter(event.target.value);
								}}
							/>
						</div>
						<div>
							<Label className="text-xs mb-1.5 inline-block">From</Label>
							<Input
								className="h-9"
								type="datetime-local"
								value={dateFrom}
								onChange={(event) => {
									setPage(1);
									setDateFrom(event.target.value);
								}}
							/>
						</div>
						<div>
							<Label className="text-xs mb-1.5 inline-block">To</Label>
							<Input
								className="h-9"
								type="datetime-local"
								value={dateTo}
								onChange={(event) => {
									setPage(1);
									setDateTo(event.target.value);
								}}
							/>
						</div>
					</div>
				</CardContent>
			</Card>

			{tracesQuery.isLoading ? (
				<Card>
					<CardContent className="pt-6 text-muted-foreground">
						Loading traces...
					</CardContent>
				</Card>
			) : tracesQuery.error ? (
				<Card>
					<CardContent className="pt-6 text-destructive">
						{tracesQuery.error instanceof Error
							? tracesQuery.error.message
							: String(tracesQuery.error)}
					</CardContent>
				</Card>
			) : (
				<div className="grid grid-cols-1 2xl:grid-cols-[420px_minmax(0,1fr)] gap-4">
					<Card className="h-fit">
						<CardHeader>
							<div className="flex items-center justify-between">
								<div>
									<CardTitle>Traces</CardTitle>
									<CardDescription>
										{pagination
											? `${pagination.total} total`
											: `${traces.length} total`}
									</CardDescription>
								</div>
								<div className="flex items-center gap-2">
									<Select
										value={String(pageSize)}
										onValueChange={(value) => {
											setPage(1);
											setPageSize(Number(value));
										}}
									>
										<SelectTrigger className="h-8 w-[86px]">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="20">20 / page</SelectItem>
											<SelectItem value="50">50 / page</SelectItem>
											<SelectItem value="100">100 / page</SelectItem>
										</SelectContent>
									</Select>
									<Button
										variant="outline"
										size="sm"
										disabled={page <= 1}
										onClick={() => setPage((prev) => Math.max(1, prev - 1))}
									>
										Prev
									</Button>
									<Button
										variant="outline"
										size="sm"
										disabled={page >= totalPages}
										onClick={() =>
											setPage((prev) => Math.min(totalPages, prev + 1))
										}
									>
										Next
									</Button>
								</div>
							</div>
						</CardHeader>
						<CardContent>
							<div className="max-h-[74vh] overflow-auto space-y-2 pr-1">
								{traces.length === 0 ? (
									<p className="text-sm text-muted-foreground">
										No traces found.
									</p>
								) : (
									traces.map((trace) => {
										const active = selectedTraceId === trace.trace_id;
										return (
											<button
												key={trace.trace_id}
												type="button"
												className={cn(
													"w-full rounded-lg border p-3 text-left transition-colors",
													active
														? "border-primary bg-primary/10"
														: "hover:bg-muted/60",
												)}
												onClick={() => setSelectedTraceId(trace.trace_id)}
											>
												<div className="flex flex-wrap items-center gap-2">
													<Badge variant={statusVariant(trace.status)}>
														{trace.status}
													</Badge>
													<Badge variant="outline">{trace.trace_id}</Badge>
													{trace.project_path && (
														<Badge variant="secondary">
															{trace.project_path}
														</Badge>
													)}
												</div>
												<div className="mt-2 grid grid-cols-2 gap-1 text-xs text-muted-foreground">
													<span>
														<Clock className="inline-block h-3 w-3 mr-1" />
														{formatTimestamp(trace.started_at)}
													</span>
													<span>
														<Timer className="inline-block h-3 w-3 mr-1" />
														{formatLatency(trace.latency_ms)}
													</span>
													<span>
														<Wrench className="inline-block h-3 w-3 mr-1" />
														tool calls: {trace.tool_call_count}
													</span>
													<span>
														<SquareDashedBottomCode className="inline-block h-3 w-3 mr-1" />
														rounds: {trace.round_count}
													</span>
													<span>
														tokens: {formatTokens(trace.total_tokens)}
													</span>
													<span>cost: {formatCost(trace.cost_estimate)}</span>
												</div>
												{trace.model_set.length > 0 && (
													<div className="mt-2 flex flex-wrap gap-1">
														{trace.model_set.map((model) => (
															<Badge
																key={`${trace.trace_id}-${model}`}
																variant="outline"
															>
																{model}
															</Badge>
														))}
													</div>
												)}
											</button>
										);
									})
								)}
							</div>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div>
									<CardTitle>Trace Detail</CardTitle>
									<CardDescription>
										{selectedSummary
											? `Trace ${selectedSummary.trace_id}`
											: "Select a trace from the list"}
									</CardDescription>
								</div>
								{selectedSummary && (
									<div className="flex flex-wrap gap-2">
										<Badge variant={statusVariant(selectedSummary.status)}>
											{selectedSummary.status}
										</Badge>
										<Badge variant="outline">
											latency: {formatLatency(selectedSummary.latency_ms)}
										</Badge>
										<Badge variant="outline">
											tokens: {formatTokens(selectedSummary.total_tokens)}
										</Badge>
										<Badge variant="outline">
											cost: {formatCost(selectedSummary.cost_estimate)}
										</Badge>
									</div>
								)}
							</div>
						</CardHeader>
						<CardContent>
							{!selectedSummary ? (
								<p className="text-sm text-muted-foreground">
									No trace selected.
								</p>
							) : traceDetailQuery.isLoading || traceGraphQuery.isLoading ? (
								<p className="text-sm text-muted-foreground">
									Loading trace detail...
								</p>
							) : traceDetailQuery.error ? (
								<p className="text-sm text-destructive">
									{traceDetailQuery.error instanceof Error
										? traceDetailQuery.error.message
										: String(traceDetailQuery.error)}
								</p>
							) : traceGraphQuery.error ? (
								<p className="text-sm text-destructive">
									{traceGraphQuery.error instanceof Error
										? traceGraphQuery.error.message
										: String(traceGraphQuery.error)}
								</p>
							) : (
								<Tabs defaultValue="tree">
									<TabsList>
										<TabsTrigger value="tree">
											<GitBranch className="h-4 w-4 mr-1.5" />
											Tree
										</TabsTrigger>
										<TabsTrigger value="timeline">
											<Timer className="h-4 w-4 mr-1.5" />
											Timeline
										</TabsTrigger>
										<TabsTrigger value="sequence">
											<ArrowRightLeft className="h-4 w-4 mr-1.5" />
											Sequence
										</TabsTrigger>
										<TabsTrigger value="events">
											<Filter className="h-4 w-4 mr-1.5" />
											Events
										</TabsTrigger>
									</TabsList>

									<TabsContent value="tree">
										<div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-4">
											<div className="border rounded-lg p-3 space-y-2 max-h-[62vh] overflow-auto">
												{treeRoots.length === 0 ? (
													<p className="text-sm text-muted-foreground">
														No graph nodes.
													</p>
												) : (
													treeRoots.flatMap((root) =>
														renderTreeRows(root, 0, new Set()),
													)
												)}
											</div>
											<EventPayloadPanel event={selectedEvent} />
										</div>
									</TabsContent>

									<TabsContent value="timeline">
										<div className="space-y-3">
											<div className="flex flex-wrap items-center gap-3">
												<div className="flex items-center gap-2">
													<Label className="text-xs">Zoom</Label>
													<Input
														type="range"
														min="1"
														max="4"
														step="0.25"
														value={zoom}
														onChange={(event) => {
															setZoom(Number(event.target.value));
														}}
														className="w-40 h-8"
													/>
													<span className="text-xs text-muted-foreground">
														{zoom.toFixed(2)}x
													</span>
												</div>
												<div className="flex flex-wrap items-center gap-2">
													{TRACE_LANES.map((lane) => (
														<Button
															key={lane}
															type="button"
															variant={
																visibleLanes.has(lane) ? "secondary" : "outline"
															}
															size="sm"
															onClick={() => toggleLane(lane)}
														>
															{laneLabel(lane)}
														</Button>
													))}
												</div>
											</div>

											{timeline ? (
												<div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-4">
													<div className="border rounded-lg p-3 overflow-auto">
														<div
															style={{ width: `${timelineWidth}px` }}
															className="space-y-4"
														>
															{TRACE_LANES.filter((lane) =>
																visibleLanes.has(lane),
															).map((lane) => (
																<div key={lane}>
																	<p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
																		{laneLabel(lane)}
																	</p>
																	<div className="relative h-12 rounded border bg-muted/30 overflow-hidden">
																		{timeline.lanes[lane].map((event) => {
																			const endTs =
																				event.ts_end ?? event.ts_start;
																			const eventDuration = Math.max(
																				1,
																				endTs - event.ts_start,
																			);
																			const left = Math.max(
																				0,
																				Math.round(
																					((event.ts_start - timeline.minTs) /
																						timeline.duration) *
																						timelineWidth,
																				),
																			);
																			const width = Math.max(
																				14,
																				Math.round(
																					(eventDuration / timeline.duration) *
																						timelineWidth,
																				),
																			);
																			return (
																				<button
																					key={event.span_id}
																					type="button"
																					className={cn(
																						"absolute top-1 h-10 rounded px-2 text-left text-[11px] overflow-hidden border",
																						selectedSpanId === event.span_id
																							? "border-primary bg-primary/20"
																							: event.status === "error"
																								? "border-destructive/50 bg-destructive/15"
																								: "border-primary/30 bg-primary/10",
																					)}
																					style={{
																						left: `${left}px`,
																						width: `${width}px`,
																					}}
																					onClick={() =>
																						setSelectedSpanId(event.span_id)
																					}
																					title={`${event.type} (${formatLatency(getEventLatency(event))})`}
																				>
																					<div className="whitespace-nowrap">
																						{event.type}
																					</div>
																					<div className="text-[10px] text-muted-foreground">
																						{formatLatency(
																							getEventLatency(event),
																						)}
																					</div>
																				</button>
																			);
																		})}
																	</div>
																</div>
															))}
														</div>
													</div>
													<EventPayloadPanel event={selectedEvent} />
												</div>
											) : (
												<p className="text-sm text-muted-foreground">
													No timeline events.
												</p>
											)}
										</div>
									</TabsContent>

									<TabsContent value="sequence">
										{!sequence ? (
											<p className="text-sm text-muted-foreground">
												No sequence events.
											</p>
										) : (
											<div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-4">
												<div className="border rounded-lg overflow-auto">
													<div
														className="min-w-max"
														style={{ width: `${sequenceWidth}px` }}
													>
														<div
															className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur"
															style={{
																display: "grid",
																gridTemplateColumns: `repeat(${sequence.participants.length}, minmax(0, 1fr))`,
															}}
														>
															{sequence.participants.map((actor) => (
																<div
																	key={actor}
																	className="px-2 py-2 text-xs font-medium text-center text-muted-foreground border-r last:border-r-0"
																>
																	{actorDisplayName(actor)}
																</div>
															))}
														</div>

														<div>
															{sequence.steps.map((step) => {
																const sourceX =
																	step.sourceIndex * sequenceColWidth +
																	sequenceColWidth / 2;
																const targetX =
																	step.targetIndex * sequenceColWidth +
																	sequenceColWidth / 2;
																const isSelected =
																	selectedSpanId === step.event.span_id;
																const lineLeft = Math.min(sourceX, targetX);
																const lineWidth = Math.abs(targetX - sourceX);
																const arrowToRight = targetX >= sourceX;
																const latency = getEventLatency(step.event);
																return (
																	<button
																		key={step.event.span_id}
																		type="button"
																		className={cn(
																			"relative block w-full h-16 border-b transition-colors",
																			isSelected
																				? "bg-primary/10"
																				: "hover:bg-muted/50",
																		)}
																		onClick={() =>
																			setSelectedSpanId(step.event.span_id)
																		}
																	>
																		{sequence.participants.map(
																			(actor, index) => (
																				<div
																					key={`${step.event.span_id}-${actor}`}
																					className="absolute top-0 bottom-0 w-px bg-border/60"
																					style={{
																						left: `${index * sequenceColWidth + sequenceColWidth / 2}px`,
																					}}
																				/>
																			),
																		)}

																		{lineWidth === 0 ? (
																			<div
																				className={cn(
																					"absolute h-6 w-6 border-2 rounded-full",
																					step.event.status === "error"
																						? "border-destructive"
																						: "border-primary",
																				)}
																				style={{
																					left: `${targetX - 12}px`,
																					top: "20px",
																				}}
																			/>
																		) : (
																			<>
																				<div
																					className={cn(
																						"absolute h-0.5",
																						step.event.status === "error"
																							? "bg-destructive"
																							: "bg-primary",
																					)}
																					style={{
																						left: `${lineLeft}px`,
																						width: `${lineWidth}px`,
																						top: "31px",
																					}}
																				/>
																				<div
																					className={cn(
																						"absolute w-0 h-0 border-y-[5px] border-y-transparent",
																						arrowToRight
																							? step.event.status === "error"
																								? "border-l-[8px] border-l-destructive"
																								: "border-l-[8px] border-l-primary"
																							: step.event.status === "error"
																								? "border-r-[8px] border-r-destructive"
																								: "border-r-[8px] border-r-primary",
																					)}
																					style={{
																						left: arrowToRight
																							? `${targetX - 1}px`
																							: `${targetX - 7}px`,
																						top: "26px",
																					}}
																				/>
																			</>
																		)}

																		<div
																			className="absolute -translate-x-1/2 px-2 py-1 rounded border bg-background text-[11px] whitespace-nowrap"
																			style={{
																				left: `${(sourceX + targetX) / 2}px`,
																				top: "8px",
																			}}
																		>
																			<div className="font-medium">
																				{step.event.type}
																			</div>
																			<div className="text-muted-foreground">
																				{step.label}
																				{latency > 0
																					? ` · ${formatLatency(latency)}`
																					: ""}
																			</div>
																		</div>
																	</button>
																);
															})}
														</div>
													</div>
												</div>
												<EventPayloadPanel event={selectedEvent} />
											</div>
										)}
									</TabsContent>

									<TabsContent value="events">
										<div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-4">
											<div className="border rounded-lg max-h-[62vh] overflow-auto">
												<table className="w-full text-sm">
													<thead className="sticky top-0 bg-card border-b">
														<tr>
															<th className="text-left p-2">Type</th>
															<th className="text-left p-2">Actor</th>
															<th className="text-left p-2">Status</th>
															<th className="text-left p-2">Start</th>
															<th className="text-left p-2">Latency</th>
														</tr>
													</thead>
													<tbody>
														{traceEvents.map((event) => (
															<tr
																key={event.span_id}
																className={cn(
																	"border-b cursor-pointer hover:bg-muted/50",
																	selectedSpanId === event.span_id &&
																		"bg-primary/10",
																)}
																onClick={() => setSelectedSpanId(event.span_id)}
															>
																<td className="p-2">
																	<Badge variant={eventTypeVariant(event.type)}>
																		{event.type}
																	</Badge>
																</td>
																<td className="p-2">{event.actor}</td>
																<td className="p-2">
																	<Badge variant={statusVariant(event.status)}>
																		{event.status || "ok"}
																	</Badge>
																</td>
																<td className="p-2">
																	{formatTimestamp(event.ts_start)}
																</td>
																<td className="p-2">
																	{formatLatency(getEventLatency(event))}
																</td>
															</tr>
														))}
													</tbody>
												</table>
											</div>
											<EventPayloadPanel event={selectedEvent} />
										</div>
									</TabsContent>
								</Tabs>
							)}
						</CardContent>
					</Card>
				</div>
			)}
		</div>
	);
}
