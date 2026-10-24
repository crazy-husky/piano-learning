import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type Ref } from "react";

interface BoundedNumberInputProps {
  "aria-label": string;
  className?: string;
  id?: string;
  inputRef?: Ref<HTMLInputElement>;
  max: number;
  min: number;
  step?: number;
  value: number;
  onCommit: (value: number) => void;
}

function normalizeValue(
  rawValue: string,
  value: number,
  min: number,
  max: number,
  step: number
): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return value;

  const clamped = Math.min(max, Math.max(min, parsed));
  const stepped = min + Math.round((clamped - min) / step) * step;
  const decimalPlaces = Math.max(0, (String(step).split(".")[1] ?? "").length);
  return Number(Math.min(max, Math.max(min, stepped)).toFixed(decimalPlaces));
}

export function BoundedNumberInput({
  "aria-label": ariaLabel,
  className,
  id,
  inputRef,
  max,
  min,
  step = 1,
  value,
  onCommit,
}: BoundedNumberInputProps): JSX.Element {
  const [draft, setDraft] = useState(String(value));
  const isEditingRef = useRef(false);

  useEffect(() => {
    if (!isEditingRef.current) setDraft(String(value));
  }, [value]);

  const commit = (event: FocusEvent<HTMLInputElement>): void => {
    isEditingRef.current = false;
    const nextValue = normalizeValue(event.currentTarget.value, value, min, max, step);
    setDraft(String(nextValue));
    onCommit(nextValue);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") event.currentTarget.blur();
  };

  return (
    <input
      aria-label={ariaLabel}
      className={className}
      id={id}
      ref={inputRef}
      inputMode={step < 1 ? "decimal" : "numeric"}
      maxLength={String(max).length + (step < 1 ? 2 : 0)}
      type="text"
      value={draft}
      onBlur={commit}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => {
        isEditingRef.current = true;
        event.currentTarget.select();
      }}
      onKeyDown={handleKeyDown}
    />
  );
}
