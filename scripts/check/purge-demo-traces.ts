#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { resolveDbPath } from "@better-ccflare/database";

interface Options {
	dbPath: string;
	prefix: string;
	dryRun: boolean;
	help: boolean;
}

function parseArgs(): Options {
	const args = process.argv.slice(2);
	const options: Options = {
		dbPath: resolveDbPath(),
		prefix: "tr_demo",
		dryRun: false,
		help: false,
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--help" || arg === "-h") {
			options.help = true;
			return options;
		}
		if (arg === "--db-path" && args[i + 1]) {
			options.dbPath = args[i + 1];
			i += 1;
			continue;
		}
		if (arg === "--prefix" && args[i + 1]) {
			options.prefix = args[i + 1];
			i += 1;
			continue;
		}
		if (arg === "--dry-run") {
			options.dryRun = true;
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}

	return options;
}

function main() {
	const options = parseArgs();
	if (options.help) {
		console.log(`
Usage:
  bun scripts/check/purge-demo-traces.ts [--db-path <path>] [--prefix <trace-prefix>] [--dry-run]

Default:
  prefix = tr_demo

Examples:
  bun scripts/check/purge-demo-traces.ts --dry-run
  bun scripts/check/purge-demo-traces.ts --prefix tr_demo --db-path /path/to/better-ccflare.db
		`.trim());
		return;
	}

	const db = new Database(options.dbPath);
	try {
		const totalBefore =
			(db.query("SELECT COUNT(*) AS count FROM trace_events").get() as {
				count: number;
			}).count || 0;
		const demoBefore =
			(
				db
					.query("SELECT COUNT(*) AS count FROM trace_events WHERE trace_id LIKE ?")
					.get(`${options.prefix}%`) as { count: number }
			).count || 0;

		if (demoBefore === 0) {
			console.log(
				`No demo traces found with prefix '${options.prefix}' in ${options.dbPath}`,
			);
			return;
		}

		if (options.dryRun) {
			console.log(
				[
					`[dry-run] Database: ${options.dbPath}`,
					`[dry-run] Total trace events: ${totalBefore}`,
					`[dry-run] Demo trace events to delete: ${demoBefore}`,
				].join("\n"),
			);
			return;
		}

		const result = db
			.prepare("DELETE FROM trace_events WHERE trace_id LIKE ?")
			.run(`${options.prefix}%`);

		const totalAfter =
			(db.query("SELECT COUNT(*) AS count FROM trace_events").get() as {
				count: number;
			}).count || 0;

		console.log(
			[
				`Database: ${options.dbPath}`,
				`Deleted demo trace events: ${result.changes}`,
				`Total trace events: ${totalBefore} -> ${totalAfter}`,
			].join("\n"),
		);
	} finally {
		db.close();
	}
}

if (import.meta.main) {
	main();
}

