/**
 * Tool dispatch: every security decision enforced BEFORE any worker call.
 *
 * Gate order, every call (plan §7.1):
 *   1. kill switch (COMPUTER_USE_DISABLED)
 *   2. per-tool argument validation (pure, bad_args)
 *   3. cross-process file lock (cu_lock_held)
 *   4. foreground app identification (state_conflict — the target comes from
 *      "what is in front", so not knowing means not knowing where input goes)
 *   5. delivery pre-checks live in the worker (point_outside_display /
 *      target_window_offscreen)
 *   6. (click variants only) pixelCompare staleness check
 *   7. execute
 *
 * Any gate failure returns a tool error and the executor is never called
 * (fail-closed). Blocklist checks run BEFORE the gates for press_key,
 * hold_key and click modifiers: a blocked combo with an ungranted app
 * frontmost should return the blocklist error, not the frontmost error.
 *
 * Port of the windowsLegacyToolCalls.ts handlers, adapted to the worker
 * protocol and the semantic tool names.
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import sharp from 'sharp';
import type { Sharp } from 'sharp';

import { config } from '../core/config.js';
import {
  BATCHABLE_ACTIONS,
  buildComputerUseTools,
  coordToPercentageForPixelCompare,
  decodedByteLength,
  isSystemKeyCombo,
  MIN_SCREENSHOT_BYTES,
  segmentGraphemes,
  uniqueDisplayLabels,
  validateClickTarget,
  type CropRawPatchFn,
} from '../core/index.js';
import { CuToolError, formatToolErrorText, toolError } from '../core/errors.js';
import {
  imagePixelsFromLogical,
  scaleCoordPixels,
} from '../core/coordinates.js';
import { buildMonitorNote } from '../core/displayLabels.js';
import type { DisplayGeometry, ScreenshotResult } from '../core/types.js';
import {
  extractCoordinate,
  extractDuration,
  extractRegion,
  extractRepeat,
  extractScrollAmount,
  extractScrollDirection,
  requireString,
} from '../core/validation.js';
import type { WorkerClient } from './workerClient.js';
import { FileLock } from './fileLock.js';
import { createLogger } from './logging.js';
import {
  createSessionState,
  MouseHoldLedger,
  sessionMouseOwner,
  type SessionState,
} from './session.js';

const logger = createLogger('dispatch');

/** One content block of a tool result. */
export type CuContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: 'image/jpeg' };

export interface ToolResult {
  content: CuContent[];
  isError?: boolean;
}

export interface ToolContext {
  signal?: AbortSignal;
}

export interface InstalledAppInfo {
  bundleId: string;
  displayName: string;
  path?: string;
}

interface DispatchFlags {
  /** Inside batch: never stash screenshots (coords stay pre-batch). */
  inBatch: boolean;
}

export class ToolDispatcher {
  private readonly state: SessionState = createSessionState();
  private readonly holds = new MouseHoldLedger();
  private clipboardStash: string | undefined;

  constructor(
    private readonly worker: WorkerClient,
    private readonly lock: FileLock,
  ) {}

  /** The tool list advertised over MCP. */
  tools() {
    return buildComputerUseTools();
  }

  /** Clear cross-call state (a fresh lock holder must not inherit a drag). */
  resetSessionState(): void {
    this.state.lastScreenshot = undefined;
    this.state.selectedDisplayId = undefined;
    this.state.displayPinnedByModel = false;
    this.state.lastDisplayId = undefined;
    this.state.displayResolvedForApps = undefined;
    this.holds.clear();
    this.clipboardStash = undefined;
  }

  async handleToolCall(
    name: string,
    args: Record<string, unknown>,
    context: ToolContext = {},
  ): Promise<ToolResult> {
    try {
      // Gate 1: kill switch.
      if (config.disabled) {
        throw new CuToolError(
          'other',
          'Computer control is disabled (COMPUTER_USE_DISABLED). Enable it and try again.',
        );
      }
      const aborted = (): void => {
        if (context.signal?.aborted) {
          throw new CuToolError(
            'user_interference_result_unknown',
            `Computer Use was cancelled before ${name} completed. The action may have been dispatched — take a screenshot to confirm the current state.`,
          );
        }
      };
      aborted();

      const known = this.tools().some((tool) => tool.name === name);
      if (!known) {
        throw new CuToolError('bad_args', `Unknown tool "${name}".`);
      }

      if (name === 'wait') {
        // No system access at all: skip lock and worker.
        return await this.handleWait(args, aborted);
      }

      // Gate 3: cross-process lock, acquired once and held for the session.
      this.lock.acquire();
      if (!this.holds.hasHeldFor(sessionMouseOwner)) {
        this.holds.clear();
      }

      const result = await this.dispatch(name, args, aborted, {
        inBatch: false,
      });
      aborted();
      return result;
    } catch (error) {
      return toToolResult(error);
    }
  }

  private async dispatch(
    name: string,
    args: Record<string, unknown>,
    aborted: () => void,
    flags: DispatchFlags,
  ): Promise<ToolResult> {
    switch (name) {
      case 'screenshot':
        return this.handleScreenshot(args, flags);
      case 'zoom':
        return this.handleZoom(args);
      case 'click':
      case 'double_click':
      case 'triple_click':
      case 'right_click':
      case 'middle_click':
        return this.handleClickVariant(name, args, aborted);
      case 'type_text':
        return this.handleType(args, aborted);
      case 'press_key':
        return this.handleKey(args, aborted);
      case 'scroll':
        return this.handleScroll(args, aborted);
      case 'drag':
        return this.handleDrag(args, aborted);
      case 'move_mouse':
        return this.handleMoveMouse(args, aborted);
      case 'open_app':
        return this.handleOpenApp(args);
      case 'switch_display':
        return this.handleSwitchDisplay(args);
      case 'read_clipboard':
        return this.handleReadClipboard();
      case 'write_clipboard':
        return this.handleWriteClipboard(args);
      case 'cursor_position':
        return this.handleCursorPosition();
      case 'hold_key':
        return this.handleHoldKey(args, aborted);
      case 'mouse_down':
        return this.handleMouseDown(aborted);
      case 'mouse_up':
        return this.handleMouseUp(aborted);
      case 'batch':
        return this.handleBatch(args, aborted);
      default:
        throw new CuToolError('bad_args', `Unknown tool "${name}".`);
    }
  }

  // --- worker call helper ----------------------------------------------------

  private async call<T>(
    action: string,
    payload: Record<string, unknown> = {},
  ): Promise<T> {
    return (await this.worker.request(action, payload)) as T;
  }

  /**
   * Refuse input when the foreground application cannot be identified: the
   * target of every input action is "whatever is in front", so not knowing
   * means not knowing where the input goes.
   */
  private async ensureFrontmostIdentified(): Promise<void> {
    const front = await this.call<InstalledAppInfo | null>('frontmost_app');
    if (!front) {
      throw new CuToolError(
        'state_conflict',
        'The foreground application could not be identified. Refusing input ' +
          'until a supported application is brought to the front.',
      );
    }
  }

  // --- screenshot / zoom -------------------------------------------------------

  private async handleScreenshot(
    args: Record<string, unknown>,
    flags: DispatchFlags,
  ): Promise<ToolResult> {
    const shot = await this.call<ScreenshotResult>('screenshot', {
      displayId: this.state.selectedDisplayId,
    });
    if (decodedByteLength(shot.base64) < MIN_SCREENSHOT_BYTES) {
      logger.warn(
        `screenshot implausibly small (${decodedByteLength(shot.base64)} bytes decoded), retrying once`,
      );
      const retry = await this.call<ScreenshotResult>('screenshot', {
        displayId: this.state.selectedDisplayId,
      });
      if (decodedByteLength(retry.base64) > decodedByteLength(shot.base64)) {
        Object.assign(shot, retry);
      }
    }

    let note: string | undefined;
    try {
      const displays = await this.call<DisplayGeometry[]>('list_displays');
      note = buildMonitorNote(
        displays,
        shot.displayId,
        this.state.lastDisplayId,
        this.state.displayPinnedByModel,
      );
    } catch (error) {
      logger.warn(`listDisplays failed: ${String(error)}`);
    }

    // Only a top-level screenshot becomes the coordinate baseline; mid-batch
    // screenshots are inspection-only (plan §7.6 invariant).
    if (!flags.inBatch) {
      this.state.lastScreenshot = shot;
      this.state.lastDisplayId = shot.displayId;
    }

    const content: CuContent[] = [];
    if (note) content.push({ type: 'text', text: note });
    if (args.save_to_disk === true) {
      content.push({
        type: 'text',
        text: `Saved to ${saveBase64Image(shot.base64, 'screenshot')}`,
      });
    }
    content.push({ type: 'image', data: shot.base64, mimeType: 'image/jpeg' });
    return { content };
  }

  /**
   * Region-crop upscaled screenshot. The return carries NO baseline update —
   * click coordinates always refer to the full-screen screenshot
   * (win_helper.py handleZoom invariant).
   */
  private async handleZoom(args: Record<string, unknown>): Promise<ToolResult> {
    const region = extractRegion(args);
    if (region instanceof Error) {
      throw new CuToolError('bad_args', region.message);
    }
    const last = this.state.lastScreenshot;
    if (!last) {
      throw new CuToolError(
        'state_conflict',
        'take a screenshot before zooming (region coords are relative to it)',
      );
    }
    if (region.x1 > last.width || region.y1 > last.height) {
      throw new CuToolError(
        'bad_args',
        `region exceeds screenshot bounds (${last.width}×${last.height})`,
      );
    }
    // image-px → physical px: the same capture-time ratio scaleCoord uses.
    const ratioX = last.displayWidth / last.width;
    const ratioY = last.displayHeight / last.height;
    const zoomed = await this.call<{
      base64: string;
      width: number;
      height: number;
    }>('zoom', {
      x: region.x0 * ratioX + last.originX,
      y: region.y0 * ratioY + last.originY,
      width: (region.x1 - region.x0) * ratioX,
      height: (region.y1 - region.y0) * ratioY,
      targetWidth: region.x1 - region.x0,
      targetHeight: region.y1 - region.y0,
    });
    const content: CuContent[] = [];
    if (args.save_to_disk === true) {
      content.push({
        type: 'text',
        text: `Saved to ${saveBase64Image(zoomed.base64, 'zoom')}`,
      });
    }
    content.push({
      type: 'image',
      data: zoomed.base64,
      mimeType: 'image/jpeg',
    });
    return { content };
  }

  // --- clicks -------------------------------------------------------------------

  private async handleClickVariant(
    name: string,
    args: Record<string, unknown>,
    aborted: () => void,
  ): Promise<ToolResult> {
    const button =
      name === 'right_click'
        ? 'right'
        : name === 'middle_click'
          ? 'middle'
          : 'left';
    const count = name === 'double_click' ? 2 : name === 'triple_click' ? 3 : 1;

    // Release a previous unmatched mouseDown before an atomic click.
    await this.releaseHeld();

    const coord = extractCoordinate(args);
    if (coord instanceof Error) {
      throw new CuToolError('bad_args', coord.message);
    }
    const [rawX, rawY] = coord;

    let modifiers: string[] | undefined;
    if (args.text !== undefined) {
      if (typeof args.text !== 'string') {
        throw new CuToolError('bad_args', 'text must be a string');
      }
      // Same gate as press_key: a non-modifier in text= fires while held
      // (text="cmd+q" presses Cmd, then Q — Cmd+Q fires before the click).
      if (isSystemKeyCombo(args.text) && !config.allowSystemKeys) {
        throw new CuToolError(
          'grant_flag_required',
          `The modifier chord "${args.text}" would fire a system shortcut. ` +
            'Enable Computer Use again to accept system-shortcut access, or use ' +
            'only modifier keys (shift, ctrl, alt, win) in the text parameter.',
        );
      }
      modifiers = args.text
        .split('+')
        .map((part) => part.trim())
        .filter(Boolean);
    }

    await this.ensureFrontmostIdentified();

    const display = await this.call<DisplayGeometry>('get_display_size', {
      displayId: this.state.selectedDisplayId,
    });

    await this.validateClickTargetIfEnabled(rawX, rawY);

    const { x, y } = scaleCoordPixels(
      rawX,
      rawY,
      display,
      this.state.lastScreenshot,
      logger,
    );
    aborted();
    await this.call('click', {
      x,
      y,
      button,
      count,
      modifiers,
      animate: config.mouseAnimation,
    });
    return text(`Clicked (${button}${count > 1 ? ` ×${count}` : ''}).`);
  }

  // --- typing ---------------------------------------------------------------------

  private async handleType(
    args: Record<string, unknown>,
    aborted: () => void,
  ): Promise<ToolResult> {
    const value = requireString(args, 'text');
    if (value instanceof Error) {
      throw new CuToolError('bad_args', value.message);
    }
    await this.ensureFrontmostIdentified();

    // Multi-line text goes through the clipboard paste fast path with
    // save/restore of the user's clipboard (plan §7.6).
    const viaClipboard = value.includes('\n') && config.allowClipboardWrite;
    if (viaClipboard) {
      const previous = await this.call<string>('read_clipboard');
      if (this.clipboardStash === undefined) {
        this.clipboardStash = previous;
      }
      await this.call('write_clipboard', { text: value });
      aborted();
      await this.call('paste_clipboard');
      await this.restoreClipboard();
      return text('Typed (via clipboard).');
    }

    const graphemes = segmentGraphemes(value);
    aborted();
    if (graphemes.length > 0) {
      await this.call('type', { text: value });
    }
    return text(`Typed ${graphemes.length} grapheme(s).`);
  }

  /**
   * Restore the stashed clipboard. A transient failure KEEPS the stash so a
   * later action can retry (plan §7.6).
   */
  private async restoreClipboard(): Promise<void> {
    const stashed = this.clipboardStash;
    if (stashed === undefined) return;
    try {
      await this.call('write_clipboard', { text: stashed });
      this.clipboardStash = undefined;
    } catch (error) {
      logger.warn(`clipboard restore deferred: ${String(error)}`);
    }
  }

  // --- keyboard --------------------------------------------------------------------

  private async handleKey(
    args: Record<string, unknown>,
    aborted: () => void,
  ): Promise<ToolResult> {
    const keySequence = requireString(args, 'text');
    if (keySequence instanceof Error) {
      throw new CuToolError('bad_args', 'text is required');
    }
    const repeat = extractRepeat(args);
    if (repeat instanceof Error) {
      throw new CuToolError('bad_args', repeat.message);
    }
    // Blocklist BEFORE gates.
    if (isSystemKeyCombo(keySequence) && !config.allowSystemKeys) {
      throw new CuToolError(
        'grant_flag_required',
        `"${keySequence}" is a system-level shortcut. Re-enable Computer Use and accept the risk notice to use it.`,
      );
    }
    await this.ensureFrontmostIdentified();
    aborted();
    await this.call('key', { keySequence, repeat: repeat ?? 1 });
    return text('Key pressed.');
  }

  private async handleScroll(
    args: Record<string, unknown>,
    aborted: () => void,
  ): Promise<ToolResult> {
    const coord = extractCoordinate(args);
    if (coord instanceof Error) {
      throw new CuToolError('bad_args', coord.message);
    }
    const direction = extractScrollDirection(args);
    if (direction instanceof Error) {
      throw new CuToolError('bad_args', direction.message);
    }
    const amount = extractScrollAmount(args);
    if (amount instanceof Error) {
      throw new CuToolError('bad_args', amount.message);
    }
    // up → dy = -amount; down → dy = +amount; left → dx = -amount; right → dx = +amount.
    const dx =
      direction === 'left' ? -amount : direction === 'right' ? amount : 0;
    const dy = direction === 'up' ? -amount : direction === 'down' ? amount : 0;
    await this.ensureFrontmostIdentified();
    const display = await this.call<DisplayGeometry>('get_display_size', {
      displayId: this.state.selectedDisplayId,
    });
    const { x, y } = scaleCoordPixels(
      coord[0],
      coord[1],
      display,
      this.state.lastScreenshot,
      logger,
    );
    aborted();
    await this.call('scroll', {
      x,
      y,
      deltaX: dx,
      deltaY: dy,
      animate: config.mouseAnimation,
    });
    return text('Scrolled.');
  }

  private async handleDrag(
    args: Record<string, unknown>,
    aborted: () => void,
  ): Promise<ToolResult> {
    // executor drag() does its own press+release; clear a stale hold first so
    // the button state does not desync.
    await this.releaseHeld();
    const endCoord = extractCoordinate(args, 'coordinate');
    if (endCoord instanceof Error) {
      throw new CuToolError('bad_args', endCoord.message);
    }
    let rawFrom: [number, number] | undefined;
    if (args.start_coordinate !== undefined) {
      const startCoord = extractCoordinate(args, 'start_coordinate');
      if (startCoord instanceof Error) {
        throw new CuToolError('bad_args', startCoord.message);
      }
      rawFrom = startCoord;
    }
    await this.ensureFrontmostIdentified();
    const display = await this.call<DisplayGeometry>('get_display_size', {
      displayId: this.state.selectedDisplayId,
    });
    const from =
      rawFrom === undefined
        ? undefined
        : scaleCoordPixels(
            rawFrom[0],
            rawFrom[1],
            display,
            this.state.lastScreenshot,
            logger,
          );
    const to = scaleCoordPixels(
      endCoord[0],
      endCoord[1],
      display,
      this.state.lastScreenshot,
      logger,
    );
    aborted();
    await this.call('drag', { from, to, animate: config.mouseAnimation });
    return text('Dragged.');
  }

  private async handleMoveMouse(
    args: Record<string, unknown>,
    aborted: () => void,
  ): Promise<ToolResult> {
    const coord = extractCoordinate(args);
    if (coord instanceof Error) {
      throw new CuToolError('bad_args', coord.message);
    }
    await this.ensureFrontmostIdentified();
    const display = await this.call<DisplayGeometry>('get_display_size', {
      displayId: this.state.selectedDisplayId,
    });
    const { x, y } = scaleCoordPixels(
      coord[0],
      coord[1],
      display,
      this.state.lastScreenshot,
      logger,
    );
    aborted();
    await this.call('move_mouse', { x, y, animate: config.mouseAnimation });
    return text('Moved.');
  }

  // --- apps -----------------------------------------------------------------------

  private async handleOpenApp(
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const app = requireString(args, 'app');
    if (app instanceof Error) {
      throw new CuToolError('bad_args', app.message);
    }
    // Resolve only against the worker's inventory. Never pass an arbitrary
    // model string to the shell.
    const installed = await this.call<InstalledAppInfo[]>(
      'list_installed_apps',
    );
    const wanted = app.trim().toLowerCase();
    const match = installed.find(
      (candidate) =>
        candidate.bundleId.toLowerCase() === wanted ||
        candidate.displayName.toLowerCase() === wanted,
    );
    if (!match) {
      throw new CuToolError(
        'bad_args',
        `"${app}" was not found in the installed application inventory.`,
      );
    }
    await this.call('open_app', { bundleId: match.bundleId });
    if (this.state.displayPinnedByModel) {
      let displayCount = 1;
      try {
        displayCount = (await this.call<DisplayGeometry[]>('list_displays'))
          .length;
      } catch {
        // hint skipped
      }
      if (displayCount >= 2) {
        return text(
          `Opened "${app}". If it isn't visible in the next screenshot, it may ` +
            'have opened on a different monitor — use switch_display to check.',
        );
      }
    }
    return text(`Opened "${app}".`);
  }

  private async handleSwitchDisplay(
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const display = requireString(args, 'display');
    if (display instanceof Error) {
      throw new CuToolError('bad_args', display.message);
    }
    if (display.toLowerCase() === 'auto') {
      this.state.displayPinnedByModel = false;
      this.state.selectedDisplayId = undefined;
      return text(
        'Returned to automatic monitor selection. Call screenshot to continue.',
      );
    }
    let displays: DisplayGeometry[];
    try {
      displays = await this.call<DisplayGeometry[]>('list_displays');
    } catch (error) {
      throw new CuToolError(
        'display_error',
        `Failed to enumerate displays: ${String(error)}`,
      );
    }
    if (displays.length < 2) {
      throw new CuToolError(
        'bad_args',
        'Only one monitor is connected. There is nothing to switch to.',
      );
    }
    // Resolve label → displayId fresh: whatever name the model saw in a
    // screenshot note resolves here.
    const labels = uniqueDisplayLabels(displays);
    const wanted = display.toLowerCase();
    const target = displays.find(
      (d) => labels.get(d.displayId)?.toLowerCase() === wanted,
    );
    if (!target) {
      const available = displays
        .map((d) => `"${labels.get(d.displayId)}"`)
        .join(', ');
      throw new CuToolError(
        'bad_args',
        `No monitor named "${display}" is connected. Available monitors: ${available}.`,
      );
    }
    this.state.displayPinnedByModel = true;
    this.state.selectedDisplayId = target.displayId;
    return text(
      `Switched to monitor "${labels.get(target.displayId)}". Call screenshot to see it.`,
    );
  }

  // --- clipboard --------------------------------------------------------------------

  private async handleReadClipboard(): Promise<ToolResult> {
    if (!config.allowClipboardRead) {
      throw new CuToolError(
        'grant_flag_required',
        'Clipboard read is disabled. Re-enable Computer Use and accept the risk notice.',
      );
    }
    const value = await this.call<string>('read_clipboard');
    return json({ text: value });
  }

  private async handleWriteClipboard(
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    if (!config.allowClipboardWrite) {
      throw new CuToolError(
        'grant_flag_required',
        'Clipboard write is disabled. Re-enable Computer Use and accept the risk notice.',
      );
    }
    const value = requireString(args, 'text');
    if (value instanceof Error) {
      throw new CuToolError('bad_args', value.message);
    }
    await this.call('write_clipboard', { text: value });
    return text('Clipboard written.');
  }

  private async handleWait(
    args: Record<string, unknown>,
    aborted: () => void,
  ): Promise<ToolResult> {
    const duration = extractDuration(args);
    if (duration instanceof Error) {
      throw new CuToolError('bad_args', duration.message);
    }
    // No frontmost gate: no input, nothing to protect.
    const deadline = Date.now() + duration * 1000;
    while (Date.now() < deadline) {
      aborted();
      await sleepMs(50);
    }
    return text(`Waited ${duration}s.`);
  }

  private async handleCursorPosition(): Promise<ToolResult> {
    const logical = await this.call<{ x: number; y: number }>(
      'cursor_position',
    );
    const shot = this.state.lastScreenshot;
    const image = imagePixelsFromLogical(logical.x, logical.y, shot);
    if (image) {
      return json({ x: image.x, y: image.y, coordinateSpace: 'image_pixels' });
    }
    return json({
      x: logical.x,
      y: logical.y,
      coordinateSpace: 'logical_points',
      note: shot
        ? 'cursor is on a different monitor than your last screenshot; take a fresh screenshot'
        : 'take a screenshot first for image-pixel coordinates',
    });
  }

  private async handleHoldKey(
    args: Record<string, unknown>,
    aborted: () => void,
  ): Promise<ToolResult> {
    const keyText = requireString(args, 'text');
    if (keyText instanceof Error) {
      throw new CuToolError('bad_args', keyText.message);
    }
    const duration = extractDuration(args);
    if (duration instanceof Error) {
      throw new CuToolError('bad_args', duration.message);
    }
    // Holding cmd+q is just as dangerous as tapping it.
    if (isSystemKeyCombo(keyText) && !config.allowSystemKeys) {
      throw new CuToolError(
        'grant_flag_required',
        `"${keyText}" is a system-level shortcut. Re-enable Computer Use and accept the risk notice to use it.`,
      );
    }
    await this.ensureFrontmostIdentified();
    const keyNames = keyText
      .split('+')
      .map((part) => part.trim())
      .filter(Boolean);
    aborted();
    await this.call('hold_key', { keyNames, durationMs: duration * 1000 });
    return text('Key held.');
  }

  private async handleMouseDown(aborted: () => void): Promise<ToolResult> {
    if (this.holds.isHeld) {
      throw new CuToolError(
        'state_conflict',
        'mouse button already held, call mouse_up first',
      );
    }
    await this.ensureFrontmostIdentified();
    aborted();
    await this.call('mouse_down');
    this.holds.press(sessionMouseOwner);
    return text('Mouse button pressed.');
  }

  private async handleMouseUp(aborted: () => void): Promise<ToolResult> {
    // Always release a held button when the target becomes unknown, so a
    // failed action cannot leave the user's mouse stuck down.
    const releaseFirst = async (error: CuToolError): Promise<ToolResult> => {
      await this.call('mouse_up').catch(() => undefined);
      this.holds.clear();
      return toToolResult(error);
    };
    try {
      await this.ensureFrontmostIdentified();
    } catch (error) {
      if (error instanceof CuToolError) return releaseFirst(error);
      throw error;
    }
    aborted();
    await this.call('mouse_up');
    this.holds.clear();
    return text('Mouse button released.');
  }

  // --- batch -------------------------------------------------------------------------

  /**
   * Execute actions in ONE tool call (cc-haha handleComputerBatch):
   *   - foreground identification checked PER action (state can change);
   *   - pixelCompare skipped — the model committed without intermediate shots;
   *   - stop-on-first-error, returning everything completed so far;
   *   - mid-batch screenshots allowed for inspection but NEVER baseline —
   *     click coordinates always refer to the PRE-BATCH screenshot;
   *   - coordinates stay relative to the pre-batch lastScreenshot (inBatch
   *     never stashes a new baseline).
   */
  private async handleBatch(
    args: Record<string, unknown>,
    aborted: () => void,
  ): Promise<ToolResult> {
    const actions = args.actions;
    if (!Array.isArray(actions) || actions.length === 0) {
      throw new CuToolError('bad_args', 'actions must be a non-empty array');
    }
    for (const [index, action] of actions.entries()) {
      if (typeof action !== 'object' || action === null) {
        throw new CuToolError(
          'bad_args',
          `actions[${index}] must be an object`,
        );
      }
      const name = (action as Record<string, unknown>).action;
      if (typeof name !== 'string') {
        throw new CuToolError(
          'bad_args',
          `actions[${index}].action must be a string`,
        );
      }
      if (!BATCHABLE_ACTIONS.has(name)) {
        throw new CuToolError(
          'bad_args',
          `actions[${index}].action="${name}" is not allowed in a batch. ` +
            `Allowed: ${[...BATCHABLE_ACTIONS].join(', ')}.`,
        );
      }
    }

    const results: Array<{ action: string; ok: boolean; output: string }> = [];
    for (const [index, action] of actions.entries()) {
      if (contextAborted(aborted)) {
        await this.releaseHeld();
        return errorResult(
          `Batch aborted after ${results.length} of ${actions.length} actions (user interrupt).`,
        );
      }
      // Small inter-step settle: some apps need a tick to process step N's
      // input before step N+1 lands (e.g. a click opening a menu).
      if (index > 0) await sleepMs(10);

      const actionArgs = action as Record<string, unknown>;
      const actionName = actionArgs.action as string;
      try {
        const inner = await this.dispatch(actionName, actionArgs, aborted, {
          inBatch: true,
        });
        results.push({
          action: actionName,
          ok: true,
          output: firstText(inner.content),
        });
      } catch (error) {
        const toolErr = toToolResult(error);
        results.push({
          action: actionName,
          ok: false,
          output: firstText(toolErr.content),
        });
        await this.releaseHeld();
        return json({
          completed: results.slice(0, -1),
          failed: results[results.length - 1],
          remaining: actions.length - results.length,
        });
      }
    }
    return json({ completed: results });
  }

  // --- pixelCompare --------------------------------------------------------------------

  private async validateClickTargetIfEnabled(
    rawX: number,
    rawY: number,
  ): Promise<void> {
    if (!config.pixelValidation) return;
    const last = this.state.lastScreenshot;
    if (!last) return;
    const { xPct, yPct } = coordToPercentageForPixelCompare(rawX, rawY, last);
    const validation = await validateClickTarget(
      this.cropRawPatch(),
      last,
      xPct,
      yPct,
      async () => {
        try {
          return await this.call<ScreenshotResult>('screenshot', {
            displayId: last.displayId,
          });
        } catch {
          return null;
        }
      },
      logger,
      config.pixelValidationGrid,
    );
    if (!validation.valid && validation.warning) {
      throw new CuToolError('state_conflict', validation.warning);
    }
  }

  /** Injected crop: decode the screenshot JPEG and crop the raw patch. */
  private cropRawPatch(): CropRawPatchFn {
    const cache = new Map<string, Sharp>();
    return async (jpegBase64, rect): Promise<Buffer> => {
      const key = `${jpegBase64.length}:${jpegBase64.slice(0, 64)}`;
      let image = cache.get(key);
      if (!image) {
        image = sharp(Buffer.from(jpegBase64, 'base64'));
        cache.set(key, image);
      }
      const { data } = await image
        .clone()
        .extract({
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
        })
        .raw()
        .toBuffer({ resolveWithObject: true });
      return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    };
  }

  // --- held mouse -------------------------------------------------------------------------

  private async releaseHeld(): Promise<void> {
    await this.holds.release(sessionMouseOwner, async () => {
      await this.call('mouse_up');
    });
  }
}

// --- helpers ---------------------------------------------------------------------------------

function text(value: string): ToolResult {
  return { content: [{ type: 'text', text: value }] };
}

function json(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function errorResult(value: string): ToolResult {
  return { content: [{ type: 'text', text: value }], isError: true };
}

function firstText(content: CuContent[]): string {
  const first = content[0];
  return first && first.type === 'text' ? first.text : '';
}

function contextAborted(aborted: () => void): boolean {
  try {
    aborted();
    return false;
  } catch {
    return true;
  }
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Convert any thrown error into the tool result shape (fail-closed). */
export function toToolResult(error: unknown): ToolResult {
  if (error instanceof CuToolError) {
    return {
      content: [
        { type: 'text', text: formatToolErrorText(error.code, error.message) },
      ],
      isError: true,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`tool threw: ${message}`, error);
  return toolError('runtime_error', `Tool failed: ${message}`);
}

/** Save a base64 payload under the configured shot dir; returns the path. */
function saveBase64Image(base64: string, label: string): string {
  const dir = config.shotDir;
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(dir, `${label}-${stamp}-${randomUUID().slice(0, 8)}.jpg`);
  writeFileSync(path, Buffer.from(base64, 'base64'));
  return path;
}
