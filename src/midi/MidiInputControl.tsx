import { useEffect, useRef, useState } from "react";
import type { MidiInputController } from "./useMidiInput";

export interface MidiInputControlProps {
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  label?: string;
  midi: Pick<
    MidiInputController,
    | "connect"
    | "errorMessage"
    | "inputs"
    | "isConnected"
    | "selectedInput"
    | "selectedInputId"
    | "selectInput"
    | "status"
  >;
}

export function MidiInputControl({
  ariaLabel = "MIDI 输入设备",
  className = "",
  disabled = false,
  label = "连接 MIDI",
  midi,
}: MidiInputControlProps): JSX.Element {
  const [isRetryAttentionActive, setIsRetryAttentionActive] = useState(false);
  const retryAttentionTimerRef = useRef<number | null>(null);
  const hasInputs = midi.status === "ready" && midi.inputs.length > 0;
  const selectedInputId = midi.inputs.some((input) => input.id === midi.selectedInputId)
    ? midi.selectedInputId
    : "";
  const classNames = [
    "midi-input-control",
    className,
    isRetryAttentionActive ? "needs-attention" : "",
    midi.isConnected ? "is-connected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    if (!midi.isConnected) return;
    setIsRetryAttentionActive(false);
    if (retryAttentionTimerRef.current !== null) {
      window.clearTimeout(retryAttentionTimerRef.current);
      retryAttentionTimerRef.current = null;
    }
  }, [midi.isConnected]);

  useEffect(
    () => () => {
      if (retryAttentionTimerRef.current !== null) {
        window.clearTimeout(retryAttentionTimerRef.current);
      }
    },
    []
  );

  const requestConnection = (): void => {
    setIsRetryAttentionActive(true);
    if (retryAttentionTimerRef.current !== null) {
      window.clearTimeout(retryAttentionTimerRef.current);
    }
    retryAttentionTimerRef.current = window.setTimeout(() => {
      setIsRetryAttentionActive(false);
      retryAttentionTimerRef.current = null;
    }, 3000);
    void midi.connect();
  };

  if (hasInputs) {
    return (
      <span className={classNames}>
        <select
          aria-label={ariaLabel}
          className="midi-input-control-select"
          disabled={disabled}
          onChange={(event) => midi.selectInput(event.currentTarget.value)}
          title={midi.selectedInput?.name}
          value={selectedInputId}
        >
          <option disabled value="">
            请选择 MIDI 设备
          </option>
          {midi.inputs.map((input) => (
            <option key={input.id} value={input.id}>
              {input.manufacturer ? `${input.manufacturer} · ` : ""}
              {input.name}
            </option>
          ))}
        </select>
      </span>
    );
  }

  const unsupported = midi.status === "unsupported" || midi.status === "insecure-context";
  const buttonLabel =
    midi.status === "requesting"
      ? "正在连接…"
      : midi.status === "denied" || midi.status === "error"
        ? `重新连接${label.replace(/^连接/, "")}`
        : midi.status === "ready"
          ? "未检测到设备 · 重试"
          : label;

  return (
    <span className={classNames}>
      <button
        aria-label={ariaLabel === "MIDI 输入设备" ? buttonLabel : ariaLabel}
        className="midi-input-control-button"
        disabled={disabled || unsupported || midi.status === "requesting"}
        onClick={requestConnection}
        title={midi.errorMessage}
        type="button"
      >
        {buttonLabel}
      </button>
    </span>
  );
}
