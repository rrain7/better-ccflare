import { EventEmitter } from "node:events";
import type { TraceEvent } from "@better-ccflare/types";

export type DebugTraceEventsEvt = {
	type: "trace_events";
	requestId: string | null;
	traceId: string;
	events: TraceEvent[];
	source: "request_start" | "worker" | "native_tool_logging";
};

export type DebugEvt = DebugTraceEventsEvt;

class DebugEventBus extends EventEmitter {}

export const debugEvents = new DebugEventBus();

debugEvents.setMaxListeners(200);
