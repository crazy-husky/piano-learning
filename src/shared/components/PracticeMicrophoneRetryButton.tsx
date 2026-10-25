interface PracticeMicrophoneRetryButtonProps {
  isConnecting: boolean;
  onRetry: () => unknown | Promise<unknown>;
  className?: string;
}

export function PracticeMicrophoneRetryButton({
  isConnecting,
  onRetry,
  className,
}: PracticeMicrophoneRetryButtonProps): JSX.Element {
  const classes = ["practice-microphone-retry-button", className].filter(Boolean).join(" ");

  return (
    <button
      aria-busy={isConnecting || undefined}
      className={classes}
      disabled={isConnecting}
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
      {isConnecting ? "正在连接…" : "重试连接"}
    </button>
  );
}
