import { CircleHelp } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

interface DismissibleHelpPopoverProps {
  ariaLabel: string;
  children: ReactNode;
  className: string;
}

export function DismissibleHelpPopover({
  ariaLabel,
  children,
  className,
}: DismissibleHelpPopoverProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();

  useEffect(() => {
    if (!isOpen) return;

    const dismissIfOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !popoverRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    };
    const dismiss = (): void => setIsOpen(false);
    const dismissOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") dismiss();
    };

    document.addEventListener("pointerdown", dismissIfOutside);
    document.addEventListener("keydown", dismissOnEscape);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismissIfOutside);
      document.removeEventListener("keydown", dismissOnEscape);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [isOpen]);

  return (
    <div className={`staff-distance-help-popover ${className}`} ref={popoverRef}>
      <button
        aria-controls={tooltipId}
        aria-describedby={isOpen ? tooltipId : undefined}
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        className="staff-distance-help-trigger"
        onClick={() => setIsOpen((open) => !open)}
        type="button"
      >
        <CircleHelp aria-hidden="true" size={16} />
      </button>
      {isOpen ? (
        <span className="staff-distance-help-tooltip" id={tooltipId} role="tooltip">
          {children}
        </span>
      ) : null}
    </div>
  );
}
