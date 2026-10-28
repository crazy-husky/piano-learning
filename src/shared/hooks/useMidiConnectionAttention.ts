import { useCallback, useEffect, useRef, useState } from "react";
import type { MidiInputController } from "../../midi/useMidiInput";

type MidiConnectionState = Pick<MidiInputController, "isConnected" | "status">;

export function useMidiConnectionAttention(midi: MidiConnectionState): {
  canRequestConnection: boolean;
  isActive: boolean;
  show: () => void;
} {
  const [isActive, setIsActive] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const canRequestConnection =
    !midi.isConnected && midi.status !== "unsupported" && midi.status !== "insecure-context";

  const show = useCallback((): void => {
    if (!canRequestConnection) return;
    setIsActive(true);
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = window.setTimeout(() => {
      setIsActive(false);
      timeoutRef.current = null;
    }, 3000);
  }, [canRequestConnection]);

  useEffect(() => {
    if (midi.isConnected) {
      setIsActive(false);
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }
  }, [midi.isConnected]);

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    },
    []
  );

  return { canRequestConnection, isActive, show };
}
