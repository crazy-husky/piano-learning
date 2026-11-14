const TEXT_INPUT_TYPES = new Set([
  "date",
  "datetime-local",
  "email",
  "month",
  "number",
  "password",
  "search",
  "tel",
  "time",
  "text",
  "url",
  "week",
]);
const SCROLLABLE_OVERFLOW = /(auto|scroll|overlay|hidden)/;
const INPUT_SAFE_INSET_PX = 18;

function isTextEntryTarget(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement) || target.matches(":disabled")) return false;
  if (target instanceof HTMLTextAreaElement) return !target.readOnly;
  if (target instanceof HTMLInputElement) {
    return !target.readOnly && TEXT_INPUT_TYPES.has(target.type.toLowerCase());
  }
  return target.isContentEditable;
}

function supportsTouchInput(): boolean {
  return navigator.maxTouchPoints > 0 || window.matchMedia?.("(pointer: coarse)").matches === true;
}

function scrollFocusedInputBy(target: HTMLElement, delta: number): void {
  let remaining = delta;
  let ancestor = target.parentElement;

  while (ancestor && ancestor !== document.body && Math.abs(remaining) > 1) {
    const style = window.getComputedStyle(ancestor);
    if (
      SCROLLABLE_OVERFLOW.test(style.overflowY) &&
      ancestor.scrollHeight > ancestor.clientHeight + 1
    ) {
      const maximum = Math.max(0, ancestor.scrollHeight - ancestor.clientHeight);
      const previous = ancestor.scrollTop;
      const next = Math.min(maximum, Math.max(0, previous + remaining));
      ancestor.scrollTop = next;
      remaining -= next - previous;
    }
    ancestor = ancestor.parentElement;
  }

  const scrollingElement = document.scrollingElement;
  if (scrollingElement && Math.abs(remaining) > 1) {
    const maximum = Math.max(0, scrollingElement.scrollHeight - scrollingElement.clientHeight);
    const previous = scrollingElement.scrollTop;
    const next = Math.min(maximum, Math.max(0, previous + remaining));
    scrollingElement.scrollTop = next;
    remaining -= next - previous;
  }

  if (Math.abs(remaining) > 1) window.scrollBy(0, remaining);
}

/** Keep the focused text field above the on-screen keyboard on touch devices. */
export function installMobileTextInputAutoScroll(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined" || !supportsTouchInput()) {
    return () => undefined;
  }

  let animationFrame = 0;
  let resizeTimer = 0;
  let focusedTarget: HTMLElement | null = null;
  const retryTimers = new Set<number>();
  const clearRetryTimers = (): void => {
    retryTimers.forEach((timer) => window.clearTimeout(timer));
    retryTimers.clear();
  };

  const ensureFocusedInputVisible = (): void => {
    animationFrame = 0;
    const target = focusedTarget;
    if (!target?.isConnected || document.activeElement !== target) return;

    const viewport = window.visualViewport;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
    const visibleTop = viewportTop + INPUT_SAFE_INSET_PX;
    const visibleBottom = viewportBottom - INPUT_SAFE_INSET_PX;
    const bounds = target.getBoundingClientRect();
    const availableHeight = visibleBottom - visibleTop;
    let delta = 0;

    if (bounds.height > availableHeight) {
      // Keep the lower edge visible so a textarea's newest text and caret stay
      // above the keyboard when the whole field cannot fit in the visual viewport.
      delta = bounds.bottom - visibleBottom;
    } else if (bounds.bottom > visibleBottom) {
      delta = bounds.bottom - visibleBottom;
    } else if (bounds.top < visibleTop) {
      delta = bounds.top - visibleTop;
    }

    if (Math.abs(delta) > 1) scrollFocusedInputBy(target, delta);
  };

  const scheduleVisibilityCheck = (): void => {
    if (animationFrame !== 0) return;
    animationFrame = window.requestAnimationFrame(ensureFocusedInputVisible);
  };

  const onFocusIn = (event: FocusEvent): void => {
    clearRetryTimers();
    if (!isTextEntryTarget(event.target)) {
      focusedTarget = null;
      return;
    }

    focusedTarget = event.target;
    for (const delay of [90, 240, 460]) {
      const timer = window.setTimeout(() => {
        retryTimers.delete(timer);
        scheduleVisibilityCheck();
      }, delay);
      retryTimers.add(timer);
    }
  };

  const onFocusOut = (): void => {
    window.setTimeout(() => {
      if (!isTextEntryTarget(document.activeElement)) {
        focusedTarget = null;
        clearRetryTimers();
      }
    }, 0);
  };

  const onViewportChange = (): void => {
    if (!focusedTarget) return;
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(scheduleVisibilityCheck, 80);
  };

  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  window.visualViewport?.addEventListener("resize", onViewportChange);
  window.visualViewport?.addEventListener("scroll", onViewportChange);
  window.addEventListener("resize", onViewportChange);

  return () => {
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("focusout", onFocusOut);
    window.visualViewport?.removeEventListener("resize", onViewportChange);
    window.visualViewport?.removeEventListener("scroll", onViewportChange);
    window.removeEventListener("resize", onViewportChange);
    window.clearTimeout(resizeTimer);
    clearRetryTimers();
    if (animationFrame !== 0) window.cancelAnimationFrame(animationFrame);
  };
}
