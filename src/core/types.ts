/**
 * Shared types for the core logic layer. Everything here is pure data — no
 * Win32, no I/O — so the whole layer is unit-testable without a desktop.
 */

/** Minimal logger surface used across the core layer. */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * A captured screenshot with the geometry the coordinate transform needs.
 *
 * `width`/`height` are the delivered IMAGE pixels (after the image-budget
 * downscale); `displayWidth`/`displayHeight` are the PHYSICAL display pixels
 * at capture time; `originX`/`originY` place the captured display in
 * virtual-screen space. The ratio between the two pairs is what makes click
 * coordinates land where the model read them (see coordinates.ts).
 */
export interface ScreenshotResult {
  /** Base64 JPEG payload (no data: prefix). */
  base64: string;
  /** Delivered image width in pixels, after image-budget scaling. */
  width: number;
  /** Delivered image height in pixels, after image-budget scaling. */
  height: number;
  /** Physical pixel width of the captured display at capture time. */
  displayWidth: number;
  /** Physical pixel height of the captured display at capture time. */
  displayHeight: number;
  /** Stable identifier of the captured display. */
  displayId: number;
  /** Display origin in virtual-screen pixels. */
  originX: number;
  /** Display origin in virtual-screen pixels. */
  originY: number;
}

/** A monitor as reported by the worker's display enumeration. */
export interface DisplayGeometry {
  displayId: number;
  /** Physical pixel width. */
  width: number;
  /** Physical pixel height. */
  height: number;
  /** DPI scale factor, max(1.0, dpi/96). */
  scaleFactor: number;
  /** Origin in virtual-screen pixels. */
  originX: number;
  /** Origin in virtual-screen pixels. */
  originY: number;
  /** Human-readable name (e.g. "\\.\\DISPLAY1"). */
  label?: string;
  isPrimary?: boolean;
}

/** Crop rectangle in image pixels, used by pixelCompare. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
