import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from "react";

const FLOATING_POSITION_KEY = "anki-note.metronomeFloatingPosition";
const POSITION_MARGIN = 8;
const DRAG_THRESHOLD = 6;
const CLICK_SUPPRESSION_MS = 120;
const DRAG_HANDLE_SELECTOR =
  ".metronome-floating-trigger, .metronome-compact-bar, .metronome-compact-woodfish, .metronome-panel-heading";

interface Position {
  left: number;
  top: number;
}

interface SavedPosition {
  xRatio: number;
  yRatio: number;
}

interface DragGesture {
  pointerId: number;
  startX: number;
  startY: number;
  originLeft: number;
  originTop: number;
  width: number;
  height: number;
  handle: HTMLElement;
  captureTarget: Element;
  moved: boolean;
  longPressTriggered: boolean;
}

function readSavedPosition(positionKey: string): SavedPosition | null {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(positionKey) ?? "null");
    if (!value || typeof value !== "object") return null;
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.xRatio !== "number" || typeof candidate.yRatio !== "number") return null;
    return {
      xRatio: Math.min(1, Math.max(0, candidate.xRatio)),
      yRatio: Math.min(1, Math.max(0, candidate.yRatio)),
    };
  } catch {
    return null;
  }
}

function getMaxLeft(width: number): number {
  return Math.max(POSITION_MARGIN, window.innerWidth - width - POSITION_MARGIN);
}

function getMaxTop(height: number): number {
  return Math.max(POSITION_MARGIN, window.innerHeight - height - POSITION_MARGIN);
}

function clampPosition(position: Position, width: number, height: number): Position {
  return {
    left: Math.min(getMaxLeft(width), Math.max(POSITION_MARGIN, position.left)),
    top: Math.min(getMaxTop(height), Math.max(POSITION_MARGIN, position.top)),
  };
}

function positionFromRatios(saved: SavedPosition, width: number, height: number): Position {
  const maxLeft = getMaxLeft(width);
  const maxTop = getMaxTop(height);
  return {
    left: POSITION_MARGIN + saved.xRatio * Math.max(0, maxLeft - POSITION_MARGIN),
    top: POSITION_MARGIN + saved.yRatio * Math.max(0, maxTop - POSITION_MARGIN),
  };
}

function persistPosition(
  position: Position,
  width: number,
  height: number,
  positionKey: string
): void {
  const maxLeft = getMaxLeft(width);
  const maxTop = getMaxTop(height);
  const xRange = maxLeft - POSITION_MARGIN;
  const yRange = maxTop - POSITION_MARGIN;
  try {
    window.localStorage.setItem(
      positionKey,
      JSON.stringify({
        xRatio: xRange > 0 ? (position.left - POSITION_MARGIN) / xRange : 0,
        yRatio: yRange > 0 ? (position.top - POSITION_MARGIN) / yRange : 0,
      } satisfies SavedPosition)
    );
  } catch {
    // The floating control remains draggable for this visit if storage is unavailable.
  }
}

export function useDraggableMetronomeFloating({
  rootRef,
  enabled,
  expanded,
  initialPosition = "saved",
  onLongPress,
  positionKey = FLOATING_POSITION_KEY,
  fallbackPositionKey,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  expanded: boolean;
  initialPosition?: "center" | "saved";
  onLongPress: () => void;
  positionKey?: string;
  fallbackPositionKey?: string;
}): {
  onClickCapture: (event: MouseEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  snapToNearestHorizontalEdge: (dockThreshold: number) => "left" | "right" | null;
  style: CSSProperties | undefined;
} {
  const [position, setPosition] = useState<Position | null>(null);
  const positionRef = useRef<Position | null>(null);
  const positionKeyRef = useRef(positionKey);
  const initialPositionKeyRef = useRef(positionKey);
  const hasUserDraggedRef = useRef(false);
  const dragRef = useRef<DragGesture | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const suppressClickUntilRef = useRef(0);

  const updatePosition = (next: Position): void => {
    positionRef.current = next;
    setPosition(next);
  };

  const snapToNearestHorizontalEdge = useCallback(
    (dockThreshold: number): "left" | "right" | null => {
      const element = rootRef.current;
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const leftGap = rect.left;
      const rightGap = window.innerWidth - rect.right;
      const dockedEdge =
        leftGap <= dockThreshold ? "left" : rightGap <= dockThreshold ? "right" : null;
      if (dockedEdge) return dockedEdge;

      const nearestEdge = leftGap <= rightGap ? "left" : "right";
      const nextPosition = clampPosition(
        {
          left:
            nearestEdge === "left"
              ? POSITION_MARGIN
              : window.innerWidth - rect.width - POSITION_MARGIN,
          top: rect.top,
        },
        rect.width,
        rect.height
      );
      positionRef.current = nextPosition;
      setPosition(nextPosition);
      persistPosition(nextPosition, rect.width, rect.height, positionKeyRef.current);
      return nearestEdge;
    },
    [rootRef]
  );

  const cancelLongPress = (): void => {
    if (longPressTimerRef.current === null) return;
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  useEffect(() => {
    if (!enabled) return undefined;
    const root = rootRef.current;
    if (!root) return undefined;

    const fitCurrentPosition = (): void => {
      const element = rootRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const current = positionRef.current;
      const positionKeyChanged = positionKeyRef.current !== positionKey;
      if (positionKeyChanged) positionKeyRef.current = positionKey;
      const fallbackPosition =
        fallbackPositionKey && (initialPosition !== "center" || hasUserDraggedRef.current)
          ? readSavedPosition(fallbackPositionKey)
          : null;

      if (
        initialPosition === "center" &&
        !hasUserDraggedRef.current &&
        positionKey === initialPositionKeyRef.current
      ) {
        const centered = clampPosition(
          {
            left: (window.innerWidth - rect.width) / 2,
            top: (window.innerHeight - rect.height) / 2,
          },
          rect.width,
          rect.height
        );
        if (!current || current.left !== centered.left || current.top !== centered.top) {
          updatePosition(centered);
        }
        return;
      }

      if (positionKeyChanged || !current) {
        const saved = readSavedPosition(positionKey) ?? fallbackPosition;
        if (saved) {
          updatePosition(positionFromRatios(saved, rect.width, rect.height));
          return;
        }
      }

      if (current) {
        const saved = readSavedPosition(positionKey) ?? fallbackPosition;
        if (saved) {
          updatePosition(positionFromRatios(saved, rect.width, rect.height));
          return;
        }
        const next = clampPosition(current, rect.width, rect.height);
        if (next.left !== current.left || next.top !== current.top) updatePosition(next);
        return;
      }
    };

    const frame = window.requestAnimationFrame(fitCurrentPosition);
    window.addEventListener("resize", fitCurrentPosition);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", fitCurrentPosition);
    };
  }, [enabled, expanded, fallbackPositionKey, initialPosition, positionKey, rootRef]);

  useEffect(
    () => () => {
      cancelLongPress();
      const gesture = dragRef.current;
      if (gesture?.captureTarget.hasPointerCapture(gesture.pointerId)) {
        gesture.captureTarget.releasePointerCapture(gesture.pointerId);
      }
    },
    []
  );

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (!enabled || (event.pointerType === "mouse" && event.button !== 0)) return;
    if (!(event.target instanceof Element)) return;
    const handle = event.target.closest<HTMLElement>(DRAG_HANDLE_SELECTOR);
    const root = rootRef.current;
    if (!handle || !root) return;
    if (event.target.closest("input, select, textarea, [contenteditable='true']")) return;

    const isCompactBar = handle.matches(".metronome-compact-bar");
    const isWoodfishButton = event.target.closest(
      ".metronome-floating-trigger, .metronome-compact-woodfish"
    );
    if (event.target.closest("button, a, [role='button']") && !isWoodfishButton && !isCompactBar) {
      return;
    }

    cancelLongPress();
    const rect = root.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originLeft: rect.left,
      originTop: rect.top,
      width: rect.width,
      height: rect.height,
      handle,
      captureTarget: event.target,
      moved: false,
      longPressTriggered: false,
    };
    try {
      event.target.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is an enhancement; pointer events still work without it.
    }

    const supportsHideMenu = handle.matches(
      ".metronome-floating-trigger, .metronome-compact-woodfish"
    );
    if (event.pointerType !== "mouse" && supportsHideMenu) {
      longPressTimerRef.current = window.setTimeout(() => {
        const gesture = dragRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId || gesture.moved) return;
        gesture.longPressTriggered = true;
        suppressClickUntilRef.current = performance.now() + CLICK_SUPPRESSION_MS;
        onLongPress();
        longPressTimerRef.current = null;
      }, 550);
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const gesture = dragRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.longPressTriggered) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    if (!gesture.moved && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) return;

    gesture.moved = true;
    hasUserDraggedRef.current = true;
    cancelLongPress();
    event.preventDefault();
    updatePosition(
      clampPosition(
        { left: gesture.originLeft + deltaX, top: gesture.originTop + deltaY },
        gesture.width,
        gesture.height
      )
    );
  };

  const finishGesture = (event: PointerEvent<HTMLDivElement>): void => {
    const gesture = dragRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    cancelLongPress();

    if (gesture.moved) {
      const deltaX = event.clientX - gesture.startX;
      const deltaY = event.clientY - gesture.startY;
      const finalPosition = clampPosition(
        { left: gesture.originLeft + deltaX, top: gesture.originTop + deltaY },
        gesture.width,
        gesture.height
      );
      updatePosition(finalPosition);
      persistPosition(finalPosition, gesture.width, gesture.height, positionKey);
      suppressClickUntilRef.current = performance.now() + CLICK_SUPPRESSION_MS;
    }

    dragRef.current = null;
    if (gesture.captureTarget.hasPointerCapture(event.pointerId)) {
      gesture.captureTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onClickCapture = (event: MouseEvent<HTMLDivElement>): void => {
    if (performance.now() > suppressClickUntilRef.current) return;
    suppressClickUntilRef.current = 0;
    event.preventDefault();
    event.stopPropagation();
  };

  return {
    onClickCapture,
    onPointerCancel: finishGesture,
    onPointerDown,
    onPointerMove,
    onPointerUp: finishGesture,
    snapToNearestHorizontalEdge,
    style: position
      ? {
          position: "fixed",
          left: position.left + "px",
          top: position.top + "px",
          right: "auto",
          bottom: "auto",
          transform: "none",
        }
      : undefined,
  };
}
