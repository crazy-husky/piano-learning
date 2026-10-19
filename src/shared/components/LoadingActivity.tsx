import type { ReactNode } from "react";

export type LoadingActivityKind = "music" | "spinner";

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
    <svg aria-hidden="true" className={className} focusable="false" viewBox="0 0 64 36">
      <path className="loading-activity-staff" d="M2 5h60M2 11.5h60M2 18h60M2 24.5h60M2 31h60" />
      <g className="loading-activity-note loading-activity-note--first">
        <ellipse cx="15" cy="27" rx="5.4" ry="3.6" />
        <path d="M20 27V11" />
      </g>
      <g className="loading-activity-note loading-activity-note--second">
        <ellipse cx="32" cy="20.5" rx="5.4" ry="3.6" />
        <path d="M37 20.5V8" />
      </g>
      <g className="loading-activity-note loading-activity-note--third">
        <ellipse cx="49" cy="14" rx="5.4" ry="3.6" />
        <path d="M54 14V4" />
      </g>
    </svg>
  );
}

export function LoadingActivityText({
  children,
  kind,
  size = "compact",
}: LoadingActivityTextProps): JSX.Element {
  return (
    <span className="loading-activity-text">
      <LoadingActivityIndicator kind={kind} size={size} />
      <span>{children}</span>
    </span>
  );
}
