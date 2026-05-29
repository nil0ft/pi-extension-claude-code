/**
 * claude-code — pi extension
 *
 * Registers a `claude-code` provider that makes pi behave as the official Claude
 * Code CLI, so requests authenticated with a Claude Pro/Max OAuth token are billed
 * against the subscription plan instead of metered "extra usage".
 *
 * Credentials are imported from the Claude Code CLI session
 * (`~/.claude/.credentials.json`) and refreshed via the CLI; a browser OAuth flow
 * is used as a fallback. See README.md for details.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ANTHROPIC_BASE_URL } from "./src/constants.ts";
import { login, refreshCredentials } from "./src/credentials.ts";
import { CLAUDE_CODE_MODELS } from "./src/models.ts";
import { streamClaudeCode } from "./src/stream.ts";

export default function (pi: ExtensionAPI) {
	pi.registerProvider("claude-code", {
		name: "Claude Code (subscription)",
		baseUrl: ANTHROPIC_BASE_URL,
		apiKey: "$ANTHROPIC_API_KEY",
		api: "claude-code-api",
		models: CLAUDE_CODE_MODELS,
		oauth: {
			name: "Claude Code (Pro/Max via CLI session)",
			login,
			refreshToken: refreshCredentials,
			getApiKey: (credentials) => credentials.access,
		},
		streamSimple: streamClaudeCode,
	});
}
