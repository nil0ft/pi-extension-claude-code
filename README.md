<div align="center">

# claude-code for pi

**Run [pi](https://pi.dev) on your Claude Pro/Max subscription — not metered extra usage.**

[![CI](https://github.com/nil0ft/pi-extension-claude-code/actions/workflows/ci.yml/badge.svg)](https://github.com/nil0ft/pi-extension-claude-code/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/pi-extension-claude-code.svg)](https://www.npmjs.com/package/pi-extension-claude-code)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

---

Pi's built-in Anthropic login signs in as a third-party harness, so every request
is billed **per token as "extra usage"** — separate from the plan you already pay
for. This extension makes pi present itself as the official **Claude Code** CLI,
so requests are covered by your **subscription**.

```
                  before                         after
   pi ──▶ Anthropic ──▶ 💸 extra usage    pi ──▶ Anthropic ──▶ ✅ Pro/Max plan
        (third-party harness)                  (Claude Code session)
```

## Quick start

```bash
pi install npm:pi-extension-claude-code   # or: git:github.com/nil0ft/pi-extension-claude-code
pi
/login                                     # choose "Claude Code (Pro/Max via CLI session)"
```

That's it. Use any Anthropic model as usual — `anthropic/claude-sonnet-4-5`,
`anthropic/claude-opus-4-8`, … — and switch freely with `/model`; they all stay
on-plan. Run `/claude-code` anytime to see your live billing status.

> **Requires** the official [Claude Code CLI](https://docs.claude.com/en/docs/claude-code)
> logged in (so `~/.claude/.credentials.json` exists). No CLI? `/login` falls back
> to a browser OAuth flow.

## How it works

It **overrides pi's built-in `anthropic` provider** in place instead of adding a
separate one. Pi resolves streaming globally by API type, so binding the Claude
Code stream to `anthropic-messages` covers **every** Anthropic model — pi's full,
auto-updated catalog is preserved with zero hand-maintained model lists.

| | |
|---|---|
| 🔑 **Shared session** | Reads & refreshes the official CLI's OAuth token from `~/.claude/.credentials.json` (browser PKCE fallback). |
| 🥷 **Faithful impersonation** | Claude Code identity, required betas, a `claude-cli/<version>` User-Agent matched to your install, and Claude Code tool names. |
| 🧹 **Prompt sanitizing** | Strips only the self-referential snippet that trips Anthropic's harness classifier; all coding guidelines, tools, project context (`AGENTS.md`/`CLAUDE.md`) and skills are kept. |
| 📊 **Billing monitor** | Reads `anthropic-ratelimit-unified-*` headers on real responses to report the true billing pool. |

API-key users are untouched — impersonation activates only for Claude Code OAuth
tokens (`sk-ant-oat…`).

## Billing monitor

Once active, requests bill on-plan, so pi's built-in *"…draws from extra usage"*
warning is misleading. The extension disables it (`warnings.anthropicExtraUsage`,
written once, respecting any value you set yourself) and replaces it with an
**accurate, header-based** monitor that fires only on state changes:

| State | Signal | You see |
|---|---|---|
| ✅ On plan | plan-window status headers present, within limits | *(silent)* |
| 🛑 Plan limit reached | a window reports `rejected` | "limit reached — enable extra usage or wait for reset" |
| 💸 Extra usage | plan-window headers **absent** | error: "billing as extra usage — impersonation may have stopped working" |

This never relies on the `400 "out of extra usage"` error, which is ambiguous
(plan-limit vs. impersonation failure) and only occurs on accounts with extra
usage disabled.

## Usage tips

```jsonc
// ~/.pi/agent/settings.json — make it your default
{ "defaultProvider": "anthropic", "defaultModel": "claude-sonnet-4-5" }
```

```bash
pi install -l npm:pi-extension-claude-code   # project-scoped (.pi/settings.json), shareable with a team
pi -e npm:pi-extension-claude-code           # try once, without installing
```

## Project layout

```
index.ts            entry point — provider override, warning suppress, billing wiring, /claude-code
src/
  constants.ts      client id, endpoints, betas, identity, tool names, User-Agent
  credentials.ts    CLI-session import, refresh chain, browser PKCE fallback
  prompt.ts         system-prompt sanitizer + block construction
  convert.ts        message/tool conversion + Claude Code name mapping
  stream.ts         Anthropic streaming → pi events (+ response-header capture)
  billing.ts        classify plan vs. extra usage from response headers
  settings.ts       safe, idempotent disable of pi's extra-usage warning
```

## Development

```bash
npm install        # devDeps include pi-ai / pi-coding-agent types
npm run typecheck  # tsc --noEmit
```

`@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` are
`peerDependencies` (`"*"`): pi supplies them at runtime, so they're never bundled.
There is no build step — pi runs the TypeScript directly.

## Releasing

Push a `vX.Y.Z` tag; CI typechecks, publishes to npm with provenance, and cuts a
GitHub release.

```bash
npm version patch && git push --follow-tags
```

One-time: add an npm **Automation** token as the `NPM_TOKEN` repo secret.

## Disclaimer

Unofficial; not affiliated with Anthropic. Use within your plan's terms of
service. Stays close to the official CLI's behavior, but detection can change
server-side at any time — the billing monitor exists to tell you if it does.

## License

[MIT](LICENSE)
