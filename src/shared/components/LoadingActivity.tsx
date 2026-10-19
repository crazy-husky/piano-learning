import type { ReactNode } from "react";

export type LoadingActivityKind = "dots" | "spinner";

interface LoadingActivityIndicatorProps {
  kind: LoadingActivityKind;
  size?: "compact" | "prominent";
}

interface LoadingActivityTextProps extends LoadingActivityIndicatorProps {
  children: ReactNode;
}

export function LoadingActivityIndicator({
  kind,
  size = "compact",
}: LoadingActivityIndicatorProps): JSX.Element {
  const className = `loading-activity-indicator loading-activity-indicator--${kind} loading-activity-indicator--${size}`;

  if (kind === "spinner") {
    return <span aria-hidden="true" className={className} />;
  }

  return (
    <span aria-hidden="true" className={className}>
      <i className="loading-activity-dot" />
      <i className="loading-activity-dot" />
      <i className="loading-activity-dot" />
    </span>
  );
}

export function LoadingActivityText({
  children,
  kind,
  size = "compact",
}: LoadingActivityTextProps): JSX.Element {
  return (
    <span className={`loading-activity-text loading-activity-text--${kind}`}>
      {kind === "spinner" ? <LoadingActivityIndicator kind={kind} size={size} /> : null}
      <span>{children}</span>
      {kind === "dots" ? <LoadingActivityIndicator kind={kind} size={size} /> : null}
    </span>
  );
}
