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
 * No model list is passed, so pi's full, auto-updated Anthropic catalog is
 * preserved. API-key users are unaffected: impersonation only activates for
 * Claude Code OAuth tokens.
 *
 * See README.md for details.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { login, refreshCredentials } from "./src/credentials.ts";
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
}
