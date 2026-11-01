import { useEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  Ref,
} from "react";
import type { NoteName, StaffDistanceFingerNumber } from "../../../domain/types";
import {
  PRACTICE_PIANO_BLACK_KEY_WIDTH_MM,
  PRACTICE_PIANO_WHITE_KEY_COUNT,
  PRACTICE_PIANO_WHITE_KEY_WIDTH_MM,
} from "./staffDistanceFingerKeyboardLayout";

const NATURAL_KEYS: readonly NoteName[] = ["C", "D", "E", "F", "G", "A", "B"];
const NATURAL_SEMITONES = [0, 2, 4, 5, 7, 9, 11] as const;
const TOUCH_CLICK_SUPPRESSION_TTL_MS = 1_000;

interface WhiteKey {
  midi: number;
  noteName: NoteName;
  octave: number;
}

interface BlackKey {
  afterWhiteKeyIndex: number;
  midi: number;
}

interface StaffDistanceFingerKeyboardProps {
  containerRef: Ref<HTMLDivElement>;
  disabled?: boolean;
  fingerNumber: StaffDistanceFingerNumber;
  highlightedMidi: number;
  keyboardHeightPx: number;
  keyboardScale: number;
  lowerKeyCount: number;
  onKeyPress: (answer: { midi: number; noteName: NoteName; octave: number }) => void;
  onTouchPointerEnd: (pointerId: number) => void;
  onTouchPointerStart: (pointerId: number) => void;
  rangeReferenceMidi: number;
}

function getWhiteKeys(referenceMidi: number, lowerKeyCount: number): WhiteKey[] {
  const referencePitchClass = ((referenceMidi % 12) + 12) % 12;
  const referenceKeyIndex = NATURAL_SEMITONES.indexOf(
    referencePitchClass as (typeof NATURAL_SEMITONES)[number]
  );
  if (referenceKeyIndex < 0) return [];

  const referenceOctave = Math.floor(referenceMidi / 12) - 1;
  const firstNaturalIndex =
    referenceOctave * NATURAL_KEYS.length + referenceKeyIndex - lowerKeyCount;
  const keys: WhiteKey[] = [];

  for (let index = 0; index < PRACTICE_PIANO_WHITE_KEY_COUNT; index += 1) {
    const naturalIndex = firstNaturalIndex + index;
    const keyIndex =
      ((naturalIndex % NATURAL_KEYS.length) + NATURAL_KEYS.length) % NATURAL_KEYS.length;
    const octave = Math.floor(naturalIndex / NATURAL_KEYS.length);
    const noteName = NATURAL_KEYS[keyIndex]!;
    keys.push({
      midi: (octave + 1) * 12 + NATURAL_SEMITONES[keyIndex]!,
      noteName,
      octave,
    });
  }

  return keys;
}

export function StaffDistanceFingerKeyboard({
  containerRef,
  disabled = false,
  fingerNumber,
  highlightedMidi,
  keyboardHeightPx,
  keyboardScale,
  lowerKeyCount,
  onKeyPress,
  onTouchPointerEnd,
  onTouchPointerStart,
  rangeReferenceMidi,
}: StaffDistanceFingerKeyboardProps): JSX.Element {
  const activeTouchPointersRef = useRef(new Set<number>());
  const activeTouchNotesRef = useRef(new Map<number, number>());
  const touchClickSuppressionsRef = useRef(
    new Map<number, { midi: number; timerId: number | null }>()
  );
  const [pressedTouchMidis, setPressedTouchMidis] = useState<number[]>([]);

  useEffect(
    () => () => {
      touchClickSuppressionsRef.current.forEach(({ timerId }) => {
        if (timerId !== null) window.clearTimeout(timerId);
      });
      touchClickSuppressionsRef.current.clear();
      [...activeTouchPointersRef.current].forEach((pointerId) => onTouchPointerEnd(pointerId));
      activeTouchPointersRef.current.clear();
      activeTouchNotesRef.current.clear();
    },
    [onTouchPointerEnd]
  );

  const clearTouchClickSuppression = (pointerId: number): void => {
    const suppression = touchClickSuppressionsRef.current.get(pointerId);
    if (suppression && suppression.timerId !== null) window.clearTimeout(suppression.timerId);
    touchClickSuppressionsRef.current.delete(pointerId);
  };

  const handleTouchPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    key: WhiteKey
  ): void => {
    if (
      event.pointerType !== "touch" ||
      disabled ||
      activeTouchPointersRef.current.has(event.pointerId)
    ) {
      return;
    }

    event.preventDefault();
    activeTouchPointersRef.current.add(event.pointerId);
    activeTouchNotesRef.current.set(event.pointerId, key.midi);
    setPressedTouchMidis([...new Set(activeTouchNotesRef.current.values())]);
    touchClickSuppressionsRef.current.set(event.pointerId, {
      midi: key.midi,
      timerId: null,
    });
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // The touch can still be completed by the keyboard-level pointer handlers.
    }
    onTouchPointerStart(event.pointerId);
    onKeyPress(key);
  };

  const finishTouchPointer = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.pointerType !== "touch" || !activeTouchPointersRef.current.delete(event.pointerId))
      return;
    event.preventDefault();
    onTouchPointerEnd(event.pointerId);
    activeTouchNotesRef.current.delete(event.pointerId);
    setPressedTouchMidis([...new Set(activeTouchNotesRef.current.values())]);
    const suppression = touchClickSuppressionsRef.current.get(event.pointerId);
    if (!suppression) return;
    if (event.type === "pointercancel") {
      clearTouchClickSuppression(event.pointerId);
      return;
    }
    suppression.timerId = window.setTimeout(
      () => clearTouchClickSuppression(event.pointerId),
      TOUCH_CLICK_SUPPRESSION_TTL_MS
    );
  };

  const handleKeyClick = (event: ReactMouseEvent<HTMLButtonElement>, key: WhiteKey): void => {
    const nativeEvent = event.nativeEvent as PointerEvent;
    const pointerId = nativeEvent.pointerId;
    const matchingTouch = [...touchClickSuppressionsRef.current.entries()].find(
      ([, suppression]) => suppression.midi === key.midi
    );
    const isTouchClick =
      nativeEvent.pointerType === "touch" ||
      (pointerId !== undefined && touchClickSuppressionsRef.current.has(pointerId)) ||
      (event.detail > 0 && matchingTouch !== undefined);

    if (isTouchClick) {
      event.preventDefault();
      event.stopPropagation();
      if (pointerId !== undefined) clearTouchClickSuppression(pointerId);
      else if (matchingTouch) clearTouchClickSuppression(matchingTouch[0]);
      return;
    }

    onKeyPress(key);
  };

  const whiteKeys = getWhiteKeys(rangeReferenceMidi, lowerKeyCount);
  const blackKeys: BlackKey[] = [];
  for (let index = 0; index < whiteKeys.length - 1; index += 1) {
    const current = whiteKeys[index]!;
    const next = whiteKeys[index + 1]!;
    if (next.midi - current.midi === 2) {
      blackKeys.push({ afterWhiteKeyIndex: index, midi: current.midi + 1 });
    }
  }

  return (
    <div
      aria-label="单指专项仿真钢琴键盘"
      className="staff-distance-finger-keyboard"
      ref={containerRef}
      role="group"
      style={
        {
          "--staff-distance-white-key-width": `${PRACTICE_PIANO_WHITE_KEY_WIDTH_MM * keyboardScale}mm`,
          "--staff-distance-white-key-count": PRACTICE_PIANO_WHITE_KEY_COUNT,
          "--staff-distance-finger-keyboard-height": `${keyboardHeightPx}px`,
        } as CSSProperties
      }
    >
      <div
        className="staff-distance-finger-keyboard-bed"
        onPointerCancelCapture={finishTouchPointer}
        onPointerUpCapture={finishTouchPointer}
      >
        {whiteKeys.map((key) => (
          <button
            aria-label={`${key.noteName}${key.octave} 白键${key.midi === highlightedMidi ? `，${fingerNumber} 指定位` : ""}`}
            className={`staff-distance-finger-white-key${key.midi === highlightedMidi ? " is-finger-anchor" : ""}${pressedTouchMidis.includes(key.midi) ? " is-touch-pressed" : ""}`}
            disabled={disabled}
            key={key.midi}
            onClick={(event) => handleKeyClick(event, key)}
            onPointerCancel={finishTouchPointer}
            onPointerDown={(event) => handleTouchPointerDown(event, key)}
            onLostPointerCapture={finishTouchPointer}
            onPointerUp={finishTouchPointer}
            type="button"
          >
            {key.midi === highlightedMidi ? (
              <span className="staff-distance-finger-key-marker">{fingerNumber}指</span>
            ) : null}
          </button>
        ))}
        {blackKeys.map((key) => (
          <span
            aria-hidden="true"
            className="staff-distance-finger-black-key"
            key={key.midi}
            style={{
              left: `calc(var(--staff-distance-white-key-width) * ${key.afterWhiteKeyIndex + 1} - ${(PRACTICE_PIANO_BLACK_KEY_WIDTH_MM * keyboardScale) / 2}mm)`,
              width: `${PRACTICE_PIANO_BLACK_KEY_WIDTH_MM * keyboardScale}mm`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
