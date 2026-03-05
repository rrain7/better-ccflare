import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	getPlatformConfigDir,
	getPlatformDataDir,
} from "@better-ccflare/config";

export function resolveDbPath(): string {
	// Check for explicit DB path from environment (support both old and new env var names)
	const explicitPath =
		process.env.BETTER_CCFLARE_DB_PATH || process.env.ccflare_DB_PATH;
	if (explicitPath) {
		return explicitPath;
	}

	// Preferred default: OS data directory.
	const dataDir = getPlatformDataDir();
	const preferredPath = join(dataDir, "better-ccflare.db");
	if (existsSync(preferredPath)) {
		return preferredPath;
	}

	// Backward compatibility: if old config-dir DB exists, keep using it.
	const legacyDefaultPath = join(getPlatformConfigDir(), "better-ccflare.db");
	if (existsSync(legacyDefaultPath)) {
		return legacyDefaultPath;
	}

	// Fresh install path (data directory).
	return preferredPath;
}

export function getLegacyDbPath(): string {
	const { getLegacyConfigDir } = require("@better-ccflare/config");
	const legacyConfigDir = getLegacyConfigDir();
	return join(legacyConfigDir, "ccflare.db");
}
