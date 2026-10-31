import { LoadingActivityText } from "./LoadingActivity";

interface PracticeMicrophoneRetryButtonProps {
  isConnecting: boolean;
  isPreparingModel?: boolean;
  onRetry: () => unknown | Promise<unknown>;
  className?: string;
  setupGuideTarget?: string;
}

export function PracticeMicrophoneRetryButton({
  isConnecting,
  isPreparingModel = false,
  onRetry,
  className,
  setupGuideTarget,
}: PracticeMicrophoneRetryButtonProps): JSX.Element {
  const classes = ["practice-microphone-retry-button", className].filter(Boolean).join(" ");

  return (
    <button
      aria-busy={isConnecting || isPreparingModel || undefined}
      className={classes}
      data-setup-guide-target={setupGuideTarget}
      disabled={isConnecting || isPreparingModel}
      onClick={() => {
        void (async () => {
          try {
            await onRetry();
          } catch {
            // The microphone hook exposes the failure message in its status.
          }
        })();
      }}
      type="button"
    >
      {isPreparingModel ? (
        <LoadingActivityText kind="dots">准备识别模型</LoadingActivityText>
      ) : isConnecting ? (
        <LoadingActivityText kind="dots">正在连接</LoadingActivityText>
      ) : (
        "重试连接"
      )}
    </button>
  );
}
