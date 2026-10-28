import { useEffect, useRef } from "react";
import { MAX_PRACTICE_QUESTIONS } from "../../domain/practiceLimits";

interface PracticeQuestionLimitDialogProps {
  onEnd: () => void;
}

export function PracticeQuestionLimitDialog({
  onEnd,
}: PracticeQuestionLimitDialogProps): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const endButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    if (!dialog.open) dialog.showModal();
    endButtonRef.current?.focus({ preventScroll: true });
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      aria-labelledby="practice-question-limit-title"
      className="practice-question-limit-overlay"
      onCancel={(event) => event.preventDefault()}
      ref={dialogRef}
    >
      <div className="practice-question-limit-dialog">
        <h2 id="practice-question-limit-title">题量过多，练习已暂停</h2>
        <p>
          单次练习最多 {MAX_PRACTICE_QUESTIONS}{" "}
          题。为避免页面运行过载，已停止出题；点击结束返回练习配置。
        </p>
        <button className="primary" onClick={onEnd} ref={endButtonRef} type="button">
          结束
        </button>
      </div>
    </dialog>
  );
}
