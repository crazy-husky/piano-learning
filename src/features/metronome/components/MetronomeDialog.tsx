import { useEffect, useRef, useState } from "react";
import type { MetronomeController } from "../useMetronomeController";
import { useDraggableMetronomeFloating } from "../useDraggableMetronomeFloating";
import { MetronomeCore } from "./MetronomeCore";

const DIALOG_POSITION_KEY = "anki-note.metronomeDialogPosition";
const DIALOG_COMPACT_POSITION_KEY = "anki-note.metronomeDialogCompactPosition";

export function MetronomeDialog({
  controller,
  onClose,
}: {
  controller: MetronomeController;
  onClose: () => void;
}): JSX.Element {
  const [isMinimized, setIsMinimized] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const stopMetronome = controller.stop;
  const dragHandlers = useDraggableMetronomeFloating({
    rootRef: dialogRef,
    enabled: true,
    expanded: !isMinimized,
    onLongPress: () => undefined,
    positionKey: isMinimized ? DIALOG_COMPACT_POSITION_KEY : DIALOG_POSITION_KEY,
    fallbackPositionKey: DIALOG_POSITION_KEY,
  });

  useEffect(() => {
    if (isMinimized) return undefined;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        stopMetronome();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [isMinimized, onClose, stopMetronome]);

  const minimize = (): void => {
    setIsMinimized(true);
  };

  return (
    <>
      {!isMinimized ? <div aria-hidden="true" className="metronome-dialog-backdrop" /> : null}
      <div
        className={`metronome-dialog-window${isMinimized ? " is-minimized" : ""}`}
        onClickCapture={dragHandlers.onClickCapture}
        onPointerCancel={dragHandlers.onPointerCancel}
        onPointerDown={dragHandlers.onPointerDown}
        onPointerMove={dragHandlers.onPointerMove}
        onPointerUp={dragHandlers.onPointerUp}
        ref={dialogRef}
        style={dragHandlers.style}
      >
        {isMinimized ? (
          <MetronomeCore
            controller={controller}
            onClose={onClose}
            onExpand={() => setIsMinimized(false)}
            variant="compact"
          />
        ) : (
          <section
            aria-label="木鱼节拍器"
            aria-modal="true"
            className="metronome-dialog"
            role="dialog"
          >
            <MetronomeCore
              controller={controller}
              onClose={onClose}
              onMinimize={minimize}
              variant="panel"
            />
          </section>
        )}
      </div>
    </>
  );
}
