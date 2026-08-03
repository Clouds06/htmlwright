# htmlwright

*English · [简体中文](./README.zh-CN.md)*

Click an element in a real browser, describe the change in one sentence. htmlwright shows a **code diff** and a **safety check** first (it screenshots before/after to confirm the target actually changed and nothing overflowed or shifted), and only writes back to the file once you approve.

It doesn't generate pages from scratch — it makes **referenceable, verifiable, reversible** edits on an existing single-file HTML. Everything stays on your machine; the original is snapshotted before every write-back, so a bad edit is undoable.

![htmlwright web workspace](./assets/screenshot-web.png)

## What it does

- **Point and edit** — click an element on the real page, say what you want in plain language.
- **Quick edit (no AI)** — change text / color / font size directly at the source level, instant and free.
- **AI edit** — Claude Code / Anthropic API / any OpenAI-compatible model (paste a key in the UI, no config files).
- **Review before write** — code diff + before/after comparison + safety checks (collateral changes, overflow, overlap) before anything hits disk.
- **You choose the scope** — no selection edits the whole file; click a spot and only that spot changes; multi-page docs can also target just the current page.
- **Version timeline** — every accumulated change is clickable: replay that version and jump to the element it touched.
- **Queue while generating** — submit several AI edits back to back without waiting; they apply serially.
- **Multi-file sites too** — browse your machine and open any HTML from the UI; in view mode, click a local link on the page to jump straight into editing it, with one "Back" to return.
- **Fully local** — auto-snapshot before write-back, undoable; nothing is uploaded.

> Want to try it right now? After installing dependencies, run the bundled sample: `node dist/server/cli.js sample/landing.html` (build first with `npm run build`).

---

# 1. User Guide

Both entry points edit **HTML files on your machine** — the only difference is how you get in. Not sure which? See [Which one](#which-one).

## First-time setup (needed for both)

A few one-time terminal commands; after that it's just the mouse.

1. Install [Node.js](https://nodejs.org) (20+):
   - macOS: `brew install node`
   - Windows: `winget install OpenJS.NodeJS.LTS`
2. Get the project and install dependencies:
   ```bash
   git clone https://github.com/Clouds06/htmlwright.git
   cd htmlwright
   npm install
   ```

## Option A: Chrome extension (recommended)

Open a local HTML file in Chrome, click the extension icon, select an element in the side panel and describe the change — no server to keep running.

![htmlwright Chrome extension side panel](./assets/screenshot-extension.png)

Install the extension, the native host, and record the AI backend path. The command prints an **extension directory** used in the next step:

```bash
cd htmlwright
npm run native:install
```

In Chrome:

1. Open `chrome://extensions`, turn on **Developer mode**.
2. Click **Load unpacked** and select the printed extension directory:
   - macOS: `~/Library/Application Support/htmlwright/extension`
   - Windows: `%LOCALAPPDATA%\htmlwright\extension`
3. Open the extension details and enable **Allow access to file URLs**.

Daily flow, three steps: open the local HTML → click the extension icon → select an element, describe the change, review and accept or reject.

- Just reading? Don't click the icon — the extension stays dormant and won't touch the page.
- For small tweaks (text, color, size), use **Quick edit** — no AI, instant, free.
- Select several elements in a row to accumulate changes, then **Accept & write back** together; **Reject** discards anything not yet written.

## Option B: Local command line

No extension. Build once, then open a starting file in a local web page (same interaction as the side panel, plus before/after screenshots):

![htmlwright local web workspace](./assets/screenshot-web.png)

```bash
cd htmlwright
npm run build                                   # build (first time / after updates)
node dist/server/cli.js /absolute/path/page.html   # open your file
```

No need to go back to the terminal after launch: click **Open file** at the top-left to browse your machine and switch to another HTML; in view mode, clicking a local link on the page jumps straight into that page for editing, and **Back** returns to the previous one — handy for multi-file sites with cross-links.

Common flags: `--port` sets the port; `--no-open` skips auto-opening the browser; `--in-place` writes the candidate immediately (a snapshot is still kept).

## Which one

| | Option A (extension) | Option B (CLI) |
|---|---|---|
| Best for | frequent, iterative edits | one-off edits, single file or a linked set |
| After setup | mouse only | one command each time |
| Screenshot comparison | checks summary only | full before/after screenshots |

## Configuring the AI backend

htmlwright ships no model of its own — connect one. Three options:

1. **Already using Claude Code** (`claude` installed and signed in): zero config, enabled by default. (If `ANTHROPIC_API_KEY` is set in the environment, it automatically switches to the Anthropic API instead, so your subscription quota isn't used by mistake.)
2. **Have an API key** (OpenAI / OpenRouter / SiliconFlow / local Ollama): click the gear next to **Model**, fill in the API key, base URL and model, save. **Recommended for non-technical users.**
3. **Have an Anthropic key**: set `ANTHROPIC_API_KEY` and pick Anthropic API in the UI.

> ⚠️ Choose a general-purpose or code model (DeepSeek-V3, Qwen-Coder, GPT-4o, Claude, …). Translation-only small models (names containing MT / Translation) won't return complete HTML and will fail with "no complete HTML".

## About the visual safety check

The automated check shown before write-back (did the target actually change, did it affect anything else, overflow, overlap) needs any one of **Chrome / Chromium / Edge / Brave** installed on your system — htmlwright finds and drives it automatically, no configuration needed. When none is found, this check is skipped with a notice, while **the code diff and the before/after preview still work and editing is unaffected**. Extension users have this by definition; the Edge that ships with Windows also works.

---

# 2. Developer Guide

## Local development

```bash
cd htmlwright
npm install      # install dependencies
npm run dev      # dev server on the sample file at http://localhost:4178
npm run build    # type-check + bundle
npm run check    # unit tests + extension structure check + typecheck
```

## Core structure

- `server/session.ts` — candidate / write-back / snapshot / undo state machine (shared by both entry points).
- `server/providers.ts` — model backend factory and the `LLMProvider` interface (Claude Code / Anthropic API / OpenAI-compatible / demo).
- `server/verifier.ts` — Playwright screenshots and per-unit visual verification.
- `server/quick-edit.ts` — parse5 source-level rewrites (no model call).
- `server/platform.ts` — cross-platform paths and commands.
- `server/native-host.ts` — native messaging host for the extension.
- `extension/` — Chrome MV3: `content-script` / `sidepanel` / `service-worker`.
- `scripts/` — native host install / uninstall (directory on macOS, registry on Windows).

## Environment variables (all optional, see [`.env.example`](./.env.example))

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | enable the Anthropic API provider |
| `HTMLWRIGHT_MODEL` | Anthropic API model id (default `claude-sonnet-4-5`) |
| `HTMLWRIGHT_OPENAI_API_KEY` | enable the OpenAI-compatible provider (or reuse `OPENAI_API_KEY`) |
| `HTMLWRIGHT_OPENAI_BASE_URL` | OpenAI-compatible base URL (default `https://api.openai.com/v1`) |
| `HTMLWRIGHT_OPENAI_MODEL` | OpenAI-compatible model id (default `gpt-4o`) |
| `HTMLWRIGHT_CLAUDE_EXECUTABLE` | path to the Claude Code executable |
| `HTMLWRIGHT_CONFIG_FILE` | override the config file location |
| `HTMLWRIGHT_ENABLE_DEMO` | set `1` to enable the demo provider (no model call) |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | browser executable for visual verification |

## Safe write-back

Before accepting, the original is snapshotted to `.htmlwright/snapshots/` in the same directory. Preview injection only exists in the HTTP response — it never reaches disk. Visual verification prefers Playwright's bundled Chromium, falling back to a locally installed Chrome / Edge.

After a global install of the published package, use `htmlwright-install-native` to install and `htmlwright-uninstall-native` to remove the native host.

## Distribution

For now you **clone and build it yourself** (see above). `package.json` already declares `bin` / `files`, so after `npm publish` it can run via `npx htmlwright file.html` with no clone, or be installed globally — publishing is planned.

## Platform support

- **macOS** — fully supported.
- **Windows** — experimental (native host via registry, `.bat` wrapper), not yet thoroughly verified.
- **Linux** — not adapted yet, contributions welcome.

## License

[MIT](./LICENSE) © 2026 clouds
