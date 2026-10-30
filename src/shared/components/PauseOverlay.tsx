import { RotateCcw } from "lucide-react";
import { PracticeMicrophoneRetryButton } from "./PracticeMicrophoneRetryButton";

interface PauseOverlayProps {
  onExit?: () => void;
  onResume: () => void;
  onRestart?: () => void;
  allowBackdropResume?: boolean;
  resumeBlockedMessage?: string;
  resumeMessage?: string;
  recoveryReloadAvailable?: boolean;
  onReloadAfterRecoveryFailure?: () => void;
  microphoneError?: string | null;
  microphoneConnecting?: boolean;
  microphoneIsPreparingModel?: boolean;
  onRetryMicrophone?: () => unknown | Promise<unknown>;
  showKeyboardShortcuts?: boolean;
}

export function PauseOverlay({
  onExit,
  onResume,
  onRestart,
  allowBackdropResume = true,
  resumeBlockedMessage,
  resumeMessage,
  recoveryReloadAvailable = false,
  onReloadAfterRecoveryFailure,
  microphoneError,
  microphoneConnecting = false,
  microphoneIsPreparingModel = false,
  onRetryMicrophone,
  showKeyboardShortcuts = true,
}: PauseOverlayProps): JSX.Element {
  return (
    <div aria-label="练习已暂停" aria-modal="true" className="pause-overlay" role="dialog">
      {allowBackdropResume ? (
        <button
          aria-label="点击空白处继续练习"
          className="pause-overlay-backdrop"
          disabled={Boolean(resumeBlockedMessage)}
          onClick={onResume}
          type="button"
        />
      ) : (
        <div aria-hidden="true" className="pause-overlay-backdrop" />
      )}
      <div className="pause-overlay-content">
        <span>已暂停</span>
        {(microphoneError || microphoneConnecting) && onRetryMicrophone ? (
          <div aria-live="polite" className="practice-microphone-error-actions">
            <span>
              {microphoneIsPreparingModel
                ? "正在准备识别模型…"
                : (microphoneError ?? "正在连接麦克风…")}
            </span>
            <PracticeMicrophoneRetryButton
              isConnecting={microphoneConnecting}
              isPreparingModel={microphoneIsPreparingModel}
              onRetry={onRetryMicrophone}
            />
          </div>
        ) : null}
        {showKeyboardShortcuts ? (
          <small>{resumeBlockedMessage ?? resumeMessage ?? "按空格或点击空白处继续练习"}</small>
        ) : null}
        {showKeyboardShortcuts && onRestart ? (
          <button className="pause-overlay-restart" onClick={onRestart} type="button">
            <RotateCcw aria-hidden="true" size={17} />
            重新开始
          </button>
        ) : null}
        {!showKeyboardShortcuts ? (
          <div className="pause-overlay-touch-actions">
            {onExit ? (
              <button className="pause-overlay-exit" onClick={onExit} type="button">
                退出练习
              </button>
            ) : null}
            {onRestart ? (
              <button className="pause-overlay-restart" onClick={onRestart} type="button">
                <RotateCcw aria-hidden="true" size={17} />
                重新开始
              </button>
            ) : null}
            <button
              className="pause-overlay-resume"
              disabled={Boolean(resumeBlockedMessage)}
              onClick={onResume}
              type="button"
            >
              继续练习
            </button>
          </div>
        ) : null}
        {showKeyboardShortcuts && recoveryReloadAvailable && onReloadAfterRecoveryFailure ? (
          <button
            className="practice-microphone-recovery-reload"
            onClick={onReloadAfterRecoveryFailure}
            type="button"
          >
            刷新页面重试
          </button>
        ) : null}
        {!showKeyboardShortcuts && recoveryReloadAvailable && onReloadAfterRecoveryFailure ? (
          <button
            className="practice-microphone-recovery-reload"
            onClick={onReloadAfterRecoveryFailure}
            type="button"
          >
            刷新页面重试
          </button>
        ) : null}
      </div>
    </div>
  );
}
