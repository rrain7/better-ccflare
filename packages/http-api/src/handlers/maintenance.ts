import type { Config } from "@better-ccflare/config";
import type { DatabaseOperations } from "@better-ccflare/database";
import { jsonResponse } from "@better-ccflare/http-common";
import type { CleanupResponse } from "../types";

export function createCleanupHandler(
	dbOps: DatabaseOperations,
	config: Config,
) {
	return (): Response => {
		const payloadDays = config.getDataRetentionDays();
		const requestDays = config.getRequestRetentionDays();
		const payloadMs = payloadDays * 24 * 60 * 60 * 1000;
		const requestMs = requestDays * 24 * 60 * 60 * 1000;
		const { removedRequests, removedPayloads, removedTraceEvents } =
			dbOps.cleanupOldRequests(payloadMs, requestMs);
		const payloadCutoffIso = new Date(Date.now() - payloadMs).toISOString();
		const requestCutoffIso = new Date(Date.now() - requestMs).toISOString();
		const payload: CleanupResponse = {
			removedRequests,
			removedPayloads,
			removedTraceEvents,
			payloadCutoffIso,
			requestCutoffIso,
			cutoffIso: requestCutoffIso,
		};
		return jsonResponse(payload);
	};
}

export function createCompactHandler(dbOps: DatabaseOperations) {
	return (): Response => {
		dbOps.compact();
		return jsonResponse({ ok: true });
	};
}
