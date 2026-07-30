const LOADING_SELECTOR = [
  'main [role="progressbar"]',
  'main [data-testid="progressBar"]',
  'main [aria-busy="true"]',
  'main[aria-busy="true"]',
].join(",");

function isHidden(element: Element): boolean {
  if (element.closest('[hidden], [aria-hidden="true"]')) return true;

  const view = element.ownerDocument.defaultView;
  if (!view) return false;
  const style = view.getComputedStyle(element);
  return style.display === "none" || style.visibility === "hidden";
}

export function isPageLoading(root: ParentNode): boolean {
  return Array.from(root.querySelectorAll(LOADING_SELECTOR)).some(
    (element) => !isHidden(element),
  );
}

export interface PageScrollPosition {
  scrollTop: number;
  viewportHeight: number;
  documentHeight: number;
}

export function hasReachedPageEnd(
  { scrollTop, viewportHeight, documentHeight }: PageScrollPosition,
  threshold = 8,
): boolean {
  return scrollTop + viewportHeight >= documentHeight - threshold;
}
