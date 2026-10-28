export const STAFF_PAGE_MANUAL_SCROLL_EVENT = "piano-learning:staff-page-manual-scroll";

export function requestStaffPageManualScroll(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(STAFF_PAGE_MANUAL_SCROLL_EVENT));
  }
}

export function scrollStaffPageTargetIntoView(target: Element): void {
  const scrollContainer = (() => {
    for (
      let ancestor = target.parentElement;
      ancestor && ancestor !== document.body;
      ancestor = ancestor.parentElement
    ) {
      const style = window.getComputedStyle(ancestor);
      if (
        ["auto", "scroll", "overlay"].includes(style.overflowY) &&
        ancestor.scrollHeight > ancestor.clientHeight
      ) {
        return ancestor;
      }
    }
    return null;
  })();
  const targetBounds = target.getBoundingClientRect();
  const viewportTop = scrollContainer
    ? scrollContainer.getBoundingClientRect().top + scrollContainer.clientTop
    : 0;
  const viewportHeight = scrollContainer ? scrollContainer.clientHeight : window.innerHeight;
  const targetCenter = (targetBounds.top + targetBounds.bottom) / 2;
  const currentScrollTop = scrollContainer ? scrollContainer.scrollTop : window.scrollY;
  const maxScrollTop = scrollContainer
    ? Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight)
    : Math.max(
        0,
        (document.scrollingElement?.scrollHeight ?? document.documentElement.scrollHeight) -
          window.innerHeight
      );
  const targetScrollTop = Math.max(
    0,
    Math.min(maxScrollTop, currentScrollTop + targetCenter - (viewportTop + viewportHeight / 2))
  );
  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "instant"
    : "smooth";

  if (scrollContainer) {
    scrollContainer.scrollTo({ top: targetScrollTop, behavior });
  } else {
    window.scrollTo({ top: targetScrollTop, behavior });
  }
}
