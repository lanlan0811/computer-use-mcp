/**
 * Tool-name mapping: cc-haha's original names → this project's semantic names.
 *
 * This is the ONLY transformation the snapshot contract test allows between
 * cc-haha's authoritative tool definitions (windowsLegacyTools.ts) and this
 * project's advertised tool list. Schema structure, parameter names, types,
 * enums and ranges stay 1:1; only the names change (plan decision 3/4).
 *
 * Keep in sync with scripts/extract-tool-snapshots.mjs, which imports this
 * file when regenerating tests/contract/__snapshots__/cc-haha-tools.json.
 */

/** cc-haha tool name → this project's tool name. */
export const CC_HAHA_TO_OUR_TOOL: Readonly<Record<string, string>> = {
  screenshot: 'screenshot',
  zoom: 'zoom',
  left_click: 'click',
  double_click: 'double_click',
  triple_click: 'triple_click',
  right_click: 'right_click',
  middle_click: 'middle_click',
  type: 'type_text',
  key: 'press_key',
  scroll: 'scroll',
  left_click_drag: 'drag',
  mouse_move: 'move_mouse',
  open_application: 'open_app',
  switch_display: 'switch_display',
  read_clipboard: 'read_clipboard',
  write_clipboard: 'write_clipboard',
  wait: 'wait',
  cursor_position: 'cursor_position',
  hold_key: 'hold_key',
  left_mouse_down: 'mouse_down',
  left_mouse_up: 'mouse_up',
  computer_batch: 'batch',
};

/** cc-haha batch action name → this project's tool name. */
export const CC_HAHA_TO_OUR_BATCH_ACTION: Readonly<Record<string, string>> = {
  key: 'press_key',
  type: 'type_text',
  mouse_move: 'move_mouse',
  left_click: 'click',
  left_click_drag: 'drag',
  right_click: 'right_click',
  middle_click: 'middle_click',
  double_click: 'double_click',
  triple_click: 'triple_click',
  scroll: 'scroll',
  hold_key: 'hold_key',
  screenshot: 'screenshot',
  cursor_position: 'cursor_position',
  left_mouse_down: 'mouse_down',
  left_mouse_up: 'mouse_up',
  wait: 'wait',
};

/** The 22 advertised tool names, in advertisement order. */
export const OUR_TOOL_NAMES: readonly string[] = [
  'screenshot',
  'zoom',
  'click',
  'double_click',
  'triple_click',
  'right_click',
  'middle_click',
  'type_text',
  'press_key',
  'scroll',
  'drag',
  'move_mouse',
  'open_app',
  'switch_display',
  'read_clipboard',
  'write_clipboard',
  'wait',
  'cursor_position',
  'hold_key',
  'mouse_down',
  'mouse_up',
  'batch',
];
