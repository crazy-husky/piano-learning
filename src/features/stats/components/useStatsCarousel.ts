import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
  type TransitionEvent as ReactTransitionEvent,
} from "react";
import {
  getStatsCarouselMoveDirection,
  getStatsCarouselOrder,
  normalizeStatsCarouselIndex,
  rotateStatsCarouselOrder,
  type StatsCarouselMoveDirection,
} from "./statsCarousel";
import {
  STATS_CAROUSEL_CARD_IDS,
  type StatsCarouselCardId,
  type StatsUiPreferences,
} from "./statsUiPreferences";

const STATS_CAROUSEL_DRAG_THRESHOLD_PX = 48;

type StatsCarouselTrackStyle = CSSProperties & {
  "--stats-carousel-single-translate": string;
  "--stats-carousel-translate": string;
};

interface UseStatsCarouselOptions {
  carouselCardId: StatsCarouselCardId;
  setStatsUiPreferences: Dispatch<SetStateAction<StatsUiPreferences>>;
}

function isFormControlTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest("button, input, select, textarea, [contenteditable='true']"))
  );
}

function isStatsCarouselDragBlockedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return true;
  }
  return Boolean(
    target.closest(
      [
        "button",
        "input",
        "select",
        "textarea",
        "a",
        "[contenteditable='true']",
        "[role='button']",
        ".chart-panel-actions",
        ".chart-box",
        ".note-heat-stack",
        ".session-progress-condition-bar",
        "canvas",
        "svg",
      ].join(", "),
    ),
  );
}

export function useStatsCarousel({ carouselCardId, setStatsUiPreferences }: UseStatsCarouselOptions) {
  const statsCarouselDragRef = useRef<{
    dragging: boolean;
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  const statsCarouselMovingRef = useRef(false);
  const statsCarouselMoveDirectionRef = useRef<StatsCarouselMoveDirection | null>(null);
  const [singleCardCarousel, setSingleCardCarousel] = useState(false);
  const statsCarouselIndex = STATS_CAROUSEL_CARD_IDS.indexOf(carouselCardId);
  const [statsCarouselOrder, setStatsCarouselOrder] = useState(() => getStatsCarouselOrder(statsCarouselIndex));
  const [statsCarouselOffset, setStatsCarouselOffset] = useState<0 | 1>(0);
  const [statsCarouselTransitionEnabled, setStatsCarouselTransitionEnabled] = useState(true);

  const commitStatsCarouselIndex = (nextIndex: number): void => {
    const normalizedIndex = normalizeStatsCarouselIndex(nextIndex);
    setStatsUiPreferences((current) => {
      return {
        ...current,
        carouselCardId: STATS_CAROUSEL_CARD_IDS[normalizedIndex],
      };
    });
  };
  const startStatsCarouselMove = (targetIndex: number): void => {
    if (statsCarouselMovingRef.current) {
      return;
    }

    const normalizedIndex = normalizeStatsCarouselIndex(targetIndex);
    const direction = getStatsCarouselMoveDirection(statsCarouselIndex, normalizedIndex);
    if (direction === undefined) {
      commitStatsCarouselIndex(normalizedIndex);
      return;
    }

    statsCarouselMovingRef.current = true;
    statsCarouselMoveDirectionRef.current = direction;
    commitStatsCarouselIndex(normalizedIndex);
    if (direction === 1) {
      setStatsCarouselTransitionEnabled(true);
      setStatsCarouselOffset(1);
      return;
    }

    setStatsCarouselTransitionEnabled(false);
    setStatsCarouselOrder((current) => rotateStatsCarouselOrder(current, -1));
    setStatsCarouselOffset(1);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setStatsCarouselTransitionEnabled(true);
        setStatsCarouselOffset(0);
      });
    });
  };
  const moveStatsCarousel = (direction: -1 | 1): void => {
    startStatsCarouselMove(statsCarouselIndex + direction);
  };
  const jumpStatsCarousel = (targetIndex: number): void => {
    startStatsCarouselMove(targetIndex);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const modified = event.altKey || event.ctrlKey || event.metaKey;
      if (event.defaultPrevented || modified || isFormControlTarget(event.target)) {
        return;
      }
      if (event.key === "ArrowLeft") {
        moveStatsCarousel(-1);
        event.preventDefault();
      }
      if (event.key === "ArrowRight") {
        moveStatsCarousel(1);
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [statsCarouselIndex]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 820px)");
    const updateSingleCardCarousel = (): void => setSingleCardCarousel(media.matches);
    updateSingleCardCarousel();
    media.addEventListener("change", updateSingleCardCarousel);
    return () => media.removeEventListener("change", updateSingleCardCarousel);
  }, []);

  const statsCarouselTrackStyle = {
    "--stats-carousel-single-translate": `calc(-${statsCarouselOffset * 100}% - ${statsCarouselOffset * 18}px)`,
    "--stats-carousel-translate": `calc(-${statsCarouselOffset * 50}% - ${statsCarouselOffset * 9}px)`,
  } as StatsCarouselTrackStyle;
  const finishStatsCarouselTransition = (event: ReactTransitionEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget || event.propertyName !== "transform") {
      return;
    }
    const direction = statsCarouselMoveDirectionRef.current;
    statsCarouselMoveDirectionRef.current = null;
    statsCarouselMovingRef.current = false;
    if (direction !== 1) {
      return;
    }
    setStatsCarouselTransitionEnabled(false);
    setStatsCarouselOrder((current) => rotateStatsCarouselOrder(current, 1));
    setStatsCarouselOffset(0);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setStatsCarouselTransitionEnabled(true));
    });
  };
  const beginStatsCarouselDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || !event.isPrimary || isStatsCarouselDragBlockedTarget(event.target)) {
      return;
    }
    statsCarouselDragRef.current = {
      dragging: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const updateStatsCarouselDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = statsCarouselDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) > 8) {
      drag.dragging = true;
    }
  };
  const endStatsCarouselDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = statsCarouselDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    statsCarouselDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    const horizontalDrag =
      drag.dragging &&
      Math.abs(deltaX) >= STATS_CAROUSEL_DRAG_THRESHOLD_PX &&
      Math.abs(deltaX) > Math.abs(deltaY) * 1.2;
    if (!horizontalDrag) {
      return;
    }

    moveStatsCarousel(deltaX < 0 ? 1 : -1);
    event.preventDefault();
  };
  const cancelStatsCarouselDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = statsCarouselDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    statsCarouselDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const visibleStatsCarouselCardIds = new Set([
    STATS_CAROUSEL_CARD_IDS[statsCarouselIndex],
    ...(singleCardCarousel ? [] : [STATS_CAROUSEL_CARD_IDS[normalizeStatsCarouselIndex(statsCarouselIndex + 1)]]),
  ]);

  return {
    beginStatsCarouselDrag,
    cancelStatsCarouselDrag,
    endStatsCarouselDrag,
    finishStatsCarouselTransition,
    jumpStatsCarousel,
    moveStatsCarousel,
    singleCardCarousel,
    statsCarouselIndex,
    statsCarouselOrder,
    statsCarouselTrackStyle,
    statsCarouselTransitionEnabled,
    updateStatsCarouselDrag,
    visibleStatsCarouselCardIds,
  };
}
