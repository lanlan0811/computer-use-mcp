# computer-use

**Windows computer-use MCP server** — full desktop automation for any MCP-capable agent (Trae, Claude Code, Cursor, Cline, Cherry Studio, and more): screenshots, mouse, keyboard, clipboard, and app control.

Pure TypeScript, zero Python dependencies, zero external interpreters, speaking standard MCP over stdio.

> **Development status**: the first release (0.1.0) is in progress and not yet published to npm. This document tracks the implementation.

## Why this project

The computer-use experience bundled with TraeWork leaves a lot to be desired. This project faithfully replicates the Windows pixel surface of [cc-haha](https://github.com/lanlan0811/cc-haha), preserving the two mechanisms that matter most on Windows, where the agent shares one system input stream with the user:

- **Physical input interference detection**: `WH_KEYBOARD_LL` / `WH_MOUSE_LL` low-level hooks tell the agent's own tagged `SendInput` apart from the user's physical input. When physical input overlaps an action, the action aborts — and the error makes the crucial distinction between "not sent, safe to retry" (`user_interference`) and "sent, outcome unknown, do NOT retry" (`user_interference_result_unknown`), which is the only thing stopping a model from flipping the same switch over and over.
- **Delivery pre-checks**: `SendInput` reports success unconditionally, even when it lands off-screen or on another window. This server verifies the coordinate is on a display and the target window is reachable before sending. It would rather refuse than report a success that never happened.

## Features

- 22 tools: screenshot / zoom / five click variants / text input / key press / scroll / drag / mouse move / open app / switch display / clipboard read+write / wait / cursor position / hold key / mouse down+up / batch
- GDI BitBlt capture with LANCZOS pre-scaling to the image budget (28 px/token, 1568 px long edge, 1568 tokens) so the model reads coordinates in the same space the server uses
- Damped-spring cursor animation (k=196, damping ratio 0.85, 60 Hz) and per-character Unicode input with a 25 ms pre-character delay (works around RichEdit reordering in modern Notepad)
- Multi-monitor support: automatic target display resolution, deduplicated labels, `switch_display`
- DPI: three-level per-monitor-v2 awareness fallback, physical pixels throughout, 0..65535 virtual-desktop mapping for absolute `SendInput`
- App discovery: three registry Uninstall hives + visible-window enumeration + UWP `ApplicationFrameHost` resolution + TTL cache
- Cross-process file lock (one operator per machine), full cancellation semantics (including automatic held-key release), and batch actions with per-action gating
- Crash isolation via a resident worker subprocess: after a crash the server restarts and reports "outcome unknown, take a screenshot first" — never a silent retry

## Requirements

- Windows 10 1607 or later (Windows only; no macOS or Linux support)
- Node.js >= 20

## Usage

Start the stdio MCP server directly with npx:

```bash
npx @lotteai/computer-use
```

Or install globally:

```bash
npm install -g @lotteai/computer-use
computer-use
```

Configure your MCP client (stdio example):

```json
{
  "mcpServers": {
    "computer-use": {
      "command": "npx",
      "args": ["-y", "@lotteai/computer-use"]
    }
  }
}
```

## Configuration (environment variables)

All configuration is read once at startup and frozen. Every variable uses the `COMPUTER_USE_` prefix:

| Variable                             | Default                   | Description                                          |
| ------------------------------------ | ------------------------- | ---------------------------------------------------- |
| `COMPUTER_USE_DISABLED`              | unset                     | Set to `1` to disable the server entirely            |
| `COMPUTER_USE_ALLOW_SYSTEM_KEYS`     | `1`                       | `systemKeyCombos` grant flag                         |
| `COMPUTER_USE_ALLOW_CLIPBOARD_READ`  | `1`                       | `clipboardRead` grant flag                           |
| `COMPUTER_USE_ALLOW_CLIPBOARD_WRITE` | `1`                       | `clipboardWrite` grant flag                          |
| `COMPUTER_USE_PIXEL_VALIDATION`      | `0`                       | Stale click-target validation switch                 |
| `COMPUTER_USE_PIXEL_VALIDATION_GRID` | `9`                       | Validation grid size                                 |
| `COMPUTER_USE_MOUSE_ANIMATION`       | `1`                       | Spring cursor animation                              |
| `COMPUTER_USE_SETTLE_MS`             | `0`                       | Extra settle time before observing (none by default) |
| `COMPUTER_USE_ACTION_TIMEOUT_MS`     | measured                  | Per-action hard timeout                              |
| `COMPUTER_USE_APP_CACHE_TTL_MS`      | `60000`                   | App list TTL cache                                   |
| `COMPUTER_USE_WORKER_IDLE_MS`        | `300000`                  | Worker idle shutdown                                 |
| `COMPUTER_USE_SHOT_DIR`              | `%TEMP%\computer-use-mcp` | `save_to_disk` directory                             |
| `COMPUTER_USE_SERVER_NAME`           | `computer-use`            | MCP server name (controls tool prefix)               |
| `COMPUTER_USE_LOG_LEVEL`             | `info`                    | stderr log level                                     |

## Tool list

| #   | Tool                                                                       | Description                                                                                              |
| --- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | `screenshot`                                                               | Full-screen capture (optional save-to-disk)                                                              |
| 2   | `zoom`                                                                     | Regional zoom (read detail only; action coordinates stay relative to the full screenshot)                |
| 3   | `click` / `double_click` / `triple_click` / `right_click` / `middle_click` | Five click variants, optional modifier hold                                                              |
| 8   | `type_text`                                                                | Per-character input (multi-line goes through clipboard paste with save/restore)                          |
| 9   | `press_key`                                                                | Key press with repeat (1–100)                                                                            |
| 10  | `scroll`                                                                   | Scroll (direction + amount)                                                                              |
| 11  | `drag`                                                                     | Drag                                                                                                     |
| 12  | `move_mouse`                                                               | Move the mouse (spring animation)                                                                        |
| 13  | `open_app`                                                                 | Open an app (reuses an existing foreground window when possible)                                         |
| 14  | `switch_display`                                                           | Switch display (name or `auto`)                                                                          |
| 15  | `read_clipboard` / `write_clipboard`                                       | Clipboard read / write                                                                                   |
| 17  | `wait`                                                                     | Wait (0–100 seconds)                                                                                     |
| 18  | `cursor_position`                                                          | Query cursor position                                                                                    |
| 19  | `hold_key`                                                                 | Hold a key for a duration                                                                                |
| 20  | `mouse_down` / `mouse_up`                                                  | Left button down / up                                                                                    |
| 22  | `batch`                                                                    | Batch actions (per-action gating, stop on first error, coordinates relative to the pre-batch screenshot) |

## Safety model

Every call passes a fixed gate order: master switch → argument validation → cross-process file lock → foreground app identification (unidentifiable means refused) → delivery pre-checks → execution. If any gate throws, the executor is never invoked (fail-closed).

Error codes carry two semantics, and that distinction is the only thing preventing repeated application of the same action: `user_interference` (not sent, safe to retry) versus `user_interference_result_unknown` (sent, outcome unknown — screenshot first).

Safety boundaries (baked into the MCP `instructions`): password changes, certificate warnings, money transfers, employment/housing/credit decisions → hand back to the user; CAPTCHAs, irreversible deletion, legal agreements, installing software from unknown sources, API keys/OAuth, VPN/network/system security settings → ask in the moment before acting.

## Development

```bash
npm install
npm run check      # typecheck + lint + format:check + test + build
npm test           # tests only
npm run test:desktop  # real desktop tests (off by default; needs COMPUTER_USE_DESKTOP_TESTS=1)
```

## License

MIT. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE) (per-dependency license list).
