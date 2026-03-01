export type TraceEventType =
	| "user_input"
	| "orchestration_decision"
	| "llm_request"
	| "llm_response"
	| "tool_call"
	| "tool_result"
	| "error";

export type TraceEventStatus = "ok" | "error";

export interface TraceEventMetrics {
	latency_ms?: number;
	prompt_tokens?: number;
	completion_tokens?: number;
	total_tokens?: number;
	cost_estimate?: number;
}

export interface TraceEvent {
	trace_id: string;
	span_id: string;
	parent_span_id?: string;
	request_id?: string;
	round_id?: number;
	type: TraceEventType;
	actor: string;
	ts_start: number;
	ts_end?: number;
	status?: TraceEventStatus;
	payload: Record<string, unknown>;
	metrics?: TraceEventMetrics;
	tags?: Record<string, string>;
}

export interface TraceSummary {
	trace_id: string;
	started_at: number;
	ended_at: number;
	status: TraceEventStatus;
	project_path?: string;
	model_set: string[];
	round_count: number;
	tool_call_count: number;
	latency_ms: number;
	total_tokens: number;
	cost_estimate: number;
}

export interface TracePagination {
	page: number;
	page_size: number;
	total: number;
}

export interface TraceListResponse {
	items: TraceSummary[];
	pagination: TracePagination;
}

export interface TraceGraphNode {
	id: string;
	type: TraceEventType;
	label: string;
	round_id?: number;
	status?: TraceEventStatus;
	ts_start: number;
	ts_end?: number;
	metrics?: TraceEventMetrics;
}

export interface TraceGraphEdge {
	id: string;
	source: string;
	target: string;
	kind: "parent_child";
}

export interface TraceGraph {
	trace_id: string;
	nodes: TraceGraphNode[];
	edges: TraceGraphEdge[];
}

export interface TraceStats {
	trace_id: string;
	status: TraceEventStatus;
	latency_ms: number;
	round_count: number;
	tool_call_count: number;
	token_usage: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
	cost_estimate: number;
	error_summary: {
		count: number;
		first_error_span_id?: string;
		first_error_type?: string;
	};
}
