import { useEffect, useState } from "react";
import {
  readPracticeViewportSize,
  type PracticeViewportSize,
} from "./staffDistanceFingerKeyboardLayout";

export function usePracticeViewportSize(): PracticeViewportSize {
  const [size, setSize] = useState(readPracticeViewportSize);

  useEffect(() => {
    const update = (): void => setSize(readPracticeViewportSize());
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);

  return size;
}
