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

## Disclaimer

Unofficial; not affiliated with Anthropic. Use within your plan's terms of
service. Stays close to the official CLI's behavior, but detection can change
server-side at any time — the billing monitor exists to tell you if it does.

## License

[MIT](LICENSE)
