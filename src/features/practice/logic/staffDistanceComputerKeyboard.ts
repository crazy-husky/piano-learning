import type {
  NoteName,
  Octave,
  StaffDistanceComputerKeyboardBindings,
  TargetNote,
} from "../../../domain/types";

export const STAFF_DISTANCE_COMPUTER_KEY_NOTES: readonly NoteName[] = [
  "C",
  "D",
  "E",
  "F",
  "G",
  "A",
  "B",
];

export const DEFAULT_STAFF_DISTANCE_COMPUTER_KEYBOARD_BINDINGS: StaffDistanceComputerKeyboardBindings =
  {
    left: {
      C: "Backquote",
      D: "Digit1",
      E: "Digit2",
      F: "Digit3",
      G: "Digit4",
      A: "Digit5",
      B: "Digit6",
    },
    right: {
      C: "KeyG",
      D: "KeyH",
      E: "KeyJ",
      F: "KeyK",
      G: "KeyL",
      A: "Semicolon",
      B: "Quote",
    },
  };

export interface StaffDistanceComputerKeyboardRange {
  isEligible: boolean;
  leftOctave?: Octave;
  rightOctave?: Octave;
  reason?: "too-many-low-groups" | "too-many-high-groups" | "unsupported-range";
}

const ALLOWED_KEY_CODE =
  /^(?:Key[A-Z]|Digit[0-9]|Numpad[0-9]|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash)$/;

export function isAllowedStaffDistanceComputerKey(code: string): boolean {
  return ALLOWED_KEY_CODE.test(code);
}

export function normalizeStaffDistanceComputerKeyboardBindings(
  value: unknown
): StaffDistanceComputerKeyboardBindings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return DEFAULT_STAFF_DISTANCE_COMPUTER_KEYBOARD_BINDINGS;
  }
  const record = value as Record<string, unknown>;
  const normalized = { left: {}, right: {} } as StaffDistanceComputerKeyboardBindings;
  const usedCodes = new Set<string>();
  for (const hand of ["left", "right"] as const) {
    const handRecord = record[hand];
    if (typeof handRecord !== "object" || handRecord === null || Array.isArray(handRecord)) {
      return DEFAULT_STAFF_DISTANCE_COMPUTER_KEYBOARD_BINDINGS;
    }
    for (const noteName of STAFF_DISTANCE_COMPUTER_KEY_NOTES) {
      const code = (handRecord as Record<string, unknown>)[noteName];
      if (
        typeof code !== "string" ||
        !isAllowedStaffDistanceComputerKey(code) ||
        usedCodes.has(code)
      ) {
        return DEFAULT_STAFF_DISTANCE_COMPUTER_KEYBOARD_BINDINGS;
      }
      normalized[hand][noteName] = code;
      usedCodes.add(code);
    }
  }
  return normalized;
}

export function getStaffDistanceComputerKeyboardRange(
  notes: readonly Pick<TargetNote, "octave">[]
): StaffDistanceComputerKeyboardRange {
  const lowOctaves = [
    ...new Set(notes.filter((note) => note.octave <= 3).map((note) => note.octave)),
  ];
  const highOctaves = [
    ...new Set(notes.filter((note) => note.octave >= 4).map((note) => note.octave)),
  ];
  if (notes.some((note) => note.octave < 2 || note.octave > 6)) {
    return { isEligible: false, reason: "unsupported-range" };
  }
  if (lowOctaves.length > 1) {
    return { isEligible: false, reason: "too-many-low-groups" };
  }
  if (highOctaves.length > 1) {
    return { isEligible: false, reason: "too-many-high-groups" };
  }
  return {
    isEligible: true,
    ...(lowOctaves[0] !== undefined ? { leftOctave: lowOctaves[0] } : {}),
    ...(highOctaves[0] !== undefined ? { rightOctave: highOctaves[0] } : {}),
  };
}

export function getStaffDistanceComputerKeyboardPitch(
  code: string,
  bindings: StaffDistanceComputerKeyboardBindings,
  range: Pick<StaffDistanceComputerKeyboardRange, "leftOctave" | "rightOctave">
): { noteName: NoteName; octave: Octave } | undefined {
  for (const hand of ["left", "right"] as const) {
    const octave = hand === "left" ? range.leftOctave : range.rightOctave;
    if (octave === undefined) continue;
    const noteName = STAFF_DISTANCE_COMPUTER_KEY_NOTES.find(
      (candidate) => bindings[hand][candidate] === code
    );
    if (noteName) return { noteName, octave };
  }
  return undefined;
}

export interface DesktopKeyboardEnvironment {
  maxTouchPoints: number;
  platform: string;
  userAgent: string;
}

export function requiresExternalKeyboardNotice(environment: DesktopKeyboardEnvironment): boolean {
  if (/Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(environment.userAgent)) return true;
  if (/iPad/i.test(environment.platform)) return true;
  if (/MacIntel/i.test(environment.platform) && environment.maxTouchPoints > 1) return true;
  return false;
}

export function currentDeviceRequiresExternalKeyboardNotice(): boolean {
  if (typeof navigator === "undefined") return false;
  return requiresExternalKeyboardNotice({
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    platform: navigator.platform ?? "",
    userAgent: navigator.userAgent ?? "",
  });
}

export function getComputerKeyLabel(code: string): string {
  if (code === "Backquote") return "·";
  if (code.startsWith("Digit")) return code.slice("Digit".length);
  if (code.startsWith("Key")) return code.slice("Key".length);
  if (code.startsWith("Numpad")) return "Num " + code.slice("Numpad".length);
  const labels: Record<string, string> = {
    Backslash: "\\",
    BracketLeft: "[",
    BracketRight: "]",
    Comma: ",",
    Equal: "=",
    Minus: "-",
    Period: ".",
    Quote: "'",
    Semicolon: ";",
    Slash: "/",
  };
  return labels[code] ?? code;
}

export function getComputerKeyboardHandLabel(hand: "left" | "right", octave: number): string {
  return (hand === "left" ? "左手" : "右手") + " C" + octave + "–B" + octave;
}
