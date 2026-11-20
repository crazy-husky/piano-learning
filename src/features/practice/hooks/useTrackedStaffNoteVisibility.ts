import { useCallback, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import { toast } from "sonner";

interface UseTrackedStaffNoteVisibilityOptions {
  enabled: boolean;
  noteKey: string | number;
  toastId: string;
  onHidden?: () => void;
  hiddenMessage?: string;
  visibleMessage?: string;
  notifyOnVisibilityChange?: boolean;
  visibilityRef?: MutableRefObject<boolean>;
}

export function useTrackedStaffNoteVisibility({
  enabled,
  noteKey,
  toastId,
  onHidden,
  hiddenMessage = "当前音符已滚出视野，输入已暂停。",
  visibleMessage = "当前音符已回到视野，可以继续弹奏。",
  notifyOnVisibilityChange = true,
  visibilityRef: externalVisibilityRef,
}: UseTrackedStaffNoteVisibilityOptions): {
  isVisible: boolean;
  visibilityRef: MutableRefObject<boolean>;
  onVisibilityChange: (isVisible: boolean) => void;
  resetVisibility: () => void;
} {
  const [isVisible, setIsVisible] = useState(true);
  const localVisibilityRef = useRef(true);
  const visibilityRef = externalVisibilityRef ?? localVisibilityRef;

  const resetVisibility = useCallback((): void => {
    visibilityRef.current = true;
    setIsVisible(true);
  }, [visibilityRef]);

  useLayoutEffect(() => {
    resetVisibility();
  }, [enabled, noteKey, resetVisibility]);

  const onVisibilityChange = useCallback(
    (nextIsVisible: boolean): void => {
      if (!enabled) {
        visibilityRef.current = true;
        setIsVisible(true);
        return;
      }
      if (visibilityRef.current === nextIsVisible) return;

      visibilityRef.current = nextIsVisible;
      setIsVisible(nextIsVisible);
      if (!nextIsVisible) onHidden?.();
      if (notifyOnVisibilityChange) {
        toast.message(nextIsVisible ? visibleMessage : hiddenMessage, {
          id: toastId,
          duration: 2000,
        });
      }
    },
    [
      enabled,
      hiddenMessage,
      notifyOnVisibilityChange,
      onHidden,
      toastId,
      visibilityRef,
      visibleMessage,
    ]
  );

  return { isVisible, visibilityRef, onVisibilityChange, resetVisibility };
}
