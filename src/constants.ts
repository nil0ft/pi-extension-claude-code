/**
 * Static configuration for the Claude Code provider.
 *
 * These values mirror what the official Claude Code CLI sends so that requests
 * authenticated with a Claude Pro/Max OAuth token are recognized as first-party
 * CLI traffic and billed against the subscription plan.
 */

import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Public OAuth client ID used by the Claude Code CLI. */
export const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

/** OAuth endpoints (used only by the browser-login fallback / endpoint refresh). */
export const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
export const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
export const REDIRECT_URI = "https://platform.claude.com/oauth/code/callback";
export const OAUTH_SCOPES = "user:profile user:inference user:sessions:claude_code user:mcp_servers";

/** Credentials file written by the official Claude Code CLI. */
export const CLAUDE_CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");

/** Beta flags required for the Claude Code OAuth surface. */
export const CLAUDE_CODE_BETAS = ["claude-code-20250219", "oauth-2025-04-20"] as const;

/** Beta flags shared by both OAuth and API-key requests. */
export const COMMON_BETAS = ["fine-grained-tool-streaming-2025-05-14", "interleaved-thinking-2025-05-14"] as const;

/** System-prompt identity line that marks the session as Claude Code. */
export const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";

/**
 * Tool names the Claude Code surface expects. Pi's tools are mapped onto these
 * canonical names on the way out and mapped back on the way in.
 */
export const CLAUDE_CODE_TOOLS = [
	"Read",
	"Write",
	"Edit",
	"Bash",
	"Grep",
	"Glob",
	"AskUserQuestion",
	"TodoWrite",
	"WebFetch",
	"WebSearch",
] as const;

/** Default thinking budgets (tokens) keyed by pi thinking level. */
export const DEFAULT_THINKING_BUDGETS: Record<string, number> = {
	minimal: 1024,
	low: 4096,
	medium: 10240,
	high: 20480,
	xhigh: 32768,
};

/** Fallback CLI version used in the User-Agent if the real one can't be read. */
const FALLBACK_CLI_VERSION = "2.1.154";

let cachedUserAgent: string | undefined;

/**
 * Returns the User-Agent to impersonate, e.g. `claude-cli/2.1.154 (external, cli)`.
 *
 * Resolves the locally installed Claude Code CLI version once (best effort) so the
 * impersonation matches the user's actual install, then caches the result.
 */
export async function getClaudeCliUserAgent(): Promise<string> {
	if (cachedUserAgent) return cachedUserAgent;

	let version = FALLBACK_CLI_VERSION;
	try {
		const { stdout } = await execFileAsync("claude", ["--version"], { timeout: 5_000 });
		const match = stdout.match(/(\d+\.\d+\.\d+)/);
		if (match) version = match[1];
	} catch {
		// CLI not installed or not on PATH; fall back to the bundled version.
	}

	cachedUserAgent = `claude-cli/${version} (external, cli)`;
	return cachedUserAgent;
}
