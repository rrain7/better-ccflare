import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { TraceEvent } from "@better-ccflare/types";
import { ensureSchema } from "../migrations";
import { TraceRepository } from "./trace.repository";

describe("TraceRepository cleanup", () => {
	let db: Database;
	let repository: TraceRepository;

	beforeEach(() => {
		db = new Database(":memory:");
		ensureSchema(db);
		repository = new TraceRepository(db);
	});

	afterEach(() => {
		db.close();
	});

	it("deletes only traces whose latest activity is older than the cutoff", () => {
		const oldTraceEvents: TraceEvent[] = [
			{
				trace_id: "tr_old",
				span_id: "sp_old_1",
				type: "user_input",
				actor: "user",
				ts_start: 1000,
				ts_end: 1000,
				status: "ok",
				payload: {},
			},
			{
				trace_id: "tr_old",
				span_id: "sp_old_2",
				parent_span_id: "sp_old_1",
				type: "llm_response",
				actor: "model:test",
				ts_start: 1500,
				ts_end: 2000,
				status: "ok",
				payload: {},
			},
		];

		const mixedAgeTraceEvents: TraceEvent[] = [
			{
				trace_id: "tr_recent",
				span_id: "sp_recent_1",
				type: "user_input",
				actor: "user",
				ts_start: 1000,
				ts_end: 1000,
				status: "ok",
				payload: {},
			},
			{
				trace_id: "tr_recent",
				span_id: "sp_recent_2",
				parent_span_id: "sp_recent_1",
				type: "llm_response",
				actor: "model:test",
				ts_start: 4000,
				ts_end: 5000,
				status: "ok",
				payload: {},
			},
		];

		repository.saveEvents([...oldTraceEvents, ...mixedAgeTraceEvents]);

		const deleted = repository.deleteTracesOlderThan(3000);

		expect(deleted).toBe(2);
		expect(repository.getTraceEvents("tr_old")).toHaveLength(0);
		expect(repository.getTraceEvents("tr_recent")).toHaveLength(2);
	});
});
