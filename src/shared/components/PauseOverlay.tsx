import { Play } from "lucide-react";
import { PracticeMicrophoneRetryButton } from "./PracticeMicrophoneRetryButton";
import { LoadingActivityText } from "./LoadingActivity";

interface PauseOverlayProps {
  onResume: () => void;
  allowBackdropResume?: boolean;
  resumeDisabled?: boolean;
  resumeBlockedMessage?: string;
  resumeMessage?: string;
  statusMessage?: string;
  recoveryReloadAvailable?: boolean;
  onReloadAfterRecoveryFailure?: () => void;
  microphoneError?: string | null;
  microphoneConnecting?: boolean;
  microphoneIsPreparingModel?: boolean;
  onRetryMicrophone?: () => unknown | Promise<unknown>;
  showKeyboardShortcuts?: boolean;
}

export function PauseOverlay({
  onResume,
  allowBackdropResume = true,
  resumeDisabled = false,
  resumeBlockedMessage,
  resumeMessage,
  statusMessage,
  recoveryReloadAvailable = false,
  onReloadAfterRecoveryFailure,
  microphoneError,
  microphoneConnecting = false,
  microphoneIsPreparingModel = false,
  onRetryMicrophone,
  showKeyboardShortcuts = true,
}: PauseOverlayProps): JSX.Element {
  const isResumeDisabled = resumeDisabled || Boolean(resumeBlockedMessage);

  return (
    <div aria-label="练习已暂停" aria-modal="true" className="pause-overlay" role="dialog">
      {allowBackdropResume ? (
        <button
          aria-label="点击空白处继续练习"
          className="pause-overlay-backdrop"
          disabled={isResumeDisabled}
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
              {microphoneIsPreparingModel ? (
                <LoadingActivityText kind="dots">正在准备识别模型</LoadingActivityText>
              ) : microphoneConnecting ? (
                <LoadingActivityText kind="dots">正在连接麦克风</LoadingActivityText>
              ) : (
                microphoneError
              )}
            </span>
            <PracticeMicrophoneRetryButton
              isConnecting={microphoneConnecting}
              isPreparingModel={microphoneIsPreparingModel}
              onRetry={onRetryMicrophone}
            />
          </div>
        ) : null}
        {statusMessage ? <small>{statusMessage}</small> : null}
        {showKeyboardShortcuts ? (
          <small>
            {resumeBlockedMessage ??
              (resumeMessage?.includes("正在") ? (
                <LoadingActivityText kind="dots">
                  {resumeMessage.replace(/…$/, "")}
                </LoadingActivityText>
              ) : (
                (resumeMessage ?? "按空格或点击空白处继续练习")
              ))}
          </small>
        ) : null}
        <button
          className="primary pause-overlay-resume"
          disabled={isResumeDisabled}
          onClick={onResume}
          type="button"
        >
          <Play aria-hidden="true" size={17} />
          继续练习
        </button>
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
