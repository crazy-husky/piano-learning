import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import type { NoteName, StaffDistanceComputerKeyboardBindings } from "../../../domain/types";
import {
  DEFAULT_STAFF_DISTANCE_COMPUTER_KEYBOARD_BINDINGS,
  getComputerKeyLabel,
  isAllowedStaffDistanceComputerKey,
  STAFF_DISTANCE_COMPUTER_KEY_NOTES,
} from "../logic/staffDistanceComputerKeyboard";

const SOLFEGE_LABELS: Record<NoteName, string> = {
  C: "Do",
  D: "Re",
  E: "Mi",
  F: "Fa",
  G: "Sol",
  A: "La",
  B: "Si",
};

type CaptureTarget = { hand: "left" | "right"; noteName: NoteName };

interface StaffDistanceComputerKeyboardSettingsProps {
  bindings: StaffDistanceComputerKeyboardBindings;
  leftOctave?: number;
  onChange: (bindings: StaffDistanceComputerKeyboardBindings) => void;
  rightOctave?: number;
}

export function StaffDistanceComputerKeyboardSettings({
  bindings,
  leftOctave,
  onChange,
  rightOctave,
}: StaffDistanceComputerKeyboardSettingsProps): JSX.Element {
  const [captureTarget, setCaptureTarget] = useState<CaptureTarget | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!captureTarget) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (event.code === "Escape") {
        setCaptureTarget(null);
        setError(null);
        return;
      }
      if (event.repeat || event.isComposing) return;
      if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
        setError("请直接按一个按键，不要同时按修饰键。");
        return;
      }
      if (!isAllowedStaffDistanceComputerKey(event.code)) {
        setError("这个按键用于页面操作，请换一个字母、数字或标点键。");
        return;
      }
      const duplicate = (["left", "right"] as const).some((hand) =>
        STAFF_DISTANCE_COMPUTER_KEY_NOTES.some((noteName) => {
          const isCurrent = hand === captureTarget.hand && noteName === captureTarget.noteName;
          return !isCurrent && bindings[hand][noteName] === event.code;
        })
      );
      if (duplicate) {
        setError("这个按键已经分配给其他音，请换一个按键。");
        return;
      }
      onChange({
        ...bindings,
        [captureTarget.hand]: {
          ...bindings[captureTarget.hand],
          [captureTarget.noteName]: event.code,
        },
      });
      setCaptureTarget(null);
      setError(null);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [bindings, captureTarget, onChange]);

  const beginCapture = (hand: "left" | "right", noteName: NoteName): void => {
    setError(null);
    setCaptureTarget({ hand, noteName });
  };

  return (
    <section aria-label="物理键盘音符键位" className="staff-distance-computer-keyboard-settings">
      <div className="staff-distance-computer-keyboard-heading">
        <div>
          <strong>物理键盘键位</strong>
          <p>点击键位后按下新按键；按 Esc 取消。</p>
        </div>
        <button
          aria-label="恢复默认物理键盘键位"
          className="staff-distance-computer-keyboard-reset"
          onClick={() => {
            setCaptureTarget(null);
            setError(null);
            onChange(DEFAULT_STAFF_DISTANCE_COMPUTER_KEYBOARD_BINDINGS);
          }}
          type="button"
        >
          <RotateCcw aria-hidden="true" size={14} />
          恢复默认
        </button>
      </div>
      <div
        className={`staff-distance-computer-keyboard-hands${(leftOctave === undefined) !== (rightOctave === undefined) ? " is-one-hand" : ""}`}
      >
        {leftOctave !== undefined ? (
          <div className="staff-distance-computer-keyboard-hand">
            <strong>
              左手 · C{leftOctave}–B{leftOctave}
            </strong>
            <div className="staff-distance-computer-key-rows">
              {STAFF_DISTANCE_COMPUTER_KEY_NOTES.map((noteName) => {
                const isCapturing =
                  captureTarget?.hand === "left" && captureTarget.noteName === noteName;
                return (
                  <button
                    aria-label={`左手 ${SOLFEGE_LABELS[noteName]}（${noteName}）：${isCapturing ? "请按新按键" : getComputerKeyLabel(bindings.left[noteName])}`}
                    aria-pressed={isCapturing}
                    className={isCapturing ? "is-capturing" : ""}
                    key={noteName}
                    onClick={() => beginCapture("left", noteName)}
                    type="button"
                  >
                    <span>{SOLFEGE_LABELS[noteName]}</span>
                    <kbd>
                      {isCapturing ? "按键…" : getComputerKeyLabel(bindings.left[noteName])}
                    </kbd>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        {rightOctave !== undefined ? (
          <div className="staff-distance-computer-keyboard-hand">
            <strong>
              右手 · C{rightOctave}–B{rightOctave}
            </strong>
            <div className="staff-distance-computer-key-rows">
              {STAFF_DISTANCE_COMPUTER_KEY_NOTES.map((noteName) => {
                const isCapturing =
                  captureTarget?.hand === "right" && captureTarget.noteName === noteName;
                return (
                  <button
                    aria-label={`右手 ${SOLFEGE_LABELS[noteName]}（${noteName}）：${isCapturing ? "请按新按键" : getComputerKeyLabel(bindings.right[noteName])}`}
                    aria-pressed={isCapturing}
                    className={isCapturing ? "is-capturing" : ""}
                    key={noteName}
                    onClick={() => beginCapture("right", noteName)}
                    type="button"
                  >
                    <span>{SOLFEGE_LABELS[noteName]}</span>
                    <kbd>
                      {isCapturing ? "按键…" : getComputerKeyLabel(bindings.right[noteName])}
                    </kbd>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
      {error ? (
        <p className="staff-distance-computer-keyboard-error" role="status">
          {error}
        </p>
      ) : null}
    </section>
  );
}
