import { ArrowLeft, Pause, RotateCcw } from "lucide-react";
import { forwardRef, type ReactNode } from "react";

export function formatPracticeQuestionProgress(
  completedCount: number,
  fixedCount?: number
): string {
  const completed = Number.isFinite(completedCount) ? Math.max(0, Math.floor(completedCount)) : 0;
  const total =
    typeof fixedCount === "number" && Number.isFinite(fixedCount)
      ? Math.max(0, Math.floor(fixedCount))
      : "无限";
  return `${completed} / ${total} 题`;
}

interface PracticeSessionFrameProps {
  "aria-label"?: string;
  children: ReactNode;
  className?: string;
}

export const PracticeSessionFrame = forwardRef<HTMLElement, PracticeSessionFrameProps>(
  function PracticeSessionFrame({ "aria-label": ariaLabel, children, className = "" }, ref) {
    return (
      <section
        ref={ref}
        aria-label={ariaLabel}
        className={["practice-shell", "practice-session-frame", className]
          .filter(Boolean)
          .join(" ")}
      >
        {children}
      </section>
    );
  }
);

interface PracticeSessionHeaderProps {
  children?: ReactNode;
  exitAriaLabel?: string;
  exitLabel?: string;
  onExit: () => void;
  onPauseToggle: () => void;
  onRestart?: () => void;
  pauseTitle?: string;
  progress: ReactNode;
  isPaused: boolean;
  isRestarting?: boolean;
  showPauseAction?: boolean;
  title?: ReactNode;
  progressInline?: boolean;
  utilityChildren?: ReactNode;
}

export function PracticeSessionHeader({
  children,
  exitAriaLabel,
  exitLabel = "结束返回",
  onExit,
  onPauseToggle,
  onRestart,
  pauseTitle,
  progress,
  isPaused,
  isRestarting = false,
  showPauseAction = true,
  title,
  progressInline = false,
  utilityChildren,
}: PracticeSessionHeaderProps): JSX.Element {
  const accessibleExitLabel = exitAriaLabel ?? exitLabel;

  return (
    <header className="practice-topline practice-session-header">
      <div className={`practice-session-heading${progressInline ? " has-inline-progress" : ""}`}>
        {title ? <h1 className="practice-session-title">{title}</h1> : null}
        <div className="practice-session-progress">
          {progressInline ? <>({progress})</> : progress}
        </div>
      </div>
      <div className="practice-session-controls">
        {utilityChildren ? (
          <div className="practice-session-utilities">{utilityChildren}</div>
        ) : null}
        <div className="topline-actions practice-session-actions">
          <div className="practice-run-core-actions">
            <button
              aria-label={accessibleExitLabel}
              className="practice-return-home"
              onClick={onExit}
              title={accessibleExitLabel}
              type="button"
            >
              <ArrowLeft aria-hidden="true" size={18} />
              {exitLabel}
            </button>
            {showPauseAction && !isPaused ? (
              <button
                aria-label="暂停练习"
                onClick={onPauseToggle}
                title={pauseTitle ?? "暂停"}
                type="button"
              >
                <Pause aria-hidden="true" size={18} />
                暂停
              </button>
            ) : null}
            {onRestart && !isPaused ? (
              <button
                aria-label="重新开始当前练习"
                disabled={isRestarting}
                onClick={onRestart}
                title="重新开始当前练习"
                type="button"
              >
                <RotateCcw aria-hidden="true" size={18} />
                重新开始
              </button>
            ) : null}
          </div>
          {children ? <div className="practice-session-extra-actions">{children}</div> : null}
        </div>
      </div>
    </header>
  );
}
