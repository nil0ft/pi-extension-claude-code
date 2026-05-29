/**
 * Safe, idempotent edits to pi's global settings.
 *
 * Because this extension makes Anthropic subscription auth bill against the
 * Claude plan, pi's built-in "extra usage" warning is misleading. We disable it
 * once via `warnings.anthropicExtraUsage = false` and replace it with an accurate
 * self-check (see selfcheck.ts).
 *
 * pi persists settings by re-reading the file under a lock and writing back only
 * the fields modified during a session (merging nested keys individually), so an
 * external one-time write of this flag is preserved.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PI_AGENT_DIR } from "./constants.ts";

const SETTINGS_PATH = join(PI_AGENT_DIR, "settings.json");

/**
 * Disables pi's built-in Anthropic extra-usage warning, unless the user has
 * already set the flag explicitly. Returns true if a write was performed.
 *
 * Best-effort and non-throwing: any failure (missing file, parse error, no write
 * access) is swallowed so it can never break startup.
 */
export function disablePiExtraUsageWarning(): boolean {
	let raw: string;
	try {
		raw = readFileSync(SETTINGS_PATH, "utf8");
	} catch {
		return false; // No settings file yet; nothing to suppress.
	}

	let settings: { warnings?: Record<string, unknown> };
	try {
		settings = JSON.parse(raw);
	} catch {
		return false;
	}

	// Respect an explicit user choice (true or false).
	if (settings.warnings && "anthropicExtraUsage" in settings.warnings) {
		return false;
	}

	settings.warnings = { ...settings.warnings, anthropicExtraUsage: false };

	try {
		writeFileSync(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
		return true;
	} catch {
		return false;
	}
}
