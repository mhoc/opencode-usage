# OpenCode usage report

`/usagex` opens a native OpenCode TUI modal with optional Codex subscription limits plus Day, Week, Month, and All Time token windows.

<img width="1025" height="447" alt="Screenshot 2026-08-26 at 4 14 35 PM" src="https://github.com/user-attachments/assets/5e1b9925-e4bf-4c18-8f94-a693ad797725" />

## Installation

Copy and paste this prompt into OpenCode:

```text
Install the OpenCode TUI plugin from `github:mhoc/opencode-usage`.

Update `~/.config/opencode/tui.json` so its `plugin` array includes
`"github:mhoc/opencode-usage"`. Preserve all existing configuration and plugin
entries. Validate the resulting JSON, but do not modify `opencode.json` or
`opencode.jsonc`. When finished, tell me to restart OpenCode and run `/usagex`.
```

## OpenCode plugin

Install the repository and register its TUI package entrypoint in OpenCode's global `tui.json` configuration:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["github:mhoc/opencode-usage"]
}
```

Then run:

```text
/usagex
```

Use left/right (or `h`/`l`) or click a tab to change windows, click `refresh` to reload usage, and press `Esc` to close. The command opens locally without invoking an LLM or adding a message to the current session.

The plugin reads `OPENCODE_DB` only through its configured `db` option; otherwise it uses `$XDG_DATA_HOME/opencode/opencode.db` or `~/.local/share/opencode/opencode.db`. Its optional `pricingUrl` setting defaults to models.dev.

When OpenCode has an OpenAI Codex OAuth connection, the modal adds a Codex tab and reads the primary and secondary subscription windows from OpenAI's Codex usage endpoint. The integration reads OpenCode's existing OAuth access token from `OPENCODE_AUTH_CONTENT` or the local OpenCode auth file, but never displays, logs, refreshes, or writes credentials. Expired credentials must be reconnected through OpenCode. API-key-only OpenAI connections do not enable the Codex tab.
