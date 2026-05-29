# claude-code (pi extension)

Use **pi** as **Claude Code** so requests draw from your Claude Pro/Max
**subscription** instead of metered "extra usage".

Pi's built-in Anthropic login authenticates as a third-party harness, which bills
per token against "extra usage". This extension instead impersonates the official
Claude Code CLI, the same approach used by the `nil0ft/crush` fork.

## How it works

It **overrides pi's built-in `anthropic` provider** in place rather than adding a
separate provider. Pi resolves streaming globally by API type, so binding the
Claude Code stealth stream to the `anthropic-messages` API covers **every**
Anthropic model — switching models (`/model`, `Ctrl+P`) stays on-plan instead of
falling back to metered billing. Pi's full, auto-updated Anthropic catalog is
preserved (no hand-maintained model list).

For each request it:

- **Imports credentials from the Claude Code CLI** session
  (`~/.claude/.credentials.json`) and refreshes them via the `claude` binary or the
  OAuth refresh endpoint — so pi shares the official CLI's plan-backed session.
  `/login` for `anthropic` uses this; a browser OAuth flow is the fallback.
- **Impersonates the CLI** on the wire: Claude Code identity, the
  `claude-code-20250219` / `oauth-2025-04-20` betas, a `claude-cli/<version>`
  User-Agent (matched to your installed CLI), `x-app: cli`, and Claude Code tool
  names (Read/Bash/Edit/Write/…).
- **Sanitizes the system prompt**: Anthropic's harness-detection classifier flags
  pi's self-referential "Pi documentation" section, which forces metered billing.
  That one section is removed; all coding guidelines, tool rules, project context
  (AGENTS.md / CLAUDE.md), skills, and date/cwd are preserved.

API-key users are unaffected: impersonation only activates for Claude Code OAuth
tokens (`sk-ant-oat…`).

## Billing warning & monitor

Once active, this extension makes subscription auth bill against your plan, so
pi's built-in *"subscription auth … draws from extra usage"* warning becomes
misleading. The extension therefore:

- **Disables that warning** by setting `warnings.anthropicExtraUsage: false` in
  `~/.pi/agent/settings.json` (written once, and skipped if you have set the flag
  yourself).
- **Replaces it with an accurate, header-based monitor.** It inspects the
  `anthropic-ratelimit-unified-*` headers on every real response to tell which
  pool a request was billed to:
  - Requests billed to the plan carry per-window status headers
    (`unified-5h-status` / `unified-7d-status`). Within limits → silent.
  - If a response lacks those plan-window headers, the request was routed to
    **extra usage** → you get an error notification (impersonation may have
    stopped working; check for an update).
  - If a plan window reports `rejected`, your **plan limit is reached** → you're
    told to enable extra usage to continue (billed per token) or wait for reset.

This never depends on a `400 "out of extra usage"` error — that error is ambiguous
(it can mean either "impersonation failed" or "plan limit reached", and only fires
for accounts with extra usage disabled), so the headers are used to tell the two
apart. Notifications fire only when the billing state changes.

Run `/claude-code` any time to see the current billing status.

## Layout

```
pi-extension-claude-code/
├── index.ts            # entry point: provider override, warning suppress, billing wiring, command
├── src/
│   ├── constants.ts    # client id, endpoints, betas, identity, tools, User-Agent
│   ├── credentials.ts  # disk import, refresh chain, browser PKCE fallback
│   ├── prompt.ts       # system-prompt sanitizer + block construction
│   ├── convert.ts      # message/tool conversion + Claude Code name mapping
│   ├── stream.ts       # Anthropic streaming -> pi event stream (+ header capture)
│   ├── billing.ts      # classify plan vs extra-usage from response headers
│   └── settings.ts     # safe, idempotent disable of pi's extra-usage warning
├── package.json
└── tsconfig.json
```

## Install

Install as a pi package (recommended — pi gives it an isolated module root and
pulls runtime deps automatically):

```bash
pi install git:github.com/nil0ft/pi-extension-claude-code
# or from npm, if published:
pi install npm:pi-extension-claude-code
# or pin a tag / commit:
pi install git:github.com/nil0ft/pi-extension-claude-code@v0.5.0
```

To share with a team, add it to project settings with `-l` (writes
`.pi/settings.json`); pi installs missing packages on startup.

Try it for a single run without installing:

```bash
pi -e git:github.com/nil0ft/pi-extension-claude-code
```

Then authenticate — the provider is the regular `anthropic` one, now plan-billed:

```
pi
/login          # choose "Claude Code (Pro/Max via CLI session)"
/model          # pick any anthropic/<model>, e.g. anthropic/claude-sonnet-4-5
```

Use any Anthropic model as usual (e.g. `anthropic/claude-opus-4-8`,
`anthropic/claude-sonnet-4-5`); they all route through the subscription. Set a
default in `~/.pi/agent/settings.json` if you like:

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-5"
}
```

## Requirements

- A logged-in official Claude Code CLI (`claude`) so
  `~/.claude/.credentials.json` exists. The extension reads and refreshes that
  token. Without the CLI, `/login` falls back to a browser OAuth flow.

## Development

```bash
npm install        # installs devDeps (pi-ai/coding-agent types) for typechecking
npm run typecheck  # tsc --noEmit
```

`@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` are declared as
`peerDependencies` (`"*"`) — pi provides them at runtime, so they are not bundled.
They are also in `devDependencies` purely so a fresh clone can typecheck.

## Releasing

Releases are automated by GitHub Actions. Pushing a `vX.Y.Z` tag runs a
typecheck, publishes to npm (with build provenance), and creates a GitHub
release:

```bash
npm version patch        # or minor / major — bumps package.json and creates a tag
git push --follow-tags
```

One-time setup: add an npm **Automation** access token as the `NPM_TOKEN`
repository secret (Settings → Secrets and variables → Actions). Until then you
can publish manually with `npm publish`.

The published tarball ships only the runtime files (`index.ts`, `src/`, README,
LICENSE) — pi executes the TypeScript directly, so there is no build step.

