export const PRACTICE_PIANO_WHITE_KEY_WIDTH_MM = 23.6;
export const PRACTICE_PIANO_BLACK_KEY_WIDTH_MM = 12.7;
export const PRACTICE_PIANO_WHITE_KEY_MAX_HEIGHT_MM = 150;
export const PRACTICE_PIANO_WHITE_KEY_COUNT = 9;
export const PRACTICE_PIANO_CALIBRATION_CARD_WIDTH_MM = 85.6;
export const PRACTICE_PIANO_SCALE_MIN = 0.7;
export const PRACTICE_PIANO_SCALE_MAX = 1.6;
export const PRACTICE_PIANO_SCALE_STEP = 0.01;

const CSS_PIXELS_PER_INCH = 96;
const MILLIMETERS_PER_INCH = 25.4;
const VIEWPORT_EDGE_SPACE_PX = 48;
const KEYBED_FRAME_SPACE_PX = 14;

const PRACTICE_PIANO_KEYBED_BASE_WIDTH_PX =
  (PRACTICE_PIANO_WHITE_KEY_WIDTH_MM * PRACTICE_PIANO_WHITE_KEY_COUNT * CSS_PIXELS_PER_INCH) /
  MILLIMETERS_PER_INCH;
export const PRACTICE_PIANO_WHITE_KEY_MIN_HEIGHT_PX = 160;
export const PRACTICE_PIANO_WHITE_KEY_MAX_HEIGHT_PX = Math.ceil(
  (PRACTICE_PIANO_WHITE_KEY_MAX_HEIGHT_MM * CSS_PIXELS_PER_INCH) / MILLIMETERS_PER_INCH
);

export function getPracticePianoKeyboardMinWidthPx(scale = 1): number {
  return Math.ceil(PRACTICE_PIANO_KEYBED_BASE_WIDTH_PX * scale + KEYBED_FRAME_SPACE_PX);
}

export function getPracticePianoMinViewportWidthPx(scale = 1): number {
  return Math.ceil(getPracticePianoKeyboardMinWidthPx(scale) + VIEWPORT_EDGE_SPACE_PX);
}

export const PRACTICE_PIANO_KEYBED_WIDTH_PX = PRACTICE_PIANO_KEYBED_BASE_WIDTH_PX;
export const PRACTICE_PIANO_KEYBOARD_MIN_WIDTH_PX = getPracticePianoKeyboardMinWidthPx();
export const PRACTICE_PIANO_MIN_VIEWPORT_WIDTH_PX = getPracticePianoMinViewportWidthPx();

export interface PracticeViewportSize {
  height: number;
  width: number;
}

export function readPracticeViewportSize(): PracticeViewportSize {
  if (typeof window === "undefined") return { width: 0, height: 0 };
  return {
    width: window.visualViewport?.width ?? window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
  };
}

export function canFitPracticePianoKeyboard(size: PracticeViewportSize, scale = 1): boolean {
  return size.width >= getPracticePianoMinViewportWidthPx(scale);
}

export function canFitPracticePianoKeyboardInEitherOrientation(
  size: PracticeViewportSize,
  scale = 1
): boolean {
  return (
    canFitPracticePianoKeyboard(size, scale) ||
    canFitPracticePianoKeyboard({ width: size.height, height: size.width }, scale)
  );
}
