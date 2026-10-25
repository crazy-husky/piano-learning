import { PracticeMicrophoneRetryButton } from "./PracticeMicrophoneRetryButton";

interface PauseOverlayProps {
  onExit?: () => void;
  onResume: () => void;
  allowBackdropResume?: boolean;
  resumeBlockedMessage?: string;
  resumeMessage?: string;
  recoveryReloadAvailable?: boolean;
  onReloadAfterRecoveryFailure?: () => void;
  microphoneError?: string | null;
  microphoneConnecting?: boolean;
  onRetryMicrophone?: () => unknown | Promise<unknown>;
  showKeyboardShortcuts?: boolean;
}

export function PauseOverlay({
  onExit,
  onResume,
  allowBackdropResume = true,
  resumeBlockedMessage,
  resumeMessage,
  recoveryReloadAvailable = false,
  onReloadAfterRecoveryFailure,
  microphoneError,
  microphoneConnecting = false,
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
            <span>{microphoneError ?? "正在连接麦克风…"}</span>
            <PracticeMicrophoneRetryButton
              isConnecting={microphoneConnecting}
              onRetry={onRetryMicrophone}
            />
          </div>
        ) : null}
        {showKeyboardShortcuts ? (
          <small>
            {resumeBlockedMessage ??
              resumeMessage ??
              "按空格或点击空白处继续练习 · 按 Esc 退出练习"}
          </small>
        ) : null}
        {!showKeyboardShortcuts ? (
          <div className="pause-overlay-touch-actions">
            {onExit ? (
              <button className="pause-overlay-exit" onClick={onExit} type="button">
                退出练习
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
