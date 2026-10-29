import { useEffect, useRef } from "react";
import type { MidiInputController } from "../../midi/useMidiInput";

const METRONOME_IDLE_PAUSE_MS = 20 * 60 * 1000;

interface UseMetronomeScreenWakeLockOptions {
  isPlaying: boolean;
  onPause: () => void;
  subscribeMidiActivity: MidiInputController["subscribe"];
}

export function useMetronomeScreenWakeLock({
  isPlaying,
  onPause,
  subscribeMidiActivity,
}: UseMetronomeScreenWakeLockOptions): void {
  const isPlayingRef = useRef(isPlaying);
  const onPauseRef = useRef(onPause);
  isPlayingRef.current = isPlaying;
  onPauseRef.current = onPause;

  useEffect(() => {
    if (!isPlaying) return undefined;

    let disposed = false;
    let pauseTriggered = false;
    let wakeLock: WakeLockSentinel | null = null;
    let inactivityTimer = 0;

    const releaseWakeLock = (): void => {
      const activeWakeLock = wakeLock;
      wakeLock = null;
      if (activeWakeLock && !activeWakeLock.released) {
        void activeWakeLock.release().catch(() => undefined);
      }
    };

    const pausePlayback = (): void => {
      if (pauseTriggered || !isPlayingRef.current) return;
      pauseTriggered = true;
      onPauseRef.current();
      releaseWakeLock();
    };

    const resetInactivityTimer = (event?: Event): void => {
      if (event && !event.isTrusted) return;
      window.clearTimeout(inactivityTimer);
      inactivityTimer = window.setTimeout(pausePlayback, METRONOME_IDLE_PAUSE_MS);
    };

    const handleUserActivity = (event: Event): void => resetInactivityTimer(event);
    const handleMidiActivity: Parameters<MidiInputController["subscribe"]>[0] = (event) => {
      if (event.type === "press") resetInactivityTimer();
    };
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === "hidden") pausePlayback();
    };

    document.addEventListener("pointerdown", handleUserActivity, true);
    document.addEventListener("pointermove", handleUserActivity, true);
    document.addEventListener("keydown", handleUserActivity, true);
    document.addEventListener("wheel", handleUserActivity, true);
    document.addEventListener("click", handleUserActivity, true);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const unsubscribeMidi = subscribeMidiActivity(handleMidiActivity);
    resetInactivityTimer();

    let wakeLockManager: WakeLock | undefined;
    try {
      wakeLockManager = navigator.wakeLock;
    } catch {
      // Wake Lock may be unavailable in unsupported or restricted contexts.
    }

    if (wakeLockManager) {
      void wakeLockManager
        .request("screen")
        .then((requestedWakeLock) => {
          if (disposed || pauseTriggered || !isPlayingRef.current) {
            void requestedWakeLock.release().catch(() => undefined);
            return;
          }

          wakeLock = requestedWakeLock;
          requestedWakeLock.addEventListener(
            "release",
            () => {
              if (wakeLock !== requestedWakeLock) return;
              wakeLock = null;
              if (disposed || document.visibilityState !== "visible") return;
              window.setTimeout(() => {
                if (!disposed && isPlayingRef.current) pausePlayback();
              }, 0);
            },
            { once: true }
          );
        })
        .catch(() => {
          // Playback can continue without a wake lock; visibility and idle handling remain active.
        });
    }

    return () => {
      disposed = true;
      window.clearTimeout(inactivityTimer);
      document.removeEventListener("pointerdown", handleUserActivity, true);
      document.removeEventListener("pointermove", handleUserActivity, true);
      document.removeEventListener("keydown", handleUserActivity, true);
      document.removeEventListener("wheel", handleUserActivity, true);
      document.removeEventListener("click", handleUserActivity, true);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      unsubscribeMidi();
      releaseWakeLock();
    };
  }, [isPlaying, subscribeMidiActivity]);
}
