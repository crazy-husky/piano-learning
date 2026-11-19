import type { ReactNode } from "react";

interface PracticeSetupFrameProps {
  "aria-label"?: string;
  as?: "div" | "section";
  children: ReactNode;
  className?: string;
}

/** Shared visual frame for a learning-module configuration card. */
export function PracticeSetupFrame({
  "aria-label": ariaLabel,
  as = "div",
  children,
  className = "",
}: PracticeSetupFrameProps): JSX.Element {
  const classes = ["practice-setup-framed-page", className].filter(Boolean).join(" ");

  if (as === "section") {
    return (
      <section aria-label={ariaLabel} className={classes}>
        {children}
      </section>
    );
  }

  return (
    <div aria-label={ariaLabel} className={classes}>
      {children}
    </div>
  );
}
