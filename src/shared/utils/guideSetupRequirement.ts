export const SETUP_REQUIREMENT_GUIDE_EVENT = "piano-learning:show-setup-requirement-guide";

export interface SetupRequirementGuideDetail {
  target: HTMLElement;
  warning: HTMLElement;
}

interface PendingGuide {
  cancel: () => void;
}

let activeGuidanceTarget: HTMLElement | null = null;
let activeGuidanceTimer: number | null = null;
let activePendingGuide: PendingGuide | null = null;

function isElementVisible(element: HTMLElement): boolean {
  const bounds = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return (
    bounds.width > 0 &&
    bounds.height > 0 &&
    bounds.right > 0 &&
    bounds.left < window.innerWidth &&
    bounds.bottom > 0 &&
    bounds.top < window.innerHeight &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number(style.opacity) > 0
  );
}

function isTargetVisible(element: HTMLElement): boolean {
  if (!isElementVisible(element)) return false;

  const bounds = element.getBoundingClientRect();
  const centerX = bounds.left + bounds.width / 2;
  const centerY = bounds.top + bounds.height / 2;
  if (
    centerX < 0 ||
    centerX > window.innerWidth ||
    centerY < 24 ||
    centerY > window.innerHeight - 112
  ) {
    return false;
  }

  let ancestor = element.parentElement;
  while (ancestor && ancestor !== document.body) {
    const style = window.getComputedStyle(ancestor);
    const ancestorBounds = ancestor.getBoundingClientRect();
    if (
      /(auto|scroll|overlay|hidden)/.test(style.overflowY) &&
      (centerY < ancestorBounds.top || centerY > ancestorBounds.bottom)
    ) {
      return false;
    }
    if (
      /(auto|scroll|overlay|hidden)/.test(style.overflowX) &&
      (centerX < ancestorBounds.left || centerX > ancestorBounds.right)
    ) {
      return false;
    }
    ancestor = ancestor.parentElement;
  }

  return true;
}

function getBounds(element: HTMLElement): Pick<DOMRect, "bottom" | "left" | "right" | "top"> {
  const { bottom, left, right, top } = element.getBoundingClientRect();
  return { bottom, left, right, top };
}

function haveStableBounds(
  current: Pick<DOMRect, "bottom" | "left" | "right" | "top">,
  previous: Pick<DOMRect, "bottom" | "left" | "right" | "top"> | null
): boolean {
  return (
    previous !== null &&
    Math.abs(current.top - previous.top) < 0.5 &&
    Math.abs(current.right - previous.right) < 0.5 &&
    Math.abs(current.bottom - previous.bottom) < 0.5 &&
    Math.abs(current.left - previous.left) < 0.5
  );
}

function scrollTargetIntoView(target: HTMLElement): boolean {
  const bounds = target.getBoundingClientRect();
  let clippedByScrollContainer = false;
  let ancestor = target.parentElement;
  while (ancestor && ancestor !== document.body) {
    const overflowY = window.getComputedStyle(ancestor).overflowY;
    if (/(auto|scroll|overlay|hidden)/.test(overflowY)) {
      const ancestorBounds = ancestor.getBoundingClientRect();
      if (bounds.top < ancestorBounds.top || bounds.bottom > ancestorBounds.bottom) {
        clippedByScrollContainer = true;
        break;
      }
    }
    ancestor = ancestor.parentElement;
  }

  const hiddenBehindDock = bounds.bottom > window.innerHeight - 112;
  const shouldScroll = clippedByScrollContainer || bounds.top < 24 || hiddenBehindDock;
  if (shouldScroll) {
    target.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "center",
      inline: "nearest",
    });
  }
  return shouldScroll;
}

/** Scroll a blocked setup requirement into view, pulse it, and point to it from the warning. */
export function guideSetupRequirement(
  selector: string,
  options: { highlight?: boolean; warningSelector?: string } = {}
): void {
  if (typeof document === "undefined" || typeof window === "undefined") return;

  activePendingGuide?.cancel();
  activePendingGuide = null;
  if (activeGuidanceTimer !== null) window.clearTimeout(activeGuidanceTimer);
  activeGuidanceTarget?.classList.remove("is-setup-guiding");
  activeGuidanceTarget = null;
  activeGuidanceTimer = null;

  const target = document.querySelector<HTMLElement>(selector);
  if (!target || target.closest("[hidden]")) return;

  scrollTargetIntoView(target);

  if (options.highlight !== false) {
    target.classList.remove("is-setup-guiding");
    void target.offsetWidth;
    target.classList.add("is-setup-guiding");
    activeGuidanceTarget = target;
    activeGuidanceTimer = window.setTimeout(() => {
      if (activeGuidanceTarget === target) {
        target.classList.remove("is-setup-guiding");
        activeGuidanceTarget = null;
        activeGuidanceTimer = null;
      }
    }, 1_950);
  }

  let frameId: number | undefined;
  let attempts = 0;
  let stableFrames = 0;
  let previousTargetBounds: Pick<DOMRect, "bottom" | "left" | "right" | "top"> | null = null;
  let previousWarningBounds: Pick<DOMRect, "bottom" | "left" | "right" | "top"> | null = null;

  const finish = (): void => {
    if (frameId !== undefined) window.cancelAnimationFrame(frameId);
    document.removeEventListener("visibilitychange", cancelWhenHidden);
    if (activePendingGuide?.cancel === finish) activePendingGuide = null;
  };

  const cancelWhenHidden = (): void => {
    if (document.visibilityState !== "visible") finish();
  };

  const checkVisibility = (): void => {
    frameId = undefined;
    if (!target.isConnected || document.visibilityState !== "visible") {
      finish();
      return;
    }

    const warning = Array.from(
      document.querySelectorAll<HTMLElement>(
        options.warningSelector ?? "[data-setup-guide-warning]"
      )
    ).find((candidate) => candidate.isConnected && isElementVisible(candidate));
    if (warning && isTargetVisible(target)) {
      const targetBounds = getBounds(target);
      const warningBounds = getBounds(warning);
      const isStable =
        haveStableBounds(targetBounds, previousTargetBounds) &&
        haveStableBounds(warningBounds, previousWarningBounds);
      stableFrames = isStable ? stableFrames + 1 : 0;
      previousTargetBounds = targetBounds;
      previousWarningBounds = warningBounds;

      if (stableFrames >= 8) {
        window.dispatchEvent(
          new CustomEvent<SetupRequirementGuideDetail>(SETUP_REQUIREMENT_GUIDE_EVENT, {
            detail: { target, warning },
          })
        );
        finish();
        return;
      }
    } else {
      previousTargetBounds = null;
      previousWarningBounds = null;
      stableFrames = 0;
    }

    if (attempts >= 600) {
      finish();
      return;
    }
    attempts += 1;
    frameId = window.requestAnimationFrame(checkVisibility);
  };

  document.addEventListener("visibilitychange", cancelWhenHidden);
  frameId = window.requestAnimationFrame(checkVisibility);
  activePendingGuide = { cancel: finish };
}
