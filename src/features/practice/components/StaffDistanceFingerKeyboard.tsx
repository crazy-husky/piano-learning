import { useEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  Ref,
} from "react";
import type { NoteName, StaffDistanceFingerNumber } from "../../../domain/types";
import type { StaffDistanceTargetFinger as StaffDistanceTargetFingerAssignment } from "../../../domain/staffDistanceFinger";
import {
  PRACTICE_PIANO_BLACK_KEY_WIDTH_MM,
  PRACTICE_PIANO_WHITE_KEY_MAX_HEIGHT_PX,
  PRACTICE_PIANO_WHITE_KEY_MIN_HEIGHT_PX,
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
  readOnlyResponsive?: boolean;
  answerHighlightedMidi?: number;
  answerFinger?: StaffDistanceTargetFingerAssignment;
  fingerNumber: StaffDistanceFingerNumber;
  highlightedMidi: number;
  keyboardHeightCapPx?: number;
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
  readOnlyResponsive = false,
  answerHighlightedMidi,
  answerFinger,
  fingerNumber,
  highlightedMidi,
  keyboardHeightCapPx,
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
  const effectiveKeyboardHeightPx =
    readOnlyResponsive && keyboardHeightCapPx !== undefined
      ? Math.min(keyboardHeightPx, keyboardHeightCapPx)
      : keyboardHeightPx;
  const keyboardHeightProgress = Math.max(
    0,
    Math.min(
      1,
      (effectiveKeyboardHeightPx - PRACTICE_PIANO_WHITE_KEY_MIN_HEIGHT_PX) /
        (PRACTICE_PIANO_WHITE_KEY_MAX_HEIGHT_PX - PRACTICE_PIANO_WHITE_KEY_MIN_HEIGHT_PX)
    )
  );
  const blackKeyHeightPercent = 15.5 + keyboardHeightProgress * 15.5;

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
      aria-label={
        readOnlyResponsive
          ? `只读钢琴键位示意图。绿色键标记${fingerNumber}指参考音；${answerHighlightedMidi === undefined ? "点击查看答案后会标记目标音和建议指法。" : "金色键标记目标音和建议指法。"}`
          : "单指专项仿真钢琴键盘"
      }
      className={`staff-distance-finger-keyboard${readOnlyResponsive ? " is-read-only-responsive" : ""}`}
      ref={containerRef}
      role={readOnlyResponsive ? "img" : "group"}
      style={
        {
          "--staff-distance-white-key-width": `${PRACTICE_PIANO_WHITE_KEY_WIDTH_MM * keyboardScale}mm`,
          "--staff-distance-white-key-count": PRACTICE_PIANO_WHITE_KEY_COUNT,
          "--staff-distance-finger-keyboard-height": `${effectiveKeyboardHeightPx}px`,
          "--staff-distance-black-key-height": `${blackKeyHeightPercent}%`,
          ...(keyboardHeightCapPx === undefined
            ? {}
            : { "--staff-distance-read-only-keyboard-height-cap": `${keyboardHeightCapPx}px` }),
        } as CSSProperties
      }
    >
      <div
        className="staff-distance-finger-keyboard-bed"
        onPointerCancelCapture={readOnlyResponsive ? undefined : finishTouchPointer}
        onPointerUpCapture={readOnlyResponsive ? undefined : finishTouchPointer}
      >
        {whiteKeys.map((key) => {
          const className = `staff-distance-finger-white-key${key.midi === highlightedMidi ? " is-finger-anchor" : ""}${key.midi === answerHighlightedMidi ? " is-answer-highlight" : ""}${pressedTouchMidis.includes(key.midi) ? " is-touch-pressed" : ""}`;
          const markers = (
            <>
              {key.midi === highlightedMidi ? (
                <span className="staff-distance-finger-key-marker">{fingerNumber}指</span>
              ) : null}
              {key.midi === answerHighlightedMidi && answerFinger ? (
                <span aria-hidden="true" className="staff-distance-finger-answer-marker">
                  <span>{answerFinger.finger}指</span>
                  {answerFinger.extensionDirection && answerFinger.extensionCount ? (
                    <small>
                      {answerFinger.extensionDirection === "left" ? "左" : "右"}扩
                      {answerFinger.extensionCount}
                    </small>
                  ) : null}
                </span>
              ) : null}
            </>
          );

          if (readOnlyResponsive) {
            return (
              <div aria-hidden="true" className={className} key={key.midi}>
                {markers}
              </div>
            );
          }

          return (
            <button
              aria-label={`${key.noteName}${key.octave} 白键${key.midi === highlightedMidi ? `，${fingerNumber} 指定位` : ""}${key.midi === answerHighlightedMidi ? `，目标答案${answerFinger ? `，建议${answerFinger.finger}指${answerFinger.extensionDirection ? `${answerFinger.extensionDirection === "left" ? "左" : "右"}扩${answerFinger.extensionCount}` : ""}` : ""}` : ""}`}
              className={className}
              disabled={disabled}
              key={key.midi}
              onClick={(event) => handleKeyClick(event, key)}
              onPointerCancel={finishTouchPointer}
              onPointerDown={(event) => handleTouchPointerDown(event, key)}
              onLostPointerCapture={finishTouchPointer}
              onPointerUp={finishTouchPointer}
              type="button"
            >
              {markers}
            </button>
          );
        })}
        {blackKeys.map((key) => (
          <span
            aria-hidden="true"
            className="staff-distance-finger-black-key"
            key={key.midi}
            style={{
              left: `${((key.afterWhiteKeyIndex + 1) / PRACTICE_PIANO_WHITE_KEY_COUNT - PRACTICE_PIANO_BLACK_KEY_WIDTH_MM / PRACTICE_PIANO_WHITE_KEY_WIDTH_MM / PRACTICE_PIANO_WHITE_KEY_COUNT / 2) * 100}%`,
              width: `${(PRACTICE_PIANO_BLACK_KEY_WIDTH_MM / PRACTICE_PIANO_WHITE_KEY_WIDTH_MM / PRACTICE_PIANO_WHITE_KEY_COUNT) * 100}%`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
