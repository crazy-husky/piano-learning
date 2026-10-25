import type { PianoKeyName } from "../../domain/types";

export const VIRTUAL_PIANO_WHITE_KEYS = ["C", "D", "E", "F", "G", "A", "B"] as const;
export const VIRTUAL_PIANO_BLACK_KEYS: ReadonlyArray<{
  pitch: Extract<PianoKeyName, `${string}#`>;
  className: string;
}> = [
  { pitch: "C#", className: "key-cs" },
  { pitch: "D#", className: "key-ds" },
  { pitch: "F#", className: "key-fs" },
  { pitch: "G#", className: "key-gs" },
  { pitch: "A#", className: "key-as" },
];

export interface VirtualPianoKeyboardProps {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  enabledKeys: ReadonlySet<PianoKeyName>;
  showBlackKeys?: boolean;
  feedback?: { keyName: PianoKeyName; type: "correct" | "wrong" };
  feedbackKeys?: ReadonlyMap<PianoKeyName, "correct" | "wrong">;
  getKeyLabel?: (keyName: PianoKeyName) => string;
  getKeyAriaLabel?: (keyName: PianoKeyName) => string;
  onKeyPress: (keyName: PianoKeyName) => void;
  onKeyTransitionEnd?: (
    keyName: PianoKeyName,
    type: "correct" | "wrong",
    propertyName: string
  ) => void;
  pressedKeys?: ReadonlySet<PianoKeyName>;
}

export function VirtualPianoKeyboard({
  ariaLabel,
  className,
  disabled = false,
  enabledKeys,
  showBlackKeys = true,
  feedback,
  feedbackKeys,
  getKeyLabel,
  getKeyAriaLabel,
  onKeyPress,
  onKeyTransitionEnd,
  pressedKeys,
}: VirtualPianoKeyboardProps): JSX.Element {
  const renderKey = (keyName: PianoKeyName, isBlack = false, extraClass = "") => {
    const feedbackType =
      feedbackKeys?.get(keyName) ?? (feedback?.keyName === keyName ? feedback.type : undefined);
    const label = getKeyLabel?.(keyName) ?? keyName;

    return (
      <button
        aria-label={getKeyAriaLabel?.(keyName) ?? `${keyName.replace("#", "♯")} 音键`}
        aria-pressed={pressedKeys?.has(keyName) ?? false}
        className={[
          "staff-game-virtual-key",
          isBlack ? "staff-game-black-key" : "",
          extraClass,
          pressedKeys?.has(keyName) ? "is-pressed" : "",
          feedbackType ? `is-${feedbackType}` : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-key-name={keyName}
        disabled={disabled || !enabledKeys.has(keyName)}
        key={keyName}
        onClick={() => onKeyPress(keyName)}
        onTransitionEnd={
          feedbackType && onKeyTransitionEnd
            ? (event) => onKeyTransitionEnd(keyName, feedbackType, event.propertyName)
            : undefined
        }
        type="button"
      >
        {!isBlack && label ? <span>{label}</span> : null}
      </button>
    );
  };

  return (
    <div
      aria-label={ariaLabel}
      className={`staff-game-virtual-keyboard ${className ?? ""}`}
      role="group"
    >
      <div className="staff-game-keybed">
        {VIRTUAL_PIANO_WHITE_KEYS.map((keyName) => renderKey(keyName))}
        {showBlackKeys
          ? VIRTUAL_PIANO_BLACK_KEYS.map(({ pitch, className: keyClassName }) =>
              renderKey(pitch, true, keyClassName)
            )
          : null}
      </div>
    </div>
  );
}
