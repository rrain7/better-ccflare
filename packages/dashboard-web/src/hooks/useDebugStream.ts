import type { TraceEvent } from "@better-ccflare/types";
import { useEffect, useState } from "react";

const MAX_RETRIES = 10;
const MAX_REQUEST_BUCKETS = 100;
const MAX_EVENTS_PER_REQUEST = 200;

type DebugStreamPayload = {
	type: "trace_events";
	requestId: string | null;
	traceId: string;
	events: TraceEvent[];
	source: "request_start" | "worker" | "native_tool_logging";
};

export type DebugRequestEventBucket = {
	traceId: string;
	events: TraceEvent[];
	updatedAt: number;
};

function mergeEvents(
	existing: TraceEvent[],
	incoming: TraceEvent[],
): TraceEvent[] {
	const merged = new Map<string, TraceEvent>();
	for (const event of existing) {
		merged.set(`${event.trace_id}:${event.span_id}`, event);
	}
	for (const event of incoming) {
		merged.set(`${event.trace_id}:${event.span_id}`, event);
	}

	return Array.from(merged.values())
		.sort((left, right) => {
			if (left.ts_start !== right.ts_start) {
				return left.ts_start - right.ts_start;
			}
			return left.span_id.localeCompare(right.span_id);
		})
		.slice(-MAX_EVENTS_PER_REQUEST);
}

function pruneBuckets(
	current: Record<string, DebugRequestEventBucket>,
): Record<string, DebugRequestEventBucket> {
	const entries = Object.entries(current);
	if (entries.length <= MAX_REQUEST_BUCKETS) {
		return current;
	}

	return Object.fromEntries(
		entries
			.sort((left, right) => right[1].updatedAt - left[1].updatedAt)
			.slice(0, MAX_REQUEST_BUCKETS),
	);
}

export function useDebugStream(enabled = true) {
	const [eventsByRequestId, setEventsByRequestId] = useState<
		Record<string, DebugRequestEventBucket>
	>({});

	useEffect(() => {
		if (!enabled) {
			return;
		}

		let eventSource: EventSource | null = null;
		let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
		let retryCount = 0;
		let isClosed = false;

		const connect = () => {
			if (isClosed) return;

			eventSource = new EventSource("/api/debug/stream");

			eventSource.addEventListener("open", () => {
				retryCount = 0;
			});

			eventSource.addEventListener("message", (event) => {
				let payload: DebugStreamPayload;
				try {
					payload = JSON.parse(event.data) as DebugStreamPayload;
				} catch {
					return;
				}

				if (payload.type !== "trace_events" || !payload.requestId) {
					return;
				}

				setEventsByRequestId((current) => {
					const existing = current[payload.requestId!];
					const next = {
						...current,
						[payload.requestId!]: {
							traceId: payload.traceId,
							updatedAt: Date.now(),
							events: mergeEvents(existing?.events || [], payload.events),
						},
					};
					return pruneBuckets(next);
				});
			});

			eventSource.addEventListener("error", () => {
				if (eventSource) {
					eventSource.close();
					eventSource = null;
				}

				if (isClosed || retryCount >= MAX_RETRIES) {
					return;
				}

				const delay = Math.min(1000 * 2 ** retryCount, 30000);
				retryCount += 1;
				reconnectTimer = setTimeout(() => {
					connect();
				}, delay);
			});
		};

		connect();

		return () => {
			isClosed = true;
			if (reconnectTimer) {
				clearTimeout(reconnectTimer);
			}
			if (eventSource) {
				eventSource.close();
			}
		};
	}, [enabled]);

	return {
		eventsByRequestId,
	};
}
