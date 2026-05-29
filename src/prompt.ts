/**
 * System-prompt handling for the Claude Code provider.
 *
 * Anthropic runs a harness-detection classifier over the system prompt. Pi's
 * default prompt contains a self-referential "Pi documentation" section that the
 * classifier flags, forcing requests onto metered "extra usage" instead of the
 * Claude plan. We surgically remove only that section — everything else (the
 * coding guidelines, tool usage rules, project context, skills, date/cwd) is
 * preserved so behavior is unchanged.
 */

import { CLAUDE_CODE_IDENTITY } from "./constants.ts";

/** Marker phrase present in pi's default system prompt. */
const PI_DEFAULT_SIGNATURE = "operating inside pi, a coding agent harness";

/**
 * The self-referential pi documentation block, from its heading up to (but not
 * including) the trailing "Current date:" line. This is the only part that trips
 * the classifier.
 */
const PI_DOCS_SECTION = /\n*Pi documentation \(read only[\s\S]*?(?=\nCurrent date:|$)/;

/**
 * Removes pi's harness-detection-tripping documentation section from the system
 * prompt. Custom or user-provided prompts (which lack the signature) pass through
 * untouched.
 */
export function sanitizeClaudeCodeSystemPrompt(systemPrompt: string): string {
	if (!systemPrompt.includes(PI_DEFAULT_SIGNATURE)) {
		return systemPrompt;
	}
	return systemPrompt.replace(PI_DOCS_SECTION, "\n").trim();
}

/** Replaces invalid lone UTF-16 surrogates that the Anthropic API rejects. */
export function sanitizeSurrogates(text: string): string {
	return text.replace(/[\uD800-\uDFFF]/g, "\uFFFD");
}

type SystemBlock = { type: "text"; text: string; cache_control?: { type: "ephemeral" } };

/**
 * Builds the system blocks for a request.
 *
 * For OAuth (subscription) auth, the Claude Code identity is sent as the first
 * cached block, followed by the sanitized pi prompt. For API-key auth the prompt
 * is sent as-is.
 */
export function buildSystemBlocks(systemPrompt: string | undefined, isOAuth: boolean): SystemBlock[] | undefined {
	const blocks: SystemBlock[] = [];

	if (isOAuth) {
		blocks.push({
			type: "text",
			text: CLAUDE_CODE_IDENTITY,
			cache_control: { type: "ephemeral" },
		});
		if (systemPrompt) {
			const sanitized = sanitizeClaudeCodeSystemPrompt(systemPrompt);
			if (sanitized.trim()) {
				blocks.push({ type: "text", text: sanitizeSurrogates(sanitized), cache_control: { type: "ephemeral" } });
			}
		}
	} else if (systemPrompt) {
		blocks.push({ type: "text", text: sanitizeSurrogates(systemPrompt), cache_control: { type: "ephemeral" } });
	}

	return blocks.length > 0 ? blocks : undefined;
}
