import { describe, expect, it } from 'vitest';

import {
  buildMonitorNote,
  uniqueDisplayLabels,
} from '../../src/core/displayLabels.js';
import type { DisplayGeometry } from '../../src/core/types.js';

const displays: DisplayGeometry[] = [
  {
    displayId: 2,
    width: 1920,
    height: 1080,
    scaleFactor: 1,
    originX: 1920,
    originY: 0,
    label: 'Right',
  },
  {
    displayId: 1,
    width: 1920,
    height: 1080,
    scaleFactor: 1,
    originX: 0,
    originY: 0,
    label: 'Main',
  },
];

describe('uniqueDisplayLabels', () => {
  it('keeps distinct labels as-is', () => {
    const labels = uniqueDisplayLabels(displays);
    expect(labels.get(1)).toBe('Main');
    expect(labels.get(2)).toBe('Right');
  });

  it('disambiguates identical labels with a stable (N) suffix', () => {
    const same = [
      {
        displayId: 3,
        width: 1920,
        height: 1080,
        scaleFactor: 1,
        originX: 0,
        originY: 0,
        label: 'Dual',
      },
      {
        displayId: 1,
        width: 1920,
        height: 1080,
        scaleFactor: 1,
        originX: 1920,
        originY: 0,
        label: 'Dual',
      },
      {
        displayId: 2,
        width: 1920,
        height: 1080,
        scaleFactor: 1,
        originX: 3840,
        originY: 0,
        label: 'Dual',
      },
    ];
    const labels = uniqueDisplayLabels(same);
    // Suffix assignment is by displayId order, not array order.
    expect(labels.get(1)).toBe('Dual');
    expect(labels.get(2)).toBe('Dual (2)');
    expect(labels.get(3)).toBe('Dual (3)');
  });

  it('falls back to "display N" when a display has no label', () => {
    const unlabeled: DisplayGeometry[] = [
      {
        displayId: 7,
        width: 1920,
        height: 1080,
        scaleFactor: 1,
        originX: 0,
        originY: 0,
      },
    ];
    const labels = uniqueDisplayLabels(unlabeled);
    expect(labels.get(7)).toBe('display 7');
  });
});

describe('buildMonitorNote', () => {
  it('returns undefined for single-monitor setups', () => {
    expect(
      buildMonitorNote([displays[1]!], 1, undefined, true),
    ).toBeUndefined();
  });

  it('names the monitor and lists others on the first screenshot', () => {
    const note = buildMonitorNote(displays, 1, undefined, true);
    expect(note).toBe(
      'This screenshot was taken on monitor "Main".' +
        ' Other attached monitors: "Right".' +
        ' Use switch_display to capture a different monitor.',
    );
  });

  it('flags a monitor change vs the previous screenshot', () => {
    const note = buildMonitorNote(displays, 2, 1, true);
    expect(note).toContain('monitor "Right"');
    expect(note).toContain('different from your previous screenshot');
    expect(note).toContain('"Main"');
  });

  it('treats lastDisplayId 0 like undefined (persisted sentinel)', () => {
    const note = buildMonitorNote(displays, 1, 0, true);
    expect(note).toContain('This screenshot was taken on monitor "Main".');
    expect(note).not.toContain('different from your previous screenshot');
  });

  it('omits the switch hint when switching is unavailable', () => {
    const note = buildMonitorNote(displays, 1, undefined, false);
    expect(note).not.toContain('switch_display');
  });

  it('returns undefined for steady-state same-monitor screenshots', () => {
    expect(buildMonitorNote(displays, 1, 1, true)).toBeUndefined();
  });
});
