import { useEffect, useRef, useState, type RefObject } from "react";

const VIEWPORT_SAFE_GAP_PX = 16;
const VIEWPORT_RETRY_DELAYS_MS = [90, 240, 460] as const;

function supportsTouchInput(): boolean {
  return navigator.maxTouchPoints > 0 || window.matchMedia?.("(pointer: coarse)").matches === true;
}

/** Temporarily move a floating metronome so its active BPM field clears the soft keyboard. */
export function useMetronomeTempoInputViewportLift(
  rootRef: RefObject<HTMLElement | null>,
  isEditing: boolean
): number {
  const [liftPx, setLiftPx] = useState(0);
  const liftRef = useRef(0);

  useEffect(() => {
    const applyLift = (nextLiftPx: number): void => {
      const roundedLiftPx = Math.max(0, Math.round(nextLiftPx));
      if (liftRef.current === roundedLiftPx) return;
      liftRef.current = roundedLiftPx;
      setLiftPx(roundedLiftPx);
    };

    if (!isEditing || !supportsTouchInput()) {
      applyLift(0);
      return undefined;
    }

    const viewport = window.visualViewport;
    let animationFrame = 0;
    const retryTimers: number[] = [];

    const updateLift = (): void => {
      animationFrame = 0;
      const input = rootRef.current?.querySelector<HTMLInputElement>(".metronome-tempo-input");
      if (!input || document.activeElement !== input) {
        applyLift(0);
        return;
      }

      const bounds = input.getBoundingClientRect();
      const currentLift = liftRef.current;
      const baseTop = bounds.top + currentLift;
      const baseBottom = bounds.bottom + currentLift;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const visibleTop = viewportTop + VIEWPORT_SAFE_GAP_PX;
      const visibleBottom = viewportTop + viewportHeight - VIEWPORT_SAFE_GAP_PX;
      const requiredLift = Math.max(0, baseBottom - visibleBottom);
      const availableLift = Math.max(0, baseTop - visibleTop);
      applyLift(Math.min(requiredLift, availableLift));
    };

    function scheduleUpdate(): void {
      if (animationFrame !== 0) window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(updateLift);
    }

    VIEWPORT_RETRY_DELAYS_MS.forEach((delay) => {
      retryTimers.push(window.setTimeout(scheduleUpdate, delay));
    });
    scheduleUpdate();
    document.addEventListener("focusin", scheduleUpdate);
    document.addEventListener("focusout", scheduleUpdate);
    viewport?.addEventListener("resize", scheduleUpdate);
    viewport?.addEventListener("scroll", scheduleUpdate);
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      document.removeEventListener("focusin", scheduleUpdate);
      document.removeEventListener("focusout", scheduleUpdate);
      viewport?.removeEventListener("resize", scheduleUpdate);
      viewport?.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      retryTimers.forEach((timer) => window.clearTimeout(timer));
      if (animationFrame !== 0) window.cancelAnimationFrame(animationFrame);
    };
  }, [isEditing, rootRef]);

  return liftPx;
}
