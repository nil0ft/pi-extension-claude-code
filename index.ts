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
 * It also disables pi's now-misleading built-in extra-usage warning and instead
 * watches real response headers to report the true billing pool: it warns only if
 * requests actually fall through to extra usage, or if your plan limit is reached.
 *
 * See README.md for details.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describeBilling, getLastBilling, setBillingNotifier } from "./src/billing.ts";
import { login, refreshCredentials } from "./src/credentials.ts";
import { disablePiExtraUsageWarning } from "./src/settings.ts";
import { streamClaudeCode } from "./src/stream.ts";

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
	// active; suppress it and rely on the header-based monitor instead.
	disablePiExtraUsageWarning();

	// Route billing-state transitions (extra-usage detected, plan limit reached)
	// to the UI. The notifier is wired once a session with UI is available.
	pi.on("session_start", (_event, ctx) => {
		setBillingNotifier(
			ctx.hasUI ? (message, type) => ctx.ui.notify(message, type) : undefined,
		);
	});

	// On-demand status, based on the most recent real response (no synthetic probe).
	pi.registerCommand("claude-code", {
		description: "Show Claude Code subscription billing status",
		handler: async (_args, ctx) => {
			const snapshot = getLastBilling();
			const type = snapshot?.pool === "extra-usage" ? "error" : "info";
			ctx.ui.notify(`Claude Code: ${describeBilling(snapshot)}`, type);
		},
	});
}
