interface PracticeMicrophoneRetryButtonProps {
  isConnecting: boolean;
  isPreparingModel?: boolean;
  onRetry: () => unknown | Promise<unknown>;
  className?: string;
}

export function PracticeMicrophoneRetryButton({
  isConnecting,
  isPreparingModel = false,
  onRetry,
  className,
}: PracticeMicrophoneRetryButtonProps): JSX.Element {
  const classes = ["practice-microphone-retry-button", className].filter(Boolean).join(" ");

  return (
    <button
      aria-busy={isConnecting || isPreparingModel || undefined}
      className={classes}
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
      {isPreparingModel ? "准备识别模型…" : isConnecting ? "正在连接…" : "重试连接"}
    </button>
  );
}
