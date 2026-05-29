/**
 * Startup self-check.
 *
 * Verifies that Claude Code impersonation is still accepted by Anthropic and that
 * requests are billed against the subscription plan rather than metered "extra
 * usage". Anthropic can change server-side detection at any time; this turns a
 * silent regression into an explicit, actionable warning.
 *
 * A minimal request is sent through the same stealth path used for real traffic
 * (identity-only system prompt, Claude Code betas/headers). The result is cached
 * and successes are throttled so startup stays fast and cheap.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	ANTHROPIC_MESSAGES_URL,
	ANTHROPIC_VERSION,
	CLAUDE_CODE_BETAS,
	CLAUDE_CODE_IDENTITY,
	COMMON_BETAS,
	getClaudeCliUserAgent,
	PI_AGENT_DIR,
} from "./constants.ts";
import { tokenFromDisk } from "./credentials.ts";

export type SelfCheckStatus = "ok" | "extra-usage" | "auth" | "unknown" | "skipped";

export interface SelfCheckResult {
	status: SelfCheckStatus;
	/** Human-readable detail for warnings / the status command. */
	message: string;
	/** Epoch ms when the check ran. */
	checkedAt: number;
}

const CACHE_PATH = join(PI_AGENT_DIR, ".cache", "claude-code-selfcheck.json");

/** Re-run a passing check at most this often. Failures are always re-checked. */
const SUCCESS_TTL_MS = 12 * 60 * 60 * 1000;

const PROBE_MODEL = "claude-haiku-4-5";
const EXTRA_USAGE_PATTERN = /extra usage/i;

interface CacheEntry extends SelfCheckResult {
	userAgent: string;
}

function readCache(): CacheEntry | null {
	try {
		return JSON.parse(readFileSync(CACHE_PATH, "utf8")) as CacheEntry;
	} catch {
		return null;
	}
}

function writeCache(entry: CacheEntry): void {
	try {
		mkdirSync(join(PI_AGENT_DIR, ".cache"), { recursive: true });
		writeFileSync(CACHE_PATH, JSON.stringify(entry, null, 2), "utf8");
	} catch {
		// Caching is best-effort.
	}
}

/** Sends the minimal probe request and classifies the outcome. */
async function probe(signal?: AbortSignal): Promise<SelfCheckResult> {
	const checkedAt = Date.now();

	const credentials = await tokenFromDisk();
	if (!credentials?.access) {
		return { status: "skipped", message: "No Claude Code credentials found.", checkedAt };
	}

	const userAgent = await getClaudeCliUserAgent();
	let response: Response;
	try {
		response = await fetch(ANTHROPIC_MESSAGES_URL, {
			method: "POST",
			signal,
			headers: {
				"content-type": "application/json",
				accept: "application/json",
				"anthropic-version": ANTHROPIC_VERSION,
				"anthropic-beta": [...CLAUDE_CODE_BETAS, ...COMMON_BETAS].join(","),
				"anthropic-dangerous-direct-browser-access": "true",
				authorization: `Bearer ${credentials.access}`,
				"user-agent": userAgent,
				"x-app": "cli",
			},
			body: JSON.stringify({
				model: PROBE_MODEL,
				max_tokens: 1,
				system: [{ type: "text", text: CLAUDE_CODE_IDENTITY }],
				messages: [{ role: "user", content: "ok" }],
			}),
		});
	} catch (error) {
		return {
			status: "unknown",
			message: `Could not reach Anthropic: ${error instanceof Error ? error.message : String(error)}`,
			checkedAt,
		};
	}

	if (response.ok) {
		return { status: "ok", message: "Subscription billing is active.", checkedAt };
	}

	const bodyText = await response.text().catch(() => "");
	if (response.status === 400 && EXTRA_USAGE_PATTERN.test(bodyText)) {
		return {
			status: "extra-usage",
			message:
				"Anthropic is NOT billing this session against your plan — requests fall back to metered extra usage. " +
				"The Claude Code impersonation may have been blocked server-side; check for an extension update.",
			checkedAt,
		};
	}
	if (response.status === 401 || response.status === 403) {
		return {
			status: "auth",
			message: `Authentication rejected (HTTP ${response.status}). Run /login to refresh your Claude Code session.`,
			checkedAt,
		};
	}

	return {
		status: "unknown",
		message: `Unexpected response from Anthropic (HTTP ${response.status}).`,
		checkedAt,
	};
}

/**
 * Runs the self-check, using the cache to throttle successful results.
 *
 * @param force  Ignore the cache and always probe (used by the status command).
 */
export async function runSelfCheck(force = false, signal?: AbortSignal): Promise<SelfCheckResult> {
	if (!force) {
		const cached = readCache();
		const fresh = cached && Date.now() - cached.checkedAt < SUCCESS_TTL_MS;
		// Reuse only fresh successes; always re-probe past failures so recovery is detected.
		if (cached && fresh && cached.status === "ok") {
			return cached;
		}
	}

	const result = await probe(signal);
	writeCache({ ...result, userAgent: await getClaudeCliUserAgent() });
	return result;
}
