/**
 * The 22 advertised tool schemas.
 *
 * Structure is 1:1 with cc-haha's windowsLegacyTools.ts (verified by the
 * snapshot contract test in tests/contract/tool-schema.test.ts). Two
 * intentional differences, both recorded in docs/PARITY.md:
 *
 *   1. Tool names follow the semantic mapping in toolNames.ts.
 *   2. Coordinate descriptions are frozen to the `pixels` mode — the only
 *      mode this project exposes. The descriptions and the runtime transform
 *      read the same frozen value, which is the whole point (plan §8).
 *
 * Descriptions are English (model-facing), matching cc-haha.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * Coordinate wording, frozen to pixels. Chromium's browserTools.ts:143 is the
 * reference phrasing — "pixels from the left edge", no geometry, no number to
 * do math with.
 */
const COORD_DESC = {
  x: 'Horizontal pixel position read directly from the most recent screenshot image, measured from the left edge. The server handles all scaling.',
  y: 'Vertical pixel position read directly from the most recent screenshot image, measured from the top edge. The server handles all scaling.',
};

const FRONTMOST_GATE_DESC =
  'The target is resolved at call time and remains subject to product safety restrictions.';

/** [x, y] tuple — param shape for all click/move/scroll tools. */
const coordinateTuple = {
  type: 'array',
  items: { type: 'number' },
  minItems: 2,
  maxItems: 2,
  description: `(x, y): ${COORD_DESC.x}`,
};

/** Modifier hold during click. Shared across all 5 click variants. */
const clickModifierText = {
  type: 'string',
  description:
    'Modifier keys to hold during the click (e.g. "shift", "ctrl+shift"). Supports the same syntax as the press_key tool.',
};

const saveToDisk = {
  type: 'boolean',
  description:
    'Save the image to disk so it can be attached to a message for the user. Returns the saved path in the tool result. Only set this when you intend to share the image — screenshots you are just looking at do not need saving.',
};

/**
 * Item schema for the `actions` array in `batch`. Mirrors cc-haha's
 * BATCH_ACTION_ITEM_SCHEMA with the action enum mapped through
 * toolNames.ts. Keep in sync with BATCHABLE_ACTIONS in the dispatch layer.
 */
const BATCH_ACTION_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: [
        'click',
        'double_click',
        'triple_click',
        'right_click',
        'middle_click',
        'type_text',
        'press_key',
        'hold_key',
        'scroll',
        'drag',
        'move_mouse',
        'mouse_down',
        'mouse_up',
        'screenshot',
        'wait',
        'cursor_position',
      ],
      description: 'The action to perform.',
    },
    coordinate: {
      type: 'array',
      items: { type: 'number' },
      minItems: 2,
      maxItems: 2,
      description: '(x, y) for click/move_mouse/scroll/drag end point.',
    },
    start_coordinate: {
      type: 'array',
      items: { type: 'number' },
      minItems: 2,
      maxItems: 2,
      description:
        '(x, y) drag start — drag only. Omit to drag from current cursor.',
    },
    text: {
      type: 'string',
      description:
        'For type_text: the text. For press_key/hold_key: the chord string. For click/scroll: modifier keys to hold.',
    },
    scroll_direction: {
      type: 'string',
      enum: ['up', 'down', 'left', 'right'],
    },
    scroll_amount: { type: 'integer', minimum: 0, maximum: 100 },
    duration: {
      type: 'number',
      description: 'Seconds (0–100). For hold_key/wait.',
    },
    repeat: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      description: 'For press_key: repeat count.',
    },
  },
  required: ['action'],
};

/** Build the 22-tool list. Pure data — no environment reads. */
export function buildComputerUseTools(): Tool[] {
  const screenshotDesc =
    'Take a screenshot of the primary display. On this platform, screenshots are NOT filtered — all open windows are visible.';

  return [
    {
      name: 'screenshot',
      description:
        screenshotDesc +
        ' The returned image is what subsequent click coordinates are relative to.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          save_to_disk: saveToDisk,
        },
        required: [],
      },
    },

    {
      name: 'zoom',
      description:
        'Take a higher-resolution screenshot of a specific region of the last full-screen screenshot. Use this liberally to inspect small text, button labels, or fine UI details that are hard to read in the downsampled full-screen image. ' +
        'IMPORTANT: Coordinates in subsequent click calls always refer to the full-screen screenshot, never the zoomed image. This tool is read-only for inspecting detail.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          region: {
            type: 'array',
            items: { type: 'integer' },
            minItems: 4,
            maxItems: 4,
            description:
              '(x0, y0, x1, y1): Rectangle to zoom into, in the coordinate space of the most recent full-screen screenshot. x0,y0 = top-left, x1,y1 = bottom-right.',
          },
          save_to_disk: saveToDisk,
        },
        required: ['region'],
      },
    },

    {
      name: 'click',
      description: `Left-click at the given coordinates. ${FRONTMOST_GATE_DESC}`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          coordinate: coordinateTuple,
          text: clickModifierText,
        },
        required: ['coordinate'],
      },
    },

    {
      name: 'double_click',
      description: `Double-click at the given coordinates. Selects a word in most text editors. ${FRONTMOST_GATE_DESC}`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          coordinate: coordinateTuple,
          text: clickModifierText,
        },
        required: ['coordinate'],
      },
    },

    {
      name: 'triple_click',
      description: `Triple-click at the given coordinates. Selects a line in most text editors. ${FRONTMOST_GATE_DESC}`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          coordinate: coordinateTuple,
          text: clickModifierText,
        },
        required: ['coordinate'],
      },
    },

    {
      name: 'right_click',
      description: `Right-click at the given coordinates. Opens a context menu in most applications. ${FRONTMOST_GATE_DESC}`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          coordinate: coordinateTuple,
          text: clickModifierText,
        },
        required: ['coordinate'],
      },
    },

    {
      name: 'middle_click',
      description: `Middle-click (scroll-wheel click) at the given coordinates. ${FRONTMOST_GATE_DESC}`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          coordinate: coordinateTuple,
          text: clickModifierText,
        },
        required: ['coordinate'],
      },
    },

    {
      name: 'type_text',
      description: `Type text into whatever currently has keyboard focus. ${FRONTMOST_GATE_DESC} Newlines are supported. For keyboard shortcuts use \`press_key\` instead.`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          text: { type: 'string', description: 'Text to type.' },
        },
        required: ['text'],
      },
    },

    {
      name: 'press_key',
      description:
        `Press a key or key combination (e.g. "return", "escape", "cmd+a", "ctrl+shift+tab"). ${FRONTMOST_GATE_DESC} ` +
        'System-level combos (close window, switch window, lock screen, show desktop) require the `systemKeyCombos` grant — without it they return an error. All other combos work.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          text: {
            type: 'string',
            description: 'Modifiers joined with "+", e.g. "cmd+shift+a".',
          },
          repeat: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            description:
              'Number of times to repeat the key press. Default is 1.',
          },
        },
        required: ['text'],
      },
    },

    {
      name: 'scroll',
      description: `Scroll at the given coordinates. ${FRONTMOST_GATE_DESC}`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          coordinate: coordinateTuple,
          scroll_direction: {
            type: 'string',
            enum: ['up', 'down', 'left', 'right'],
            description: 'Direction to scroll.',
          },
          scroll_amount: {
            type: 'integer',
            minimum: 0,
            maximum: 100,
            description: 'Number of scroll ticks.',
          },
        },
        required: ['coordinate', 'scroll_direction', 'scroll_amount'],
      },
    },

    {
      name: 'drag',
      description: `Press, move to target, and release. ${FRONTMOST_GATE_DESC}`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          coordinate: {
            ...coordinateTuple,
            description: `(x, y) end point: ${COORD_DESC.x}`,
          },
          start_coordinate: {
            ...coordinateTuple,
            description: `(x, y) start point. If omitted, drags from the current cursor position. ${COORD_DESC.x}`,
          },
        },
        required: ['coordinate'],
      },
    },

    {
      name: 'move_mouse',
      description: `Move the mouse cursor without clicking. Useful for triggering hover states. ${FRONTMOST_GATE_DESC}`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          coordinate: coordinateTuple,
        },
        required: ['coordinate'],
      },
    },

    {
      name: 'open_app',
      description:
        'Bring an installed application to the front, launching it if necessary. The application is resolved against the installed-app inventory before launch.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          app: {
            type: 'string',
            description:
              'Display name (e.g. "Notepad") or executable stem (e.g. "notepad").',
          },
        },
        required: ['app'],
      },
    },

    {
      name: 'switch_display',
      description:
        'Switch which monitor subsequent screenshots capture. Use this when the ' +
        'application you need is on a different monitor than the one shown. ' +
        'The screenshot tool tells you which monitor it captured and lists ' +
        'other attached monitors by name — pass one of those names here. ' +
        'After switching, call screenshot to see the new monitor. ' +
        'Pass "auto" to return to automatic monitor selection.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          display: {
            type: 'string',
            description:
              'Monitor name from the screenshot note (e.g. "\\\\.\\DISPLAY1", ' +
              '"Generic PnP Monitor"), or "auto" to re-enable automatic selection.',
          },
        },
        required: ['display'],
      },
    },

    {
      name: 'read_clipboard',
      description:
        'Read the current clipboard contents as text. Requires the `clipboardRead` grant.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },

    {
      name: 'write_clipboard',
      description:
        'Write text to the clipboard. Requires the `clipboardWrite` grant.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          text: { type: 'string' },
        },
        required: ['text'],
      },
    },

    {
      name: 'wait',
      description: 'Wait for a specified duration.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          duration: {
            type: 'number',
            description: 'Duration in seconds (0–100).',
          },
        },
        required: ['duration'],
      },
    },

    {
      name: 'cursor_position',
      description:
        'Get the current mouse cursor position. Returns image-pixel coordinates relative to the most recent screenshot, or logical points if no screenshot has been taken.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },

    {
      name: 'hold_key',
      description:
        `Press and hold a key or key combination for the specified duration, then release. ${FRONTMOST_GATE_DESC} ` +
        'System-level combos require the `systemKeyCombos` grant.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          text: {
            type: 'string',
            description: 'Key or chord to hold, e.g. "space", "shift+down".',
          },
          duration: {
            type: 'number',
            description: 'Duration in seconds (0–100).',
          },
        },
        required: ['text', 'duration'],
      },
    },

    {
      name: 'mouse_down',
      description:
        `Press the left mouse button at the current cursor position and leave it held. ${FRONTMOST_GATE_DESC} ` +
        'Use move_mouse first to position the cursor. Call mouse_up to release. Errors if the button is already held.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },

    {
      name: 'mouse_up',
      description:
        `Release the left mouse button at the current cursor position. ${FRONTMOST_GATE_DESC} ` +
        'Pairs with mouse_down. Safe to call even if the button is not currently held.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },

    {
      name: 'batch',
      description:
        'Execute a sequence of actions in ONE tool call. Each individual tool call requires a model→API round trip (seconds); ' +
        'batching a predictable sequence eliminates all but one. Use this whenever you can predict the outcome of several actions ahead — ' +
        'e.g. click a field, type into it, press Return. Actions execute sequentially and stop on the first error. ' +
        `${FRONTMOST_GATE_DESC} The frontmost check runs before EACH action inside the batch — if an action opens a non-allowed app, the next action's gate fires and the batch stops there. ` +
        'Mid-batch screenshot actions are allowed for inspection but coordinates in subsequent clicks always refer to the PRE-BATCH full-screen screenshot.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          actions: {
            type: 'array',
            minItems: 1,
            items: BATCH_ACTION_ITEM_SCHEMA,
            description:
              'List of actions. Example: [{"action":"click","coordinate":[100,200]},{"action":"type_text","text":"hello"},{"action":"press_key","text":"Return"}]',
          },
        },
        required: ['actions'],
      },
    },
  ];
}

/**
 * Actions allowed inside a batch call. Excludes open_app and clipboard (no
 * latency benefit, complicates the security model).
 */
export const BATCHABLE_ACTIONS: ReadonlySet<string> = new Set([
  'press_key',
  'type_text',
  'move_mouse',
  'click',
  'drag',
  'right_click',
  'middle_click',
  'double_click',
  'triple_click',
  'scroll',
  'hold_key',
  'screenshot',
  'cursor_position',
  'mouse_down',
  'mouse_up',
  'wait',
]);
