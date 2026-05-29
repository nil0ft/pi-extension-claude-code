/**
 * claude-code — pi extension
 *
 * Makes pi behave as the official Claude Code CLI so that Anthropic requests
 * authenticated with a Claude Pro/Max OAuth token are billed against the
 * subscription plan instead of metered "extra usage".
 *
 * Rather than adding a separate provider (which leaves pi's built-in `anthropic`
 * provider selectable and billing extra usage when you switch models), this
 * overrides the built-in `anthropic` provider in place:
 *
 *   - Streaming for the `anthropic-messages` API is replaced with a Claude Code
 *     impersonating implementation. Pi resolves streaming globally by API type,
 *     so this covers every Anthropic model — switching models stays on-plan.
 *   - `/login` for `anthropic` imports/refreshes credentials from the Claude Code
 *     CLI session (with a browser OAuth fallback).
 *
 * It also disables pi's now-misleading built-in extra-usage warning and replaces
 * it with an accurate startup self-check that warns only if billing actually
 * falls back to extra usage (e.g. if Anthropic changes detection server-side).
 *
 * See README.md for details.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { login, refreshCredentials } from "./src/credentials.ts";
import { runSelfCheck, type SelfCheckResult } from "./src/selfcheck.ts";
import { disablePiExtraUsageWarning } from "./src/settings.ts";
import { streamClaudeCode } from "./src/stream.ts";

/** Maps a self-check result to a user-facing notification, or null if all good. */
function notifyForResult(ctx: ExtensionContext, result: SelfCheckResult): void {
	switch (result.status) {
		case "ok":
		case "skipped":
			return;
		case "auth":
			ctx.ui.notify(`Claude Code: ${result.message}`, "warning");
			return;
		default:
			ctx.ui.notify(`Claude Code: ${result.message}`, "error");
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerProvider("anthropic", {
		// Bind the stealth stream to the Anthropic Messages API. Pi keys streaming
		// on the API type, so this overrides every `anthropic-messages` model.
		api: "anthropic-messages",
		streamSimple: streamClaudeCode,
		// Use the Claude Code CLI session for /login and token refresh.
		oauth: {
			name: "Claude Code (Pro/Max via CLI session)",
			login,
			refreshToken: refreshCredentials,
			getApiKey: (credentials) => credentials.access,
		},
	});

	// pi's built-in extra-usage warning is misleading once this extension is
	// active; suppress it and rely on the self-check below instead.
	disablePiExtraUsageWarning();

	// Verify on startup that billing is actually on-plan. Runs async so it never
	// blocks the session, and is throttled internally to stay fast/cheap.
	pi.on("session_start", (_event, ctx) => {
		void runSelfCheck(false, ctx.signal)
			.then((result) => notifyForResult(ctx, result))
			.catch(() => {
				/* never let the self-check break a session */
			});
	});

	// On-demand status / re-check.
	pi.registerCommand("claude-code", {
		description: "Check whether Claude Code subscription billing is active",
		handler: async (_args, ctx) => {
			ctx.ui.setStatus("claude-code", "Checking subscription billing…");
			try {
				const result = await runSelfCheck(true, ctx.signal);
				if (result.status === "ok") {
					ctx.ui.notify(`Claude Code: ${result.message}`, "info");
				} else {
					notifyForResult(ctx, result);
				}
			} finally {
				ctx.ui.setStatus("claude-code", undefined);
			}
		},
	});
}
