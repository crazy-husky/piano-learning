import { Maximize2, Minimize2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

const DESKTOP_POINTER_QUERY = "(min-width: 821px) and (hover: hover) and (pointer: fine)";

interface PracticeFullscreenFrameProps {
  children: ReactNode;
  enabled: boolean;
}

export function PracticeFullscreenFrame({
  children,
  enabled,
}: PracticeFullscreenFrameProps): JSX.Element {
  const frameRef = useRef<HTMLDivElement>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const frame = frameRef.current;
    const desktopQuery = window.matchMedia(DESKTOP_POINTER_QUERY);
    const updateDesktopAvailability = (): void => {
      const isMobileOrTablet =
        /Android|iPad|iPhone|iPod/i.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      setIsDesktop(
        Boolean(
          !isMobileOrTablet &&
          desktopQuery.matches &&
          document.fullscreenEnabled &&
          frame?.requestFullscreen
        )
      );
    };
    const updateFullscreenState = (): void => {
      const active = document.fullscreenElement === frame;
      setIsFullscreen(active);
    };

    updateDesktopAvailability();
    updateFullscreenState();
    desktopQuery.addEventListener("change", updateDesktopAvailability);
    document.addEventListener("fullscreenchange", updateFullscreenState);

    return () => {
      desktopQuery.removeEventListener("change", updateDesktopAvailability);
      document.removeEventListener("fullscreenchange", updateFullscreenState);
      if (document.fullscreenElement === frame) {
        void document.exitFullscreen();
      }
    };
  }, []);

  useEffect(() => {
    const exitFullscreenOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || document.fullscreenElement !== frameRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void document.exitFullscreen();
    };

    document.addEventListener("keydown", exitFullscreenOnEscape, true);
    return () => document.removeEventListener("keydown", exitFullscreenOnEscape, true);
  }, []);

  useEffect(() => {
    if (!enabled && document.fullscreenElement === frameRef.current) {
      void document.exitFullscreen();
    }
  }, [enabled]);

  const toggleFullscreen = useCallback(async (): Promise<void> => {
    const frame = frameRef.current;
    if (!frame) return;

    try {
      if (document.fullscreenElement === frame) {
        await document.exitFullscreen();
      } else {
        if (document.fullscreenElement) {
          toast.error("请先退出当前全屏模式");
          return;
        }
        await frame.requestFullscreen();
      }
    } catch {
      toast.error("无法进入全屏模式，请检查浏览器的全屏权限");
    }
  }, []);

  return (
    <div className="practice-fullscreen-frame" ref={frameRef}>
      {enabled && isDesktop ? (
        <button
          aria-label={isFullscreen ? "退出全屏沉浸模式" : "进入全屏沉浸模式"}
          aria-pressed={isFullscreen}
          className="practice-fullscreen-toggle"
          onClick={() => void toggleFullscreen()}
          title={isFullscreen ? "退出全屏沉浸模式" : "进入全屏沉浸模式"}
          type="button"
        >
          {isFullscreen ? (
            <Minimize2 aria-hidden="true" size={18} />
          ) : (
            <Maximize2 aria-hidden="true" size={18} />
          )}
        </button>
      ) : null}
      {children}
    </div>
  );
}
