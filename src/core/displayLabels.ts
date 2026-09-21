/**
 * Monitor labels and the multi-monitor screenshot note.
 *
 * Port of windowsLegacyToolCalls.ts:1701-1776. Labels are deduplicated (same
 * name gets a stable `(N)` suffix) and assigned in displayId order so the
 * name the model sees in a screenshot note is the same name it can pass back
 * to switch_display — even if the display configuration reorders between the
 * two calls.
 */

import type { DisplayGeometry } from './types.js';

/** Fall back to `display N` when a display has no name. */
function fallbackLabel(displayId: number): string {
  return `display ${displayId}`;
}

/**
 * Assign a human-readable label to each display. Disambiguates identical
 * labels (matched-pair external monitors) with a `(2)` suffix, in displayId
 * order for stability.
 */
export function uniqueDisplayLabels(
  displays: readonly DisplayGeometry[],
): Map<number, string> {
  const sorted = [...displays].sort((a, b) => a.displayId - b.displayId);
  const counts = new Map<string, number>();
  const out = new Map<number, string>();
  for (const d of sorted) {
    const base = d.label ?? fallbackLabel(d.displayId);
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    out.set(d.displayId, n === 1 ? base : `${base} (${n})`);
  }
  return out;
}

/**
 * Build the monitor-context text that accompanies a screenshot. Tells the
 * model which monitor it's looking at (by human name), lists other attached
 * monitors, and flags when the monitor changed vs. the previous screenshot.
 *
 * Only emitted when there are 2+ displays AND (first screenshot OR the
 * display changed). Single-monitor setups and steady-state same-monitor
 * screenshots get no text — avoids noise. Pure function: the caller passes
 * the already-enumerated display list.
 */
export function buildMonitorNote(
  displays: readonly DisplayGeometry[],
  shotDisplayId: number,
  lastDisplayId: number | undefined,
  canSwitchDisplay: boolean,
): string | undefined {
  if (displays.length < 2) return undefined;

  const labels = uniqueDisplayLabels(displays);
  const nameOf = (id: number): string => labels.get(id) ?? fallbackLabel(id);

  const current = nameOf(shotDisplayId);
  const others = displays
    .filter((d) => d.displayId !== shotDisplayId)
    .map((d) => nameOf(d.displayId));
  const switchHint = canSwitchDisplay
    ? ' Use switch_display to capture a different monitor.'
    : '';
  const othersList =
    others.length > 0
      ? ` Other attached monitors: ${others.map((n) => `"${n}"`).join(', ')}.` +
        switchHint
      : '';

  // Treat displayId 0 the same as undefined (sentinel from old sessions
  // persisted pre-multimon).
  if (lastDisplayId === undefined || lastDisplayId === 0) {
    return `This screenshot was taken on monitor "${current}".` + othersList;
  }
  if (lastDisplayId !== shotDisplayId) {
    const prev = nameOf(lastDisplayId);
    return (
      `This screenshot was taken on monitor "${current}", which is different ` +
      `from your previous screenshot (taken on "${prev}").` +
      othersList
    );
  }
  return undefined;
}
