import { useEffect, useState } from "react";

const PHYSICAL_INPUT_NOTICE = "实体钢琴模式通过麦克风识别音高，背景音乐会自动关闭；答题反馈音效仍由「音效」设置控制。请确保乐器音准正常。";
const PHYSICAL_INPUT_NOTICE_CHARACTERS = Array.from(PHYSICAL_INPUT_NOTICE);
const TYPEWRITER_DURATION_MS = 1_500;

export function StaffGamePhysicalInputNotice() {
  const [visibleCharacterCount, setVisibleCharacterCount] = useState(1);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisibleCharacterCount(PHYSICAL_INPUT_NOTICE_CHARACTERS.length);
      return;
    }

    const startedAt = performance.now();
    const timerId = window.setInterval(() => {
      const progress = Math.min(1, (performance.now() - startedAt) / TYPEWRITER_DURATION_MS);
      const nextCharacterCount = Math.min(
        PHYSICAL_INPUT_NOTICE_CHARACTERS.length,
        1 + Math.floor(progress * (PHYSICAL_INPUT_NOTICE_CHARACTERS.length - 1)),
      );
      setVisibleCharacterCount(nextCharacterCount);

      if (progress >= 1) {
        window.clearInterval(timerId);
      }
    }, 20);

    return () => window.clearInterval(timerId);
  }, []);

  return (
    <p
      aria-label={PHYSICAL_INPUT_NOTICE}
      className="staff-game-physical-input-notice"
      role="note"
    >
      {PHYSICAL_INPUT_NOTICE_CHARACTERS.slice(0, visibleCharacterCount).join("")}
    </p>
  );
}
