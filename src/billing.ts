/**
 * Subscription billing monitor.
 *
 * Determines, from real Anthropic responses, whether requests are billed against
 * your Claude plan or fall through to metered "extra usage". This is derived from
 * the response headers, NOT from error status codes — a `400 "out of extra usage"`
 * is ambiguous (it can mean either "plan limit reached" or "impersonation failed")
 * and only occurs for accounts with extra usage disabled, so it is unreliable as a
 * signal on its own.
 *
 * Account-independent signal (observed empirically):
 *   - Requests billed to the plan carry per-window status headers:
 *       anthropic-ratelimit-unified-5h-status / -7d-status / unified-status
 *     with value "allowed" (within limit) or "rejected" (limit reached).
 *   - Requests routed to extra usage are NOT counted against a plan window, so
 *     those per-window status headers are ABSENT (only overage headers remain).
 *
 * So: window-status present => plan-accounted; window-status absent on an
 * otherwise-valid subscription response => billed as extra usage.
 */

const PREFIX = "anthropic-ratelimit-unified-";

export type BillingPool = "plan" | "extra-usage" | "unknown";

export interface BillingSnapshot {
	/** Which pool the request was billed to. */
	pool: BillingPool;
	/** True when a plan window is exhausted (status "rejected"). */
	planLimitReached: boolean;
	/** Whether extra usage (overage) is available on the account, if known. */
	overageAvailable?: boolean;
	/** 5-hour window utilization (0..1), if reported. */
	utilization5h?: number;
	/** 7-day window utilization (0..1), if reported. */
	utilization7d?: number;
	/** Epoch ms when the most relevant limit resets, if reported. */
	resetAt?: number;
	/** When this snapshot was observed. */
	at: number;
}

export type BillingNotifier = (message: string, type: "info" | "warning" | "error") => void;

let lastSnapshot: BillingSnapshot | undefined;
let notifier: BillingNotifier | undefined;
let lastNotifiedKey: string | undefined;

/** Registers (or clears) the UI notifier used for billing-state transitions. */
export function setBillingNotifier(fn: BillingNotifier | undefined): void {
	notifier = fn;
}

/** Returns the most recently observed billing snapshot, if any. */
export function getLastBilling(): BillingSnapshot | undefined {
	return lastSnapshot;
}

/** Normalizes a Headers object or plain record into a case-insensitive getter. */
function headerGetter(headers: Headers | Record<string, string>): (name: string) => string | undefined {
	if (typeof (headers as Headers).get === "function") {
		const h = headers as Headers;
		return (name) => h.get(name) ?? undefined;
	}
	const lower: Record<string, string> = {};
	for (const [k, v] of Object.entries(headers as Record<string, string>)) {
		lower[k.toLowerCase()] = v;
	}
	return (name) => lower[name.toLowerCase()];
}

function toFloat(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const n = Number.parseFloat(value);
	return Number.isFinite(n) ? n : undefined;
}

function toResetMs(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const secs = Number.parseInt(value, 10);
	return Number.isFinite(secs) ? secs * 1000 : undefined;
}

/**
 * Classifies a response's billing from its headers. Returns undefined when the
 * response carries no unified subscription headers at all (e.g. an API-key
 * account or a non-Anthropic response) — nothing to say in that case.
 */
export function classifyBilling(headers: Headers | Record<string, string>, at = Date.now()): BillingSnapshot | undefined {
	const get = headerGetter(headers);

	const status5h = get(`${PREFIX}5h-status`);
	const status7d = get(`${PREFIX}7d-status`);
	const statusOverall = get(`${PREFIX}status`);
	const overageStatus = get(`${PREFIX}overage-status`);
	const overageDisabledReason = get(`${PREFIX}overage-disabled-reason`);

	const hasWindowStatus = !!(status5h || status7d || statusOverall);
	const hasAnyUnified = hasWindowStatus || !!overageStatus || !!overageDisabledReason;

	if (!hasAnyUnified) {
		return undefined; // Not a subscription response; no opinion.
	}

	const overageAvailable = overageStatus ? overageStatus === "allowed" : overageDisabledReason ? false : undefined;

	if (hasWindowStatus) {
		const planLimitReached = [status5h, status7d, statusOverall].includes("rejected");
		return {
			pool: "plan",
			planLimitReached,
			overageAvailable,
			utilization5h: toFloat(get(`${PREFIX}5h-utilization`)),
			utilization7d: toFloat(get(`${PREFIX}7d-utilization`)),
			resetAt: toResetMs(get(`${PREFIX}5h-reset`) ?? get(`${PREFIX}reset`)),
			at,
		};
	}

	// Unified/overage headers present but no plan-window accounting: the request
	// was routed to extra usage rather than the plan.
	return { pool: "extra-usage", planLimitReached: false, overageAvailable, at };
}

const USAGE_URL = "https://claude.ai/settings/usage";

function formatReset(resetAt?: number): string {
	if (!resetAt) return "soon";
	const date = new Date(resetAt);
	return date.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" });
}

/** Builds the notification for a snapshot, or null when nothing needs saying. */
function notificationFor(snapshot: BillingSnapshot): { message: string; type: "info" | "warning" | "error" } | null {
	if (snapshot.pool === "extra-usage") {
		return {
			type: "error",
			message:
				"Claude Code: requests are being billed as EXTRA USAGE (per token), not your Claude plan. " +
				`The Claude Code impersonation may no longer be recognized — check for an extension update. Manage at ${USAGE_URL}.`,
		};
	}
	if (snapshot.pool === "plan" && snapshot.planLimitReached) {
		if (snapshot.overageAvailable) {
			return {
				type: "warning",
				message:
					`Claude Code: your Claude plan limit is reached (resets ${formatReset(snapshot.resetAt)}). ` +
					"Further requests will now draw from extra usage (billed per token).",
			};
		}
		return {
			type: "warning",
			message:
				`Claude Code: your Claude plan limit is reached (resets ${formatReset(snapshot.resetAt)}). ` +
				`To keep going now, enable extra usage (billed per token) at ${USAGE_URL}, or wait for the reset.`,
		};
	}
	return null; // On plan and within limits: nothing to report.
}

/** Stable key describing the notify-worthy state, to avoid repeat notifications. */
function stateKey(snapshot: BillingSnapshot): string {
	if (snapshot.pool === "extra-usage") return "extra-usage";
	if (snapshot.pool === "plan" && snapshot.planLimitReached) {
		return snapshot.overageAvailable ? "limit-overage" : "limit-blocked";
	}
	return "ok";
}

/**
 * Records a response's headers, updates the snapshot, and notifies the user when
 * the billing state changes to something worth flagging. Safe to call on every
 * request — notifications fire only on state transitions.
 */
export function recordResponseHeaders(headers: Headers | Record<string, string>): void {
	const snapshot = classifyBilling(headers);
	if (!snapshot) return;

	lastSnapshot = snapshot;

	const key = stateKey(snapshot);
	if (key === lastNotifiedKey) return;
	lastNotifiedKey = key;

	if (key === "ok") return; // Recovered or healthy; stay quiet.

	const note = notificationFor(snapshot);
	if (note && notifier) notifier(note.message, note.type);
}

/** Human-readable one-line status for the /claude-code command. */
export function describeBilling(snapshot: BillingSnapshot | undefined): string {
	if (!snapshot) return "No Anthropic requests observed yet this session.";
	switch (snapshot.pool) {
		case "plan": {
			const util =
				snapshot.utilization5h !== undefined ? ` (5h usage ${Math.round(snapshot.utilization5h * 100)}%)` : "";
			return snapshot.planLimitReached
				? `Plan limit reached${util}; resets ${formatReset(snapshot.resetAt)}.`
				: `Billing on your Claude plan${util}. Subscription is active.`;
		}
		case "extra-usage":
			return "Requests are billing as EXTRA USAGE (per token), not your plan. Impersonation may have stopped working.";
		default:
			return "Billing status unknown.";
	}
}
