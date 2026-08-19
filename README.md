<p align="center">
  <img src="public/icon/128.png" width="96" height="96" alt="chrome-fx" />
</p>

<h1 align="center">chrome-fx</h1>

<p align="center">
  Official <a href="https://fx.sh">fx</a> WASM terminal, injected on any page.<br />
  Talk to the agent and let it drive the current browser.
</p>

<p align="center">
  <img alt="Chrome 137+" src="https://img.shields.io/badge/Chrome%2FEdge-137%2B-000?style=flat-square" />
  <img alt="WXT" src="https://img.shields.io/badge/WXT-MV3-000?style=flat-square" />
  <img alt="fx" src="https://img.shields.io/badge/fx-WASM%20TUI-000?style=flat-square" />
</p>

chrome-fx is a Manifest V3 extension that embeds the official fx interactive terminal (`createFxTerminal` + `fx-term.wasm` + xterm.js) as a floating overlay. The agent gets an in-memory [just-bash](https://github.com/vercel-labs/just-bash) workspace plus `browser` / `js` commands that click, type, navigate, evaluate JavaScript, and snapshot the live page.

This is an unofficial host for [vercel-labs/fx](https://github.com/vercel-labs/fx). It is not affiliated with Vercel.

> [!WARNING]
> **Vercel AI Gateway only.** Production fx cannot use a custom OpenAI-compatible base URL or another vendor’s API key. Sign in with `/login` or paste a Gateway key. Tracked in [vercel-labs/fx#160](https://github.com/vercel-labs/fx/issues/160).

> [!WARNING]
> **`AGENTS.md` is not loaded into the model prompt.** The WASM host never attaches `/workspace/AGENTS.md` as project rules ([vercel-labs/fx#157](https://github.com/vercel-labs/fx/issues/157)). At the start of a session, tell the agent to read it (`cat AGENTS.md`). Otherwise it will not know about `browser` / `js`, or that it is driving a Chrome tab.

## Why this exists

WASM headless ACP (`createFxAgent`) cannot advertise host tools. The terminal surface is the supported way to get `terminal.exec`, OAuth `/login`, slash commands, and the real fx TUI. chrome-fx is that surface, running in Chrome instead of a local CLI.

## Features

- Floating `fx` button on `http(s)` pages; click to toggle the panel
- Drag the button anywhere; the panel stays anchored to it
- Resize from the opposite corner (top-left by default; flips when the button is on the left half of the page)
- Official fx TUI: sessions, `/login`, `/model`, `/setup`, prompt history
- In-memory workspace with live page files (`page/a11y.md`, `page/text.txt`, `tabs.json`, …)
- `browser` CLI for tabs, navigation, clicks, typing, eval, screenshots, and more
- Overlay stays in the browser top layer (Popover API) so page UI cannot cover it
- API key and fx stores persist in `chrome.storage`

## Requirements

- **Chrome or Edge 137+** — fx WASM needs [JSPI](https://github.com/WebAssembly/js-promise-integration)
- A [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) key, or a Vercel login via `/login` in the terminal
- [pnpm](https://pnpm.io) 9+ for development

Firefox is not a supported runtime today (no JSPI + offscreen combination that fx needs).

## Load unpacked

1. Clone and install:

   ```bash
   git clone https://github.com/Lakphy/chrome-fx.git
   cd chrome-fx
   pnpm install
   pnpm build
   ```

   `pnpm install` downloads `public/wasm/fx-term.wasm` from the official fx try build if it is missing.

2. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select `.output/chrome-mv3`.

3. Open a normal `https` page (not `chrome://` or the Chrome Web Store). Click the `fx` button, or use the toolbar popup → **open on this page**.

4. Authenticate:

   - Paste a Vercel AI Gateway key in the popup and save, or
   - Run `/login` inside the terminal

5. Pick a model the key can actually use (`/model`). Gateway free tier only covers a subset of the catalog.

## Development

```bash
pnpm install
pnpm dev          # WXT watch build → .output/chrome-mv3-dev
pnpm compile      # tsc --noEmit
pnpm build        # production build → .output/chrome-mv3
pnpm wasm         # refresh fx-term.wasm
```

Reload the unpacked extension after the first `pnpm dev`. Subsequent watch rebuilds usually hot-apply; if the offscreen host looks stuck, click the restart icon in the panel header.

| Script | What it does |
| --- | --- |
| `pnpm dev` | Watch build for Chrome |
| `pnpm build` | Production MV3 bundle |
| `pnpm zip` | Zip the production build |
| `pnpm compile` | Typecheck |
| `pnpm wasm` | Fetch `fx-term.wasm` |

Regenerate toolbar icons (black field, white `FX`):

```bash
node scripts/generate-icons.mjs
```

## Usage

### Overlay

- **Click** the `fx` button to open or close the panel
- **Drag** the button to reposition it; the panel follows
- **Resize** from the small square on the opposite corner of the panel
- When the button crosses the left half of the viewport, the panel flips: button at bottom-left, handle at top-right

`chrome://`, `chrome-extension://`, and the Chrome Web Store cannot host the overlay.

### Agent workspace

The shell is just-bash at `/workspace`. There is no git, Node, npm, Python, curl, or host OS.

Because [fx does not auto-inject `AGENTS.md` on WASM](https://github.com/vercel-labs/fx/issues/157), start a session by asking the agent to `cat AGENTS.md` (or paste that reminder yourself).

Useful entry points:

```text
ls
cat AGENTS.md
cat page/a11y.md
browser help
browser snapshot
browser click "text=Sign in"
browser type "#email" "you@example.com"
browser eval "document.title"
js document.body.style.outline = "3px solid red"
browser navigate example.com
```

Page files refresh when read:

| Path | Contents |
| --- | --- |
| `page/url.txt` | Current tab URL |
| `page/title.txt` | Document title |
| `page/meta.json` | URL, title, and extra metadata |
| `page/text.txt` | Visible text |
| `page/html.html` | Page HTML |
| `page/a11y.md` | Heading / control tree |
| `tabs.json` | Tabs in the current window |

Selectors: CSS, `#id`, `text=Visible label`, or `//xpath`. Default target is the tab that opened the panel.

### `browser` commands

```text
browser tabs | tab <id> | info
browser navigate <url> | new [url] | close [id]
browser back | forward | reload
browser snapshot
browser click <selector> | type <selector> <text> | press <Key>
browser hover | focus | wait <selector>
browser scroll up|down|top|bottom|<y>
browser select <selector> <value>
browser eval <javascript>          # js <javascript> is an alias
browser text | html | attr <selector> …
browser cookies | screenshot | fetch <url>
```

See `/workspace/README.md` or `browser help` for the full list.

## Architecture

```text
┌──────────── page ────────────┐     ┌──────── service worker ────────┐
│ content script overlay       │     │ routes ports & Chrome APIs     │
│  · fx button + drag/resize   │◄───►│  · chrome.tabs / cookies       │
│  · xterm panel (shadow +     │     │  · storage                     │
│    top-layer popover)        │     │  · scripting.executeScript     │
└──────────────▲───────────────┘     └──────────────▲─────────────────┘
               │                                    │
               │                          ┌─────────▼─────────┐
               │                          │ offscreen document │
               │                          │  · fx-term.wasm    │
               │                          │  · just-bash       │
               │                          │  · browser / js    │
               │                          └───────────────────┘
               │
        toolbar popup (API key + open on this page)
```

| Layer | Role |
| --- | --- |
| `entrypoints/overlay.content` | Injects the button and panel; positioning, drag, resize |
| `entrypoints/panel` | xterm.js UI, talks to the background on `chrome-friend-ui` |
| `entrypoints/popup` | Gateway key + “open on this page” |
| `entrypoints/background` | Port router, offscreen lifecycle, Chrome API proxy |
| `entrypoints/offscreen` | Only place `libfx` + WASM may run (needs DOM + `fetch`) |
| `lib/workspace.ts` | just-bash + `browser` / `js` |
| `lib/browser-tools.ts` | Implements `browser` via `chrome.*` and page scripts |
| `lib/page-dispatch.ts` | Injected MAIN-world helpers (click, type, snapshot, …) |
| `lib/fx-host.ts` | `createFxTerminal`, stores, `FX_MODEL`, `AI_GATEWAY_API_KEY` |

The service worker cannot instantiate WASM. The offscreen document cannot call `chrome.tabs` directly. Messages are validated in `lib/protocol.ts` before anything is proxied.

## Permissions

| Permission | Why |
| --- | --- |
| `storage` / `unlimitedStorage` | API key, fx config, sessions, OAuth, prompt history |
| `tabs` | List / create / switch / close tabs |
| `scripting` | Run page commands in the tab |
| `offscreen` | Host the WASM runtime |
| `cookies` | `browser cookies` |
| `<all_urls>` | Overlay + page automation on http(s) |

## Limits

- **Provider / `AGENTS.md`** — see the warnings at the top ([fx#160](https://github.com/vercel-labs/fx/issues/160), [fx#157](https://github.com/vercel-labs/fx/issues/157)).
- **WASM surface** — no native processes, OS sandbox, native MCP, subagents, skills, or host filesystem. That is an fx WASM constraint, not this overlay.
- **Restricted pages** — `chrome://`, `edge://`, `chrome-extension://`, and the Web Store cannot be injected.
- **Free-tier Gateway keys** — many catalog models return `403 no_providers_available`. Switch with `/model` or add Gateway credits.
- **Output cap** — command previews are clipped (~64 KiB) so the TUI stays usable.

## Related

- [fx](https://fx.sh) and [vercel-labs/fx](https://github.com/vercel-labs/fx)
- [libfx](https://www.npmjs.com/package/libfx)
- [just-bash](https://github.com/vercel-labs/just-bash)
- [WXT](https://wxt.dev)
- Requested: host-configured custom provider — [fx#160](https://github.com/vercel-labs/fx/issues/160)
- Requested: WASM should inject workspace `AGENTS.md` — [fx#157](https://github.com/vercel-labs/fx/issues/157)

## License

Source in this repository is provided as-is for use and modification. fx, `libfx`, and `fx-term.wasm` remain under their upstream licenses.
