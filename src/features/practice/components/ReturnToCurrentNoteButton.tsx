import { ArrowDown, ArrowUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { requestStaffPageManualScroll, scrollStaffPageTargetIntoView } from "./staffPageScroll";

interface ReturnToCurrentNoteButtonProps {
  getTarget: () => Element | null;
}

export function ReturnToCurrentNoteButton({
  getTarget,
}: ReturnToCurrentNoteButtonProps): JSX.Element {
  const [isStable, setIsStable] = useState(false);
  const [arrowDirection, setArrowDirection] = useState<"down" | "up">("up");
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setIsStable(true), 350);
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    const updateArrowDirection = (): void => {
      const targetBounds = getTarget()?.getBoundingClientRect();
      const buttonBounds = buttonRef.current?.getBoundingClientRect();
      if (!targetBounds || !buttonBounds) return;
      const targetCenter = (targetBounds.top + targetBounds.bottom) / 2;
      const buttonCenter = (buttonBounds.top + buttonBounds.bottom) / 2;
      setArrowDirection(targetCenter > buttonCenter ? "down" : "up");
    };

    updateArrowDirection();
    window.addEventListener("scroll", updateArrowDirection, true);
    window.addEventListener("resize", updateArrowDirection);
    return () => {
      window.removeEventListener("scroll", updateArrowDirection, true);
      window.removeEventListener("resize", updateArrowDirection);
    };
  }, [getTarget, isStable]);

  if (!isStable) return <></>;

  return (
    <button
      aria-label="返回当前音符"
      className="practice-return-current-note"
      ref={buttonRef}
      onClick={() => {
        requestStaffPageManualScroll();
        const target = getTarget();
        if (target) {
          scrollStaffPageTargetIntoView(target);
          return;
        }
        window.requestAnimationFrame(() => {
          const renderedTarget = getTarget();
          if (renderedTarget) scrollStaffPageTargetIntoView(renderedTarget);
        });
      }}
      type="button"
    >
      {arrowDirection === "down" ? (
        <ArrowDown aria-hidden="true" size={19} />
      ) : (
        <ArrowUp aria-hidden="true" size={19} />
      )}
    </button>
  );
}
