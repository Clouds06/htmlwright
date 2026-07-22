# htmlwright

*English · [简体中文](./README.zh-CN.md)*

A local, AI-native visual editor for single-file HTML documents. Preview the HTML
in a real browser, click an element, and describe the change in plain language.
The candidate result stays in memory — it is only written back to the file after
you review the code diff and a visual check.

> **Platform:** macOS only for now (file paths, browser discovery, and native-host
> registration are macOS-specific). Windows / Linux contributions are welcome.

## Requirements

- macOS
- Node.js >= 20.11
- One of Google Chrome / Chromium / Microsoft Edge
- A model backend — any one of: the Claude Code CLI (signed in), an `ANTHROPIC_API_KEY`, or any OpenAI-compatible endpoint (OpenAI / OpenRouter / local Ollama, via `HTMLWRIGHT_OPENAI_API_KEY`)

## How it works

You point at an element and write an intent; a provider (local Claude Code by
default) rewrites the file. Before anything touches disk, htmlwright shows a code
diff and runs a visual verification (Playwright screenshots, before/after pixel
diff) that flags whether the target actually changed, whether unrelated regions
moved, and whether content overflows or overlaps. You then **accept** (write back,
after snapshotting the original) or **reject** (discard).

There are two entry points that share the same core:

| Path | Entry | Use |
|------|-------|-----|
| **Chrome extension + native host** (recommended) | open a `file://` HTML directly | daily use, no server to keep running |
| **localhost web app** (`npm run dev`) | React SPA + Express | development / screenshot review |

## Chrome extension (recommended)

The extension lets you select and review directly on a `file://` HTML opened in
Chrome. A native host invokes local Claude Code on demand, runs the visual
verification, and writes back safely — no localhost server needed.

```bash
npm run native:install
```

First-time setup:

1. Open `chrome://extensions`.
2. Enable **Developer mode**, click **Load unpacked**.
3. Select the extension directory printed by the install command.
4. Open the extension details and enable **Allow access to file URLs**.
5. Open a local HTML file in Chrome and click the htmlwright toolbar icon.

After that the daily flow is just: open HTML → open the extension → click and edit.
The extension only requests `file://`, `localhost`, and `127.0.0.1` host access; it
does not inject into normal websites.

Selecting an element switches the scope to **element**, and the target of the
current intent is shown above the input. **Quick edit** changes a leaf node's text,
text color, background color, and font size without calling Claude. After a
candidate is generated you can keep selecting elements on the candidate page;
multiple quick or AI edits accumulate into the same candidate. **Accept & write
back** saves and clears the list; **Reject** discards everything not yet written.

While Claude Code is generating you can still submit more intents — the button
becomes **Add to generation queue**. Each job pins its target and scope on enqueue
and runs serially, always building on the previously succeeded candidate so
parallel results never overwrite each other.

Claude Code loads from `~/.local/bin/claude` by default; the installer records the
detected absolute path. If detection fails the extension prompts for the path (also
editable anytime via the gear next to **AI backend**). Settings are stored at
`~/Library/Application Support/htmlwright/config.json`.

If you install the published package globally, run `htmlwright-install-native` to
install and `htmlwright-uninstall-native` to remove it.

## localhost web app (development)

```bash
npm install
npm run dev
```

The dev server opens the sample file at `http://localhost:4178`.

To run against your own file:

```bash
npm run build
node dist/server/cli.js /absolute/path/to/page.html
```

Flags:

- `--port 4178` — set the local port.
- `--no-open` — don't open a browser automatically.
- `--in-place` — write the candidate back immediately (a snapshot is still kept).

The default provider is local Claude Code, which requires `claude auth status` to
report signed-in and no `ANTHROPIC_API_KEY` in the environment. To use the Anthropic
API directly, set that variable and pick **Anthropic API** in the UI.

Before each accept, the original file is snapshotted to `.htmlwright/snapshots/` in
the same directory. Preview injection only exists in the HTTP response — it never
reaches the file on disk.

Scopes are: element, current content unit, current page, and the whole HTML. Use
**whole HTML** to restyle an entire deck; use **page** to change only the current slide.

## Configuration

Environment variables (all optional) — see [`.env.example`](./.env.example):

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | enable the Anthropic API provider |
| `HTMLWRIGHT_MODEL` | model id for the Anthropic API provider (default `claude-sonnet-4-5`) |
| `HTMLWRIGHT_OPENAI_API_KEY` | enable the OpenAI-compatible provider (or reuse `OPENAI_API_KEY`) |
| `HTMLWRIGHT_OPENAI_BASE_URL` | OpenAI-compatible base URL (default `https://api.openai.com/v1`; e.g. OpenRouter, local Ollama) |
| `HTMLWRIGHT_OPENAI_MODEL` | model id for the OpenAI-compatible provider (default `gpt-4o`) |
| `HTMLWRIGHT_CLAUDE_EXECUTABLE` | path to the Claude Code executable |
| `HTMLWRIGHT_CONFIG_FILE` | override the config file location |
| `HTMLWRIGHT_ENABLE_DEMO` | set to `1` to enable the demo provider (no model call) |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | browser executable for visual verification |

## Checks

```bash
npm run check
```

Visual verification prefers Playwright's bundled Chromium, then a Chrome/Chromium/Edge
installed on macOS. You can point it at a specific browser with
`PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

## License

[MIT](./LICENSE) © 2026 clouds
