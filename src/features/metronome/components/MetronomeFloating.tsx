import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { toast } from "sonner";
import type { MetronomeController } from "../useMetronomeController";
import { useDraggableMetronomeFloating } from "../useDraggableMetronomeFloating";
import { METRONOME_HIDDEN_UNTIL_KEY } from "../metronomeVisibility";
import { MetronomeCore } from "./MetronomeCore";
import { WoodfishIllustration } from "./WoodfishIllustration";

const FLOATING_ICON_POSITION_KEY = "anki-note.metronomeFloatingIconPosition";
const FLOATING_COMPACT_POSITION_KEY = "anki-note.metronomeFloatingCompactPosition";
const FLOATING_PANEL_POSITION_KEY = "anki-note.metronomeFloatingPosition";
const MINI_IDLE_DELAY_MS = 5000;
const MINI_DOCK_THRESHOLD_PX = 50;
const MINI_EDGE_INSET_PX = 5;
const COMPACT_HOVER_SUPPRESSION_MS = 500;

const HIDDEN_METRONOME_TOAST_DESCRIPTION =
  "之后可在设置 > 外观与体验中点击「重新启用木鱼节拍器」恢复显示。";

function readHiddenUntil(): number {
  if (typeof window === "undefined") return 0;
  try {
    const until = Number(window.localStorage.getItem(METRONOME_HIDDEN_UNTIL_KEY));
    if (Number.isFinite(until) && until > Date.now()) return until;
    window.localStorage.removeItem(METRONOME_HIDDEN_UNTIL_KEY);
  } catch {
    // Storage may be unavailable in private browsing.
  }
  return 0;
}

function nextLocalDayStart(): number {
  const next = new Date();
  next.setHours(24, 0, 0, 0);
  return next.getTime();
}

function nextWeekStart(): number {
  const next = new Date();
  const daysUntilMonday = (8 - next.getDay()) % 7 || 7;
  next.setDate(next.getDate() + daysUntilMonday);
  next.setHours(0, 0, 0, 0);
  return next.getTime();
}

export function MetronomeFloating({
  controller,
  hiddenForVisit,
  onHideForVisit,
  activePractice,
  onSyncPauseToggle,
}: {
  controller: MetronomeController;
  hiddenForVisit: boolean;
  onHideForVisit: () => void;
  activePractice: boolean;
  onSyncPauseToggle: () => void;
}): JSX.Element | null {
  const [hiddenUntil, setHiddenUntil] = useState(readHiddenUntil);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCompact, setIsCompact] = useState(false);
  const [isMiniHovered, setIsMiniHovered] = useState(false);
  const [isMiniPinnedOpen, setIsMiniPinnedOpen] = useState(false);
  const [isMiniAutoCollapsed, setIsMiniAutoCollapsed] = useState(false);
  const [isPointerInteracting, setIsPointerInteracting] = useState(false);
  const [shouldDockOnCompactReturn, setShouldDockOnCompactReturn] = useState(false);
  const [isTempoEditing, setIsTempoEditing] = useState(false);
  const [miniDockOffsetX, setMiniDockOffsetX] = useState(0);
  const [miniDockEdge, setMiniDockEdge] = useState<"left" | "right" | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isMenuAbove, setIsMenuAbove] = useState(false);
  const [interactionRevision, setInteractionRevision] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const miniDockOffsetXRef = useRef(0);
  const suppressCompactHoverUntilRef = useRef(0);
  const noteInteraction = useCallback((): void => {
    setInteractionRevision((revision) => revision + 1);
  }, []);
  const returnExpandedPanelToCompactBar = (): void => {
    suppressCompactHoverUntilRef.current = Date.now() + COMPACT_HOVER_SUPPRESSION_MS;
    setIsMenuOpen(false);
    setIsExpanded(false);
    setIsCompact(true);
    setIsMiniHovered(false);
    setIsMiniPinnedOpen(false);
    setIsMiniAutoCollapsed(false);
    setIsPointerInteracting(false);
    setShouldDockOnCompactReturn(true);
    setIsTempoEditing(false);
    noteInteraction();
  };

  const openMenu = (): void => {
    setIsMiniPinnedOpen(true);
    setIsMiniHovered(false);
    const anchor = rootRef.current?.querySelector<HTMLElement>(".metronome-menu-anchor");
    const rect = anchor?.getBoundingClientRect();
    const menuHeight = 146;
    setIsMenuAbove(Boolean(rect && rect.bottom + menuHeight + 8 > window.innerHeight - 8));
    setIsMenuOpen(true);
  };

  const toggleMenu = (): void => {
    if (isMenuOpen) {
      setIsMenuOpen(false);
      setIsMiniPinnedOpen(false);
      return;
    }
    openMenu();
  };

  const isVisible = !hiddenForVisit && hiddenUntil <= Date.now();
  const shouldHoldCompactBar =
    isMiniHovered || isMiniPinnedOpen || isMenuOpen || isPointerInteracting || isTempoEditing;
  const isMini = isCompact && isMiniAutoCollapsed && miniDockEdge !== null && !shouldHoldCompactBar;
  const miniDockEdgeRef = useRef(miniDockEdge);
  const isMiniRef = useRef(isMini);
  miniDockEdgeRef.current = miniDockEdge;
  isMiniRef.current = isMini;

  useLayoutEffect(() => {
    const updateMiniDockOffset = (): void => {
      if (!isMini || miniDockEdge === null) {
        miniDockOffsetXRef.current = 0;
        setMiniDockOffsetX(0);
        return;
      }

      const button = rootRef.current?.querySelector<HTMLElement>(".metronome-compact-woodfish");
      if (!button) return;
      const buttonBounds = button.getBoundingClientRect();
      const unadjustedLeft = buttonBounds.left - miniDockOffsetXRef.current;
      const unadjustedRight = buttonBounds.right - miniDockOffsetXRef.current;
      const nextOffset =
        miniDockEdge === "left"
          ? MINI_EDGE_INSET_PX - unadjustedLeft
          : window.innerWidth - MINI_EDGE_INSET_PX - unadjustedRight;

      miniDockOffsetXRef.current = nextOffset;
      setMiniDockOffsetX(nextOffset);
    };

    updateMiniDockOffset();
    if (!isMini) return undefined;
    window.addEventListener("resize", updateMiniDockOffset);
    return () => window.removeEventListener("resize", updateMiniDockOffset);
  }, [isMini, miniDockEdge]);

  const updateMiniDockEdge = useCallback((): void => {
    if (!isCompact) return;
    if (isMiniRef.current && miniDockEdgeRef.current !== null) return;
    const bounds = rootRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const leftGap = bounds.left;
    const rightGap = window.innerWidth - bounds.right;
    const nextEdge =
      leftGap <= MINI_DOCK_THRESHOLD_PX
        ? "left"
        : rightGap <= MINI_DOCK_THRESHOLD_PX
          ? "right"
          : null;
    if (miniDockEdgeRef.current === nextEdge) return;
    miniDockEdgeRef.current = nextEdge;
    setMiniDockEdge(nextEdge);
  }, [isCompact]);

  const dragHandlers = useDraggableMetronomeFloating({
    rootRef,
    enabled: isVisible,
    expanded: isExpanded || isCompact,
    onLongPress: openMenu,
    positionKey: isExpanded
      ? FLOATING_PANEL_POSITION_KEY
      : isCompact
        ? FLOATING_COMPACT_POSITION_KEY
        : FLOATING_ICON_POSITION_KEY,
    fallbackPositionKey: FLOATING_PANEL_POSITION_KEY,
  });
  const snapToNearestHorizontalEdge = dragHandlers.snapToNearestHorizontalEdge;

  useEffect(() => {
    if (!shouldDockOnCompactReturn || !isCompact || isExpanded) return undefined;
    let secondFrame = 0;
    let thirdFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        snapToNearestHorizontalEdge(MINI_DOCK_THRESHOLD_PX);
        thirdFrame = window.requestAnimationFrame(() => {
          updateMiniDockEdge();
          setShouldDockOnCompactReturn(false);
        });
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      window.cancelAnimationFrame(thirdFrame);
    };
  }, [
    isCompact,
    isExpanded,
    snapToNearestHorizontalEdge,
    shouldDockOnCompactReturn,
    updateMiniDockEdge,
  ]);

  const floatingStyle = {
    ...dragHandlers.style,
    "--mini-dock-offset-x": `${miniDockOffsetX}px`,
  } as CSSProperties;

  useEffect(() => {
    if (!hiddenUntil) return undefined;
    const timeout = window.setTimeout(() => setHiddenUntil(0), hiddenUntil - Date.now());
    return () => window.clearTimeout(timeout);
  }, [hiddenUntil]);

  useEffect(() => {
    setIsExpanded(false);
    setIsCompact(activePractice);
    setIsMiniHovered(false);
    setIsMiniPinnedOpen(false);
    setIsMiniAutoCollapsed(false);
    setIsPointerInteracting(false);
    setShouldDockOnCompactReturn(false);
    setIsTempoEditing(false);
    miniDockEdgeRef.current = null;
    setMiniDockEdge(null);
    setIsMenuOpen(false);
  }, [activePractice]);

  useEffect(() => {
    if (!isCompact || isExpanded || miniDockEdge === null) {
      setIsMiniAutoCollapsed(false);
      return undefined;
    }
    if (shouldHoldCompactBar) {
      setIsMiniAutoCollapsed(false);
      return undefined;
    }
    setIsMiniAutoCollapsed(false);
    const timeout = window.setTimeout(() => setIsMiniAutoCollapsed(true), MINI_IDLE_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [interactionRevision, isCompact, isExpanded, miniDockEdge, shouldHoldCompactBar]);

  useEffect(() => {
    if (!isCompact) {
      miniDockEdgeRef.current = null;
      setMiniDockEdge(null);
      return undefined;
    }
    const root = rootRef.current;
    const resizeObserver = root ? new ResizeObserver(updateMiniDockEdge) : null;
    if (root) resizeObserver?.observe(root);
    let followUpFrame = 0;
    const frame = window.requestAnimationFrame(() => {
      followUpFrame = window.requestAnimationFrame(updateMiniDockEdge);
    });
    window.addEventListener("resize", updateMiniDockEdge);
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(followUpFrame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateMiniDockEdge);
    };
  }, [isCompact, updateMiniDockEdge]);

  useEffect(() => {
    if (!isCompact) return undefined;
    const closeOnOutsidePress = (event: globalThis.PointerEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setIsMiniPinnedOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [isCompact]);

  useEffect(() => {
    if (!isMenuOpen) return undefined;
    const closeOnOutsidePress = (event: globalThis.PointerEvent): void => {
      if (!(event.target instanceof Element)) {
        setIsMenuOpen(false);
        return;
      }
      if (
        menuRef.current?.contains(event.target) ||
        event.target.closest(".metronome-menu-toggle")
      ) {
        return;
      }
      setIsMenuOpen(false);
      setIsMiniPinnedOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [isMenuOpen]);

  const hideUntil = (until: number): void => {
    try {
      window.localStorage.setItem(METRONOME_HIDDEN_UNTIL_KEY, String(until));
    } catch {
      // The current visit can still be hidden when storage is unavailable.
    }
    controller.stop();
    setHiddenUntil(until);
    setIsMenuOpen(false);
    setIsExpanded(false);
    setIsCompact(false);
    setIsMiniHovered(false);
    setIsMiniPinnedOpen(false);
    setIsMiniAutoCollapsed(false);
    setShouldDockOnCompactReturn(false);
    setIsTempoEditing(false);
    toast.success("木鱼节拍器已退出", {
      description: HIDDEN_METRONOME_TOAST_DESCRIPTION,
      duration: 5000,
    });
  };

  if (hiddenForVisit || hiddenUntil > Date.now()) return null;

  const menu = isMenuOpen ? (
    <div
      aria-label="隐藏木鱼节拍器"
      className={`metronome-hide-menu${isMenuAbove ? " is-above" : ""}`}
      ref={menuRef}
      role="menu"
    >
      <button
        onClick={() => {
          controller.stop();
          onHideForVisit();
          setIsMenuOpen(false);
          setIsCompact(false);
          setIsMiniHovered(false);
          setIsMiniPinnedOpen(false);
          setIsMiniAutoCollapsed(false);
          toast.success("木鱼节拍器已退出", {
            description: HIDDEN_METRONOME_TOAST_DESCRIPTION,
            duration: 5000,
          });
        }}
        role="menuitem"
        type="button"
      >
        本次退出
      </button>
      <button onClick={() => hideUntil(nextLocalDayStart())} role="menuitem" type="button">
        今天退出
      </button>
      <button onClick={() => hideUntil(nextWeekStart())} role="menuitem" type="button">
        本周退出
      </button>
    </div>
  ) : null;

  return (
    <div
      className={`metronome-floating${isMini ? " is-mini" : ""}${miniDockEdge ? ` is-docked-${miniDockEdge}` : ""}`}
      onClickCapture={(event) => {
        dragHandlers.onClickCapture(event);
        if (!event.defaultPrevented) noteInteraction();
      }}
      onPointerCancel={(event) => {
        dragHandlers.onPointerCancel(event);
        setIsPointerInteracting(false);
        noteInteraction();
        window.requestAnimationFrame(updateMiniDockEdge);
      }}
      onPointerDown={(event) => {
        dragHandlers.onPointerDown(event);
        setIsPointerInteracting(true);
        noteInteraction();
      }}
      onPointerMove={dragHandlers.onPointerMove}
      onPointerUp={(event) => {
        dragHandlers.onPointerUp(event);
        setIsPointerInteracting(false);
        noteInteraction();
        window.requestAnimationFrame(updateMiniDockEdge);
      }}
      ref={rootRef}
      style={floatingStyle}
    >
      {isExpanded ? (
        <MetronomeCore
          controller={controller}
          onSynchronizedToggle={onSyncPauseToggle}
          onStarted={returnExpandedPanelToCompactBar}
          onMinimize={returnExpandedPanelToCompactBar}
          onOpenMenu={toggleMenu}
          menu={menu}
          variant="panel"
        />
      ) : isCompact ? (
        <MetronomeCore
          controller={controller}
          onSynchronizedToggle={onSyncPauseToggle}
          onStarted={() => {
            setIsMiniHovered(false);
            setIsMiniPinnedOpen(false);
          }}
          onExpand={() => {
            setIsMenuOpen(false);
            setIsExpanded(true);
            setIsMiniHovered(false);
            setIsMiniPinnedOpen(false);
            setIsMiniAutoCollapsed(false);
          }}
          onOpenMenu={toggleMenu}
          mini={isMini}
          miniDockEdge={miniDockEdge}
          onMiniPointerEnter={() => {
            if (Date.now() >= suppressCompactHoverUntilRef.current) setIsMiniHovered(true);
          }}
          onMiniPointerLeave={() => setIsMiniHovered(false)}
          onTempoEditingChange={setIsTempoEditing}
          onInteraction={noteInteraction}
          onRevealMini={() => {
            setIsMiniPinnedOpen(true);
            setIsMiniHovered(false);
            setIsMiniAutoCollapsed(false);
          }}
          menu={menu}
          variant="compact"
        />
      ) : (
        <div className="metronome-menu-anchor">
          <button
            aria-label="打开木鱼节拍器；长按或右键选择退出方式"
            className="metronome-floating-trigger"
            onClick={() => {
              setIsMenuOpen(false);
              setIsExpanded(true);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              toggleMenu();
            }}
            type="button"
          >
            <WoodfishIllustration />
            <span>节拍</span>
          </button>
          {menu}
        </div>
      )}
    </div>
  );
}
