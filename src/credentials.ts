/**
 * Credential handling for the Claude Code provider.
 *
 * The primary strategy is to piggyback on the official Claude Code CLI session:
 * its OAuth token is read from `~/.claude/.credentials.json` and refreshed by the
 * CLI itself, so usage is billed against the Claude Pro/Max plan rather than
 * metered "extra usage". A standard browser PKCE flow remains as a fallback for
 * machines without the CLI installed.
 */

import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import {
	AUTHORIZE_URL,
	CLAUDE_CREDENTIALS_PATH,
	CLIENT_ID,
	OAUTH_SCOPES,
	REDIRECT_URI,
	TOKEN_URL,
} from "./constants.ts";

const execFileAsync = promisify(execFile);

/** Skew applied to token lifetimes so we refresh slightly before actual expiry. */
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

interface TokenResponse {
	access_token: string;
	refresh_token: string;
	expires_in: number;
}

interface ClaudeCredentialsFile {
	claudeAiOauth?: {
		accessToken?: string;
		refreshToken?: string;
		expiresAt?: number; // epoch milliseconds
	};
}

/** Reads the Claude Code CLI credentials from disk, if present and valid. */
export async function tokenFromDisk(): Promise<OAuthCredentials | null> {
	let parsed: ClaudeCredentialsFile;
	try {
		parsed = JSON.parse(await readFile(CLAUDE_CREDENTIALS_PATH, "utf8"));
	} catch {
		return null;
	}

	const oauth = parsed.claudeAiOauth;
	if (!oauth?.accessToken) return null;

	return {
		access: oauth.accessToken,
		refresh: oauth.refreshToken ?? "",
		expires: oauth.expiresAt ?? 0,
	};
}

/**
 * Triggers the Claude Code CLI to refresh its own token (a cheap haiku request),
 * then re-reads the updated credentials from disk.
 */
async function refreshViaCli(): Promise<OAuthCredentials | null> {
	try {
		await execFileAsync("claude", ["-p", ".", "--model", "haiku"], {
			env: { ...process.env, TERM: "dumb" },
			timeout: 60_000,
		});
	} catch {
		// CLI missing or errored; fall through to a disk read in case it still rotated.
	}
	return tokenFromDisk();
}

/** Refreshes the token directly against the OAuth endpoint using a refresh token. */
async function refreshViaEndpoint(refresh: string): Promise<OAuthCredentials> {
	const response = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			grant_type: "refresh_token",
			client_id: CLIENT_ID,
			refresh_token: refresh,
		}),
	});

	if (!response.ok) {
		throw new Error(`Token refresh failed: ${response.status} ${await response.text()}`);
	}

	const data = (await response.json()) as TokenResponse;
	return {
		refresh: data.refresh_token || refresh,
		access: data.access_token,
		expires: Date.now() + data.expires_in * 1000 - EXPIRY_SKEW_MS,
	};
}

/**
 * Refreshes credentials, preferring the official CLI session so pi's stored token
 * stays in lockstep with the Claude Code CLI:
 *   1. A fresher token already written to disk by the CLI.
 *   2. A direct endpoint refresh using our stored refresh token.
 *   3. Asking the CLI to refresh, then re-reading disk.
 */
export async function refreshCredentials(credentials: OAuthCredentials): Promise<OAuthCredentials> {
	const disk = await tokenFromDisk();
	if (disk?.access && disk.expires > Date.now() + 60_000) {
		return disk;
	}

	if (credentials.refresh) {
		try {
			return await refreshViaEndpoint(credentials.refresh);
		} catch {
			// fall through to a CLI-driven refresh
		}
	}

	const refreshed = await refreshViaCli();
	if (refreshed?.access) return refreshed;

	throw new Error(
		"Unable to refresh Claude credentials: no fresh token on disk, endpoint refresh failed, and the Claude Code CLI is unavailable.",
	);
}

/** Generates a PKCE verifier/challenge pair for the browser-login fallback. */
async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
	const toBase64Url = (bytes: Uint8Array) =>
		btoa(String.fromCharCode(...bytes))
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/, "");

	const verifierBytes = new Uint8Array(32);
	crypto.getRandomValues(verifierBytes);
	const verifier = toBase64Url(verifierBytes);

	const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	const challenge = toBase64Url(new Uint8Array(hash));

	return { verifier, challenge };
}

/**
 * `/login` handler. Prefers the existing Claude Code CLI session and otherwise
 * runs a standard browser OAuth (PKCE) flow.
 */
export async function login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
	const disk = await tokenFromDisk();
	if (disk) return disk;

	const { verifier, challenge } = await generatePKCE();
	const authParams = new URLSearchParams({
		code: "true",
		client_id: CLIENT_ID,
		response_type: "code",
		redirect_uri: REDIRECT_URI,
		scope: OAUTH_SCOPES,
		code_challenge: challenge,
		code_challenge_method: "S256",
		state: verifier,
	});

	callbacks.onAuth({ url: `${AUTHORIZE_URL}?${authParams.toString()}` });

	const authCode = await callbacks.onPrompt({ message: "Paste the authorization code:" });
	const [code, state] = authCode.trim().split("#");

	const response = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			grant_type: "authorization_code",
			client_id: CLIENT_ID,
			code,
			state,
			redirect_uri: REDIRECT_URI,
			code_verifier: verifier,
		}),
	});

	if (!response.ok) {
		throw new Error(`Token exchange failed: ${response.status} ${await response.text()}`);
	}

	const data = (await response.json()) as TokenResponse;
	return {
		refresh: data.refresh_token,
		access: data.access_token,
		expires: Date.now() + data.expires_in * 1000 - EXPIRY_SKEW_MS,
	};
}
