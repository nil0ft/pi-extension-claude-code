# claude-code (pi extension)

Use **pi** as **Claude Code** so requests draw from your Claude Pro/Max
**subscription** instead of metered "extra usage".

Pi's built-in Anthropic login authenticates as a third-party harness, which bills
per token against "extra usage". This extension instead impersonates the official
Claude Code CLI, the same approach used by the `nil0ft/crush` fork.

## How it works

Registers a `claude-code` provider that:

- **Imports credentials from the Claude Code CLI** session
  (`~/.claude/.credentials.json`) and refreshes them via the `claude` binary or the
  OAuth refresh endpoint — so pi shares the official CLI's plan-backed session.
- **Impersonates the CLI** on the wire: Claude Code identity, the
  `claude-code-20250219` / `oauth-2025-04-20` betas, a `claude-cli/<version>`
  User-Agent (matched to your installed CLI), `x-app: cli`, and Claude Code tool
  names (Read/Bash/Edit/Write/…).
- **Sanitizes the system prompt**: Anthropic's harness-detection classifier flags
  pi's self-referential "Pi documentation" section, which forces metered billing.
  That one section is removed; all coding guidelines, tool rules, project context
  (AGENTS.md / CLAUDE.md), skills, and date/cwd are preserved.

## Layout

```
pi-extension-claude-code/
├── index.ts            # entry point: registerProvider wiring
├── src/
│   ├── constants.ts    # client id, endpoints, betas, identity, tools, User-Agent
│   ├── credentials.ts  # disk import, refresh chain, browser PKCE fallback
│   ├── prompt.ts       # system-prompt sanitizer + block construction
│   ├── convert.ts      # message/tool conversion + Claude Code name mapping
│   ├── stream.ts       # Anthropic streaming -> pi event stream
│   └── models.ts       # model catalog
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
pi install git:github.com/nil0ft/pi-extension-claude-code@v0.2.0
```

To share with a team, add it to project settings with `-l` (writes
`.pi/settings.json`); pi installs missing packages on startup.

Try it for a single run without installing:

```bash
pi -e git:github.com/nil0ft/pi-extension-claude-code
```

Then authenticate and select a model:

```
pi
/login          # choose "Claude Code (Pro/Max via CLI session)"
/model          # pick claude-code/claude-sonnet-4-5
```

To make it the default, set in `~/.pi/agent/settings.json`:

```json
{
  "defaultProvider": "claude-code",
  "defaultModel": "claude-sonnet-4-5"
}
```

Models: `claude-code/claude-opus-4-5`, `claude-code/claude-sonnet-4-5`,
`claude-code/claude-haiku-4-5`.

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
