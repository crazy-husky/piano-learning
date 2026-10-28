import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { MetronomeController } from "../useMetronomeController";
import { useDraggableMetronomeFloating } from "../useDraggableMetronomeFloating";
import { METRONOME_HIDDEN_UNTIL_KEY } from "../metronomeVisibility";
import { MetronomeCore } from "./MetronomeCore";
import { WoodfishIllustration } from "./WoodfishIllustration";

const FLOATING_ICON_POSITION_KEY = "anki-note.metronomeFloatingIconPosition";
const FLOATING_COMPACT_POSITION_KEY = "anki-note.metronomeFloatingCompactPosition";
const FLOATING_PANEL_POSITION_KEY = "anki-note.metronomeFloatingPosition";

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
  const [miniDockEdge, setMiniDockEdge] = useState<"left" | "right" | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isMenuAbove, setIsMenuAbove] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

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
      return;
    }
    openMenu();
  };

  const isVisible = !hiddenForVisit && hiddenUntil <= Date.now();
  const isMini =
    isCompact &&
    controller.isPlaying &&
    miniDockEdge !== null &&
    !isMiniHovered &&
    !isMiniPinnedOpen;

  const updateMiniDockEdge = useCallback((): void => {
    if (!isCompact) return;
    const bounds = rootRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const edgeThreshold = 44;
    const leftGap = bounds.left;
    const rightGap = window.innerWidth - bounds.right;
    const nextEdge = leftGap <= edgeThreshold ? "left" : rightGap <= edgeThreshold ? "right" : null;
    setMiniDockEdge((current) => (current === nextEdge ? current : nextEdge));
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
    setMiniDockEdge(null);
    setIsMenuOpen(false);
  }, [activePractice]);

  useEffect(() => {
    if (!isCompact) {
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
    if (!isMiniPinnedOpen) return undefined;
    const closeOnOutsidePress = (event: globalThis.PointerEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setIsMiniPinnedOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [isMiniPinnedOpen]);

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
      onClickCapture={dragHandlers.onClickCapture}
      onPointerCancel={(event) => {
        dragHandlers.onPointerCancel(event);
        window.requestAnimationFrame(updateMiniDockEdge);
      }}
      onPointerDown={dragHandlers.onPointerDown}
      onPointerMove={dragHandlers.onPointerMove}
      onPointerUp={(event) => {
        dragHandlers.onPointerUp(event);
        window.requestAnimationFrame(updateMiniDockEdge);
      }}
      ref={rootRef}
      style={dragHandlers.style}
    >
      {isExpanded ? (
        <MetronomeCore
          controller={controller}
          onSynchronizedToggle={onSyncPauseToggle}
          onStarted={() => {
            setIsExpanded(false);
            setIsCompact(true);
            setIsMiniHovered(false);
            setIsMiniPinnedOpen(false);
            setIsMenuOpen(false);
          }}
          closeLabel="暂停并收起"
          onClose={() => {
            setIsMenuOpen(false);
            setIsExpanded(false);
            setIsCompact(false);
            setIsMiniHovered(false);
            setIsMiniPinnedOpen(false);
          }}
          onMinimize={() => {
            setIsMenuOpen(false);
            setIsExpanded(false);
            setIsCompact(true);
            setIsMiniHovered(false);
            setIsMiniPinnedOpen(false);
          }}
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
          closeLabel="暂停并收起"
          onExpand={() => {
            setIsMenuOpen(false);
            setIsExpanded(true);
          }}
          onOpenMenu={toggleMenu}
          mini={isMini}
          miniDockEdge={miniDockEdge}
          onMiniPointerEnter={() => setIsMiniHovered(true)}
          onMiniPointerLeave={() => setIsMiniHovered(false)}
          onRevealMini={() => {
            setIsMiniPinnedOpen(true);
            setIsMiniHovered(false);
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
