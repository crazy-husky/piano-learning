import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  SETUP_REQUIREMENT_GUIDE_EVENT,
  type SetupRequirementGuideDetail,
} from "../shared/utils/guideSetupRequirement";

const HIDE_MIDI_DEVICE_GUIDE_EVENT = "piano-learning:hide-midi-device-guide";
const MIDI_GUIDE_DURATION_MS = 2000;
const MIDI_GUIDE_FADE_MS = 150;
const MIDI_GUIDE_ARROW_HEAD_LENGTH = 16;
const MIDI_GUIDE_ARROW_HEAD_HALF_WIDTH = 5;

interface MidiDeviceGuideGeometry {
  height: number;
  length: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  width: number;
}

interface MidiDeviceGuideState extends MidiDeviceGuideGeometry {
  id: number;
  isFadingOut: boolean;
  isVisible: boolean;
}

export function clearMidiDeviceGuide(): void {
  window.dispatchEvent(new Event(HIDE_MIDI_DEVICE_GUIDE_EVENT));
}

function isVisibleInViewport(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  if (
    rect.bottom <= 0 ||
    rect.right <= 0 ||
    rect.top >= window.innerHeight ||
    rect.left >= window.innerWidth
  ) {
    return false;
  }

  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0;
}

function getRectEdgePoint(
  rect: DOMRect,
  towardX: number,
  towardY: number,
  gap = 0
): { x: number; y: number } {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const deltaX = towardX - centerX;
  const deltaY = towardY - centerY;
  const scale = Math.min(
    Math.abs(deltaX) > 0 ? (rect.width / 2 + gap) / Math.abs(deltaX) : Number.POSITIVE_INFINITY,
    Math.abs(deltaY) > 0 ? (rect.height / 2 + gap) / Math.abs(deltaY) : Number.POSITIVE_INFINITY
  );
  return { x: centerX + deltaX * scale, y: centerY + deltaY * scale };
}

function findElementGuideGeometry(
  warning: HTMLElement,
  target: HTMLElement
): MidiDeviceGuideGeometry | null {
  if (
    !warning.isConnected ||
    !target.isConnected ||
    !isVisibleInViewport(warning) ||
    !isVisibleInViewport(target)
  ) {
    return null;
  }

  const warningRect = warning.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const warningCenterX = warningRect.left + warningRect.width / 2;
  const warningCenterY = warningRect.top + warningRect.height / 2;
  const targetCenterX = targetRect.left + targetRect.width / 2;
  const targetCenterY = targetRect.top + targetRect.height / 2;
  const start = getRectEdgePoint(warningRect, targetCenterX, targetCenterY);
  const targetPoint = getRectEdgePoint(targetRect, warningCenterX, warningCenterY);

  return {
    height: window.innerHeight,
    length: Math.hypot(targetPoint.x - start.x, targetPoint.y - start.y),
    startX: start.x,
    startY: start.y,
    targetX: targetPoint.x,
    targetY: targetPoint.y,
    width: window.innerWidth,
  };
}

function findGuideGeometry(
  elements: SetupRequirementGuideDetail | null
): MidiDeviceGuideGeometry | null {
  return elements ? findElementGuideGeometry(elements.warning, elements.target) : null;
}

function getArrowMetrics(guide: MidiDeviceGuideGeometry): {
  headPath: string;
  lineEndX: number;
  lineEndY: number;
  lineLength: number;
} {
  const deltaX = guide.targetX - guide.startX;
  const deltaY = guide.targetY - guide.startY;
  const length = Math.max(guide.length, 1);
  const directionX = deltaX / length;
  const directionY = deltaY / length;
  const headLength = Math.min(MIDI_GUIDE_ARROW_HEAD_LENGTH, guide.length * 0.45);
  const headBaseX = guide.targetX - directionX * headLength;
  const headBaseY = guide.targetY - directionY * headLength;
  const perpendicularX = -directionY * MIDI_GUIDE_ARROW_HEAD_HALF_WIDTH;
  const perpendicularY = directionX * MIDI_GUIDE_ARROW_HEAD_HALF_WIDTH;

  return {
    headPath: `M ${guide.targetX} ${guide.targetY} L ${headBaseX + perpendicularX} ${headBaseY + perpendicularY} L ${headBaseX - perpendicularX} ${headBaseY - perpendicularY} Z`,
    lineEndX: headBaseX,
    lineEndY: headBaseY,
    lineLength: Math.max(guide.length - headLength, 0),
  };
}

export function MidiDeviceGuideArrow(): JSX.Element | null {
  const [guide, setGuide] = useState<MidiDeviceGuideState | null>(null);
  const requestIdRef = useRef(0);
  const activeElementsRef = useRef<SetupRequirementGuideDetail | null>(null);
  const animationFrameIdsRef = useRef<number[]>([]);
  const positionFrameIdRef = useRef<number | null>(null);
  const fadeTimerRef = useRef<number | null>(null);
  const removeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const clearPendingWork = (): void => {
      animationFrameIdsRef.current.forEach((id) => window.cancelAnimationFrame(id));
      animationFrameIdsRef.current = [];
      if (positionFrameIdRef.current !== null) {
        window.cancelAnimationFrame(positionFrameIdRef.current);
        positionFrameIdRef.current = null;
      }
      if (fadeTimerRef.current !== null) window.clearTimeout(fadeTimerRef.current);
      if (removeTimerRef.current !== null) window.clearTimeout(removeTimerRef.current);
      fadeTimerRef.current = null;
      removeTimerRef.current = null;
    };

    const refreshGuidePosition = (): void => {
      if (positionFrameIdRef.current !== null) return;
      positionFrameIdRef.current = window.requestAnimationFrame(() => {
        positionFrameIdRef.current = null;
        const requestId = requestIdRef.current;
        const geometry = findGuideGeometry(activeElementsRef.current);
        setGuide((current) => {
          if (!current || current.id !== requestId) return current;
          if (!geometry) return current.isVisible ? { ...current, isVisible: false } : current;

          const hasSameGeometry =
            current.width === geometry.width &&
            current.height === geometry.height &&
            current.startX === geometry.startX &&
            current.startY === geometry.startY &&
            current.targetX === geometry.targetX &&
            current.targetY === geometry.targetY;
          if (hasSameGeometry && current.isVisible) return current;
          return { ...current, ...geometry, isVisible: true };
        });
      });
    };

    const hideGuide = (): void => {
      requestIdRef.current += 1;
      activeElementsRef.current = null;
      clearPendingWork();
      setGuide(null);
    };

    const clearWhenDocumentIsInactive = (): void => {
      if (document.visibilityState !== "visible") hideGuide();
    };

    const clearWhenNavigating = (event: MouseEvent): void => {
      if (
        event.target instanceof Element &&
        event.target.closest("button, a, input, select, [role='tab']")
      ) {
        hideGuide();
      }
    };

    const showGuide = (elements: SetupRequirementGuideDetail | null = null): void => {
      const requestId = ++requestIdRef.current;
      activeElementsRef.current = elements;
      clearPendingWork();
      setGuide(null);

      let attempts = 0;
      const findVisibleGuide = (): void => {
        animationFrameIdsRef.current = [];
        if (requestId !== requestIdRef.current) return;

        const geometry = findGuideGeometry(elements);
        if (!geometry) {
          if (attempts >= 120) return;
          attempts += 1;
          animationFrameIdsRef.current = [window.requestAnimationFrame(findVisibleGuide)];
          return;
        }

        setGuide({ ...geometry, id: requestId, isFadingOut: false, isVisible: true });
        fadeTimerRef.current = window.setTimeout(() => {
          setGuide((current) =>
            current?.id === requestId ? { ...current, isFadingOut: true } : current
          );
        }, MIDI_GUIDE_DURATION_MS - MIDI_GUIDE_FADE_MS);
        removeTimerRef.current = window.setTimeout(() => {
          setGuide((current) => (current?.id === requestId ? null : current));
          if (activeElementsRef.current === elements) activeElementsRef.current = null;
          fadeTimerRef.current = null;
          removeTimerRef.current = null;
        }, MIDI_GUIDE_DURATION_MS);
      };
      animationFrameIdsRef.current = [window.requestAnimationFrame(findVisibleGuide)];
    };

    const showSetupRequirementGuide = (event: Event): void => {
      const detail = (event as CustomEvent<SetupRequirementGuideDetail>).detail;
      if (detail?.warning && detail?.target) showGuide(detail);
    };
    window.addEventListener(HIDE_MIDI_DEVICE_GUIDE_EVENT, hideGuide);
    window.addEventListener(SETUP_REQUIREMENT_GUIDE_EVENT, showSetupRequirementGuide);
    window.addEventListener("scroll", refreshGuidePosition, { capture: true, passive: true });
    window.addEventListener("resize", refreshGuidePosition);
    window.visualViewport?.addEventListener("scroll", refreshGuidePosition);
    window.visualViewport?.addEventListener("resize", refreshGuidePosition);
    window.addEventListener("blur", hideGuide);
    window.addEventListener("pagehide", hideGuide);
    window.addEventListener("hashchange", hideGuide);
    window.addEventListener("popstate", hideGuide);
    document.addEventListener("visibilitychange", clearWhenDocumentIsInactive);
    document.addEventListener("click", clearWhenNavigating, true);
    return () => {
      window.removeEventListener(HIDE_MIDI_DEVICE_GUIDE_EVENT, hideGuide);
      window.removeEventListener(SETUP_REQUIREMENT_GUIDE_EVENT, showSetupRequirementGuide);
      window.removeEventListener("scroll", refreshGuidePosition, true);
      window.removeEventListener("resize", refreshGuidePosition);
      window.visualViewport?.removeEventListener("scroll", refreshGuidePosition);
      window.visualViewport?.removeEventListener("resize", refreshGuidePosition);
      window.removeEventListener("blur", hideGuide);
      window.removeEventListener("pagehide", hideGuide);
      window.removeEventListener("hashchange", hideGuide);
      window.removeEventListener("popstate", hideGuide);
      document.removeEventListener("visibilitychange", clearWhenDocumentIsInactive);
      document.removeEventListener("click", clearWhenNavigating, true);
      clearPendingWork();
    };
  }, []);

  if (!guide || !guide.isVisible) return null;
  const arrowMetrics = getArrowMetrics(guide);
  const linePath = `M ${guide.startX} ${guide.startY} L ${arrowMetrics.lineEndX} ${arrowMetrics.lineEndY}`;
  const revealMaskId = `midi-device-guide-reveal-${guide.id}`;
  const lineLengthStyle = {
    "--midi-guide-line-length": `${arrowMetrics.lineLength}px`,
  } as React.CSSProperties;

  return createPortal(
    <svg
      aria-hidden="true"
      className={`midi-device-guide-arrow${guide.isFadingOut ? " is-fading-out" : ""}`}
      key={guide.id}
      preserveAspectRatio="none"
      viewBox={`0 0 ${guide.width} ${guide.height}`}
    >
      <defs>
        <mask
          height={guide.height}
          id={revealMaskId}
          maskContentUnits="userSpaceOnUse"
          maskUnits="userSpaceOnUse"
          width={guide.width}
          x="0"
          y="0"
        >
          <path className="midi-device-guide-arrow-reveal" d={linePath} style={lineLengthStyle} />
        </mask>
      </defs>
      <path className="midi-device-guide-arrow-line" d={linePath} mask={`url(#${revealMaskId})`} />
      <path className="midi-device-guide-arrow-head" d={arrowMetrics.headPath} />
    </svg>,
    document.body
  );
}
