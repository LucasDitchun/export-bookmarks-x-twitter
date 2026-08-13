import type {
  BookmarkDecorationItem,
  BookmarkDecorationLookupResult,
  BookmarkLocalizationResult,
} from "../shared/protocol";
import type { ExtensionSettings } from "../settings/settings-repository";
import { createIconButton } from "../ui/icons";
import type { BookmarkMetadataTranslator } from "../shared/bookmark-metadata-messages";

export type {
  BookmarkDecorationItem,
  BookmarkDecorationLookupResult,
} from "../shared/protocol";

const ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
const HOST_TAG = "bookmark-x-metadata";
const STATUS_PATH_PATTERN = /^\/[A-Za-z0-9_]+\/status\/(\d+)$/;
export interface BookmarkMetadataDecoratorOptions {
  document: Document;
  lookup(ids: string[]): Promise<BookmarkDecorationLookupResult>;
  scheduleFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
  onOrganize?: (
    item: BookmarkDecorationItem,
    translate: BookmarkMetadataTranslator,
    trigger: HTMLButtonElement,
  ) => void;
}

export interface BookmarkMetadataDecoratorController {
  refresh(bookmarkIds?: string | readonly string[]): void;
  setLocalization(localization: BookmarkLocalizationResult): void;
  setPending(article: Element, bookmarkId: string): Promise<void>;
  stop(): void;
}

interface MountedDecoration {
  bookmarkId: string;
  host: HTMLElement;
}

const componentStyles = String.raw`
  :host {
    color: inherit;
    display: block;
    font-family: inherit;
    font-size: 14px;
    line-height: 1.4;
    min-width: 0;
    width: 100%;
  }

  :host([data-large-text="true"]) { font-size: 15px; }

  .card {
    background: transparent;
    border: 0;
    border-top: 1px solid color-mix(in srgb, currentColor 14%, transparent);
    border-radius: 0;
    box-sizing: border-box;
    display: grid;
    gap: 5px;
    margin: 8px 0 2px;
    max-width: 100%;
    padding: 6px 0 0;
    width: 100%;
  }

  .metadata-heading, .status-row, .tags, .breadcrumb, .metadata-field {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    min-width: 0;
  }

  .metadata-heading { flex-wrap: nowrap; justify-content: space-between; }
  .metadata-line {
    color: color-mix(in srgb, currentColor 78%, transparent);
    display: grid;
    gap: 5px;
    min-width: 0;
  }
  .metadata-field { align-items: baseline; }
  .metadata-label {
    color: inherit;
    flex: 0 0 auto;
    font-size: 0.75em;
    font-weight: 700;
  }

  .status, .tag {
    border-radius: 999px;
    font-size: 0.75em;
    font-weight: 650;
    padding: 2px 6px;
    max-width: 100%;
    overflow-wrap: anywhere;
    white-space: normal;
  }

  .status[data-state="pending"]::before { content: "… "; }
  .status[data-state="archived"]::before { content: "↺ "; }
  .status, .tag {
    background: color-mix(in srgb, currentColor 9%, transparent);
    color: inherit;
  }
  .status[data-state="uncategorized"] {
    background: color-mix(in srgb, #f4b400 18%, transparent);
  }

  .breadcrumb { font-size: 0.8125em; font-weight: 600; }
  .crumb + .crumb::before { content: "›"; margin-inline-end: 6px; }

  .note {
    color: color-mix(in srgb, currentColor 72%, transparent);
    display: -webkit-box;
    font-size: 0.8125em;
    margin: 0;
    overflow: hidden;
    overflow-wrap: anywhere;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;
  }

  .organize {
    align-items: center;
    background: transparent;
    border: 0;
    border-radius: 999px;
    color: inherit;
    cursor: pointer;
    display: inline-flex;
    flex: 0 0 auto;
    gap: 6px;
    justify-content: center;
    height: 34px;
    margin-inline-start: auto;
    padding: 0 10px;
  }
  .organize svg { display: block; height: 18px; width: 18px; }
  .organize-label { font-size: 0.8125em; font-weight: 700; }
  .organize:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
  .organize:focus-visible { outline: 2px solid #1d9bf0; outline-offset: 2px; }

  .visually-hidden {
    border: 0;
    clip: rect(0 0 0 0);
    height: 1px;
    margin: -1px;
    overflow: hidden;
    padding: 0;
    position: absolute;
    white-space: nowrap;
    width: 1px;
  }

  :host([data-high-contrast="true"]) .card {
    border-top-color: color-mix(in srgb, currentColor 34%, transparent);
  }

  @media (forced-colors: active) {
    .card, .status, .tag { border-color: CanvasText; }
    .card { background: Canvas; color: CanvasText; }
  }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }

  :host([data-reduce-motion="true"]) *,
  :host([data-reduce-motion="true"]) *::before,
  :host([data-reduce-motion="true"]) *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
`;

function appendTextElement(
  document: Document,
  parent: ParentNode,
  tagName: string,
  className: string,
  text: string,
): HTMLElement {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

function hasVisibleMetadataSetting(settings: ExtensionSettings): boolean {
  return Object.values(settings.behavior.metadata).some(Boolean);
}

function renderDecoration(options: {
  document: Document;
  host: HTMLElement;
  item: BookmarkDecorationItem;
  settings: ExtensionSettings;
  translate: BookmarkMetadataTranslator;
  pending?: boolean;
  onOrganize?: BookmarkMetadataDecoratorOptions["onOrganize"];
}): void {
  const { document, host, item, settings, translate } = options;
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = componentStyles;
  const card = document.createElement("section");
  card.className = "card";
  const heading = document.createElement("div");
  heading.className = "metadata-heading";

  host.dataset.bookmarkId = item.bookmark.id;
  host.dataset.largeText = String(settings.appearance.largeText);
  host.dataset.highContrast = String(settings.appearance.highContrast);
  host.dataset.reduceMotion = String(settings.appearance.reduceMotion);
  const hasOrganization = item.breadcrumb.length > 0 || item.tags.length > 0;
  host.dataset.state = options.pending
    ? "pending"
    : item.bookmark.status === "archived"
      ? "archived"
      : hasOrganization
        ? "mapped"
        : "uncategorized";
  host.setAttribute("aria-label", translate("bookmarkMetadataLabel"));
  host.setAttribute("role", "group");

  const showStatus = options.pending
    ? settings.behavior.metadata.summary
    : item.bookmark.status === "archived"
      ? settings.behavior.metadata.summary
      : settings.behavior.metadata.categoryIndicator && !hasOrganization;
  if (showStatus) {
    const row = document.createElement("div");
    row.className = "status-row";
    const status = appendTextElement(
      document,
      row,
      "span",
      "status",
      options.pending
        ? translate("liveBookmarkPending")
        : item.bookmark.status === "archived"
          ? translate("bookmarkMetadataArchived")
          : translate("uncategorizedFolder"),
    );
    status.dataset.state = options.pending
      ? "pending"
      : item.bookmark.status === "archived"
        ? "archived"
        : "uncategorized";
    heading.append(row);
  }

  if (!options.pending && options.onOrganize) {
    const organize = createIconButton({
      document,
      icon: "edit",
      label: translate("bookmarkMetadataOrganize"),
      className: "organize",
    });
    appendTextElement(
      document,
      organize,
      "span",
      "organize-label",
      translate("bookmarkMetadataOrganize"),
    );
    organize.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      options.onOrganize?.(item, translate, organize);
    });
    heading.append(organize);
  }
  if (heading.childElementCount > 0) card.append(heading);

  const metadataLine = document.createElement("div");
  metadataLine.className = "metadata-line";
  if (
    !options.pending &&
    settings.behavior.metadata.breadcrumb &&
    item.breadcrumb.length > 0
  ) {
    const field = document.createElement("div");
    field.className = "metadata-field metadata-folder";
    appendTextElement(
      document,
      field,
      "span",
      "metadata-label",
      `${translate("bookmarkPromptFolder")}:`,
    );
    const breadcrumb = document.createElement("div");
    breadcrumb.className = "breadcrumb";
    breadcrumb.setAttribute("aria-label", translate("bookmarkPromptFolder"));
    for (const name of item.breadcrumb) {
      appendTextElement(document, breadcrumb, "span", "crumb", name);
    }
    field.append(breadcrumb);
    metadataLine.append(field);
  }

  if (!options.pending && settings.behavior.metadata.tags && item.tags.length > 0) {
    const field = document.createElement("div");
    field.className = "metadata-field metadata-tags";
    appendTextElement(
      document,
      field,
      "span",
      "metadata-label",
      `${translate("bookmarkPromptTags")}:`,
    );
    const tags = document.createElement("div");
    tags.className = "tags";
    tags.setAttribute("aria-label", translate("bookmarkPromptTags"));
    for (const tag of item.tags) {
      appendTextElement(document, tags, "span", "tag", tag.name);
    }
    field.append(tags);
    metadataLine.append(field);
  }
  if (metadataLine.childElementCount > 0) card.append(metadataLine);

  if (
    !options.pending &&
    settings.behavior.metadata.note &&
    item.bookmark.note.trim().length > 0
  ) {
    const note = document.createElement("p");
    note.className = "note";
    appendTextElement(
      document,
      note,
      "span",
      "visually-hidden",
      `${translate("bookmarkPromptNote")}: `,
    );
    note.append(document.createTextNode(item.bookmark.note));
    card.append(note);
  }

  shadow.replaceChildren(style, card);
}

function bookmarkIdFromArticle(article: Element): string | null {
  for (const anchor of Array.from(
    article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]'),
  )) {
    try {
      const match = new URL(anchor.href, location.href).pathname.match(
        STATUS_PATH_PATTERN,
      );
      if (match?.[1]) return match[1];
    } catch {
      // Ignore malformed host-page links.
    }
  }
  return null;
}

function insertionTarget(article: Element): Element | null {
  const action = article.querySelector(
    'button[data-testid="bookmark"], button[data-testid="removeBookmark"]',
  );
  return action?.closest('[role="group"]') ?? action;
}

function defaultSchedule(document: Document, callback: FrameRequestCallback): number {
  const view = document.defaultView;
  if (typeof view?.requestAnimationFrame === "function") {
    return view.requestAnimationFrame(callback);
  }
  queueMicrotask(() => callback(performance.now()));
  return 0;
}

export function startBookmarkMetadataDecorator(
  options: BookmarkMetadataDecoratorOptions,
): BookmarkMetadataDecoratorController {
  const mounted = new Map<Element, MountedDecoration>();
  const pending = new Map<Element, string>();
  const queued = new Set<Element>();
  let stopped = false;
  let frame: number | null = null;
  let flushing = false;
  let generation = 0;
  let lastResult: BookmarkDecorationLookupResult | null = null;
  let localizationOverride: BookmarkLocalizationResult | null = null;
  let lastTranslator: BookmarkMetadataTranslator = (key) => key;
  let presentationContextLoading: Promise<BookmarkDecorationLookupResult | null> | null =
    null;

  const rememberPresentationContext = (
    result: BookmarkDecorationLookupResult,
  ): BookmarkDecorationLookupResult => {
    const current = localizationOverride
      ? { ...result, ...localizationOverride }
      : result;
    lastResult = current;
    lastTranslator = (key) => current.messages[key] ?? key;
    return current;
  };

  const loadPresentationContext = (
    bookmarkId: string,
  ): Promise<BookmarkDecorationLookupResult | null> => {
    if (lastResult) return Promise.resolve(lastResult);
    presentationContextLoading ??= options
      .lookup([bookmarkId])
      .then((result) => (stopped ? null : rememberPresentationContext(result)))
      .catch(() => null)
      .finally(() => {
        presentationContextLoading = null;
      });
    return presentationContextLoading;
  };

  const removeMounted = (article: Element): void => {
    mounted.get(article)?.host.remove();
    mounted.delete(article);
    pending.delete(article);
  };

  const ensureHost = (article: Element, bookmarkId: string): HTMLElement | null => {
    const target = insertionTarget(article);
    if (!target) return null;
    const existing = mounted.get(article);
    if (existing?.bookmarkId === bookmarkId && existing.host.isConnected) {
      return existing.host;
    }
    removeMounted(article);
    const host = options.document.createElement(HOST_TAG);
    for (const eventName of ["click", "auxclick", "pointerdown", "mousedown"]) {
      host.addEventListener(eventName, (event) => event.stopPropagation());
    }
    target.insertAdjacentElement("afterend", host);
    mounted.set(article, { bookmarkId, host });
    return host;
  };

  const flush = async (): Promise<void> => {
    frame = null;
    if (stopped || flushing) return;
    flushing = true;
    const run = generation;
    try {
      while (!stopped && run === generation && queued.size > 0) {
        for (const article of [...mounted.keys()]) {
          if (!article.isConnected) removeMounted(article);
        }
        const articles = [...queued].filter((article) => article.isConnected);
        queued.clear();
        const byId = new Map<string, Element[]>();
        for (const article of articles) {
          const id = bookmarkIdFromArticle(article);
          if (!id) {
            removeMounted(article);
            continue;
          }
          const group = byId.get(id) ?? [];
          group.push(article);
          byId.set(id, group);
        }
        if (byId.size === 0) continue;

        try {
          const ids = [...byId.keys()];
          let result: BookmarkDecorationLookupResult | null = null;
          const collectedItems: BookmarkDecorationItem[] = [];
          for (let offset = 0; offset < ids.length; offset += 100) {
            const page = await options.lookup(ids.slice(offset, offset + 100));
            if (stopped || run !== generation) return;
            result = page;
            collectedItems.push(...page.items);
          }
          if (!result) continue;
          result = rememberPresentationContext({ ...result, items: collectedItems });
          const translate: BookmarkMetadataTranslator = (key) =>
            result.messages[key] ?? key;
          if (stopped || run !== generation) return;
          const itemsById = new Map(
            result.items.map((item) => [item.bookmark.id, item]),
          );
          for (const [id, matchingArticles] of byId) {
            const item = itemsById.get(id);
            for (const article of matchingArticles) {
              if (!article.isConnected) {
                removeMounted(article);
                continue;
              }
              if (bookmarkIdFromArticle(article) !== id) {
                queued.add(article);
                continue;
              }
              if (!item) {
                if (pending.get(article) === id) continue;
                removeMounted(article);
                continue;
              }
              if (!hasVisibleMetadataSetting(result.settings)) {
                removeMounted(article);
                continue;
              }
              const host = ensureHost(article, id);
              if (host) {
                renderDecoration({
                  document: options.document,
                  host,
                  item,
                  settings: result.settings,
                  translate,
                  pending: pending.get(article) === id,
                  onOrganize: options.onOrganize,
                });
              }
            }
          }
        } catch {
          // Host-page decoration is supplementary; X must remain fully usable if lookup fails.
        }
      }
    } finally {
      flushing = false;
      if (!stopped && queued.size > 0) schedule();
    }
  };

  const schedule = (): void => {
    if (stopped || frame !== null) return;
    frame = (
      options.scheduleFrame ??
      ((callback) => defaultSchedule(options.document, callback))
    )(() => void flush());
  };

  const queueArticle = (article: Element): void => {
    queued.add(article);
    schedule();
  };

  const queueNodeArticles = (node: Node): void => {
    if (!(node instanceof Element)) return;
    if (node.matches(ARTICLE_SELECTOR)) queueArticle(node);
    for (const article of Array.from(node.querySelectorAll(ARTICLE_SELECTOR))) {
      queueArticle(article);
    }
    const parentArticle = node.closest(ARTICLE_SELECTOR);
    if (parentArticle) queueArticle(parentArticle);
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (
        record.type === "childList" &&
        [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)].length >
          0 &&
        [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)].every(
          (node) => node instanceof Element && node.localName === HOST_TAG,
        )
      ) {
        continue;
      }
      queueNodeArticles(record.target);
      for (const node of Array.from(record.addedNodes)) queueNodeArticles(node);
      for (const node of Array.from(record.removedNodes)) queueNodeArticles(node);
    }
  });
  observer.observe(options.document.documentElement, {
    attributes: true,
    attributeFilter: ["href", "data-testid"],
    childList: true,
    subtree: true,
  });
  for (const article of Array.from(
    options.document.querySelectorAll(ARTICLE_SELECTOR),
  )) {
    queueArticle(article);
  }

  return {
    refresh(bookmarkIds) {
      const targetedIds =
        typeof bookmarkIds === "string"
          ? new Set([bookmarkIds])
          : bookmarkIds
            ? new Set(bookmarkIds)
            : null;
      for (const [article, pendingId] of pending) {
        if (!targetedIds || targetedIds.has(pendingId)) pending.delete(article);
      }
      for (const article of Array.from(
        options.document.querySelectorAll(ARTICLE_SELECTOR),
      )) {
        const articleId = targetedIds ? bookmarkIdFromArticle(article) : null;
        if (!targetedIds || (articleId !== null && targetedIds.has(articleId))) {
          queueArticle(article);
        }
      }
    },
    setLocalization(localization) {
      localizationOverride = localization;
      if (!lastResult) return;
      lastResult = rememberPresentationContext(lastResult);
      const itemsById = new Map(
        lastResult.items.map((item) => [item.bookmark.id, item]),
      );
      for (const [article, mountedDecoration] of mounted) {
        const item = itemsById.get(mountedDecoration.bookmarkId);
        if (!item) continue;
        renderDecoration({
          document: options.document,
          host: mountedDecoration.host,
          item,
          settings: lastResult.settings,
          translate: lastTranslator,
          pending: pending.get(article) === mountedDecoration.bookmarkId,
          onOrganize: options.onOrganize,
        });
      }
    },
    async setPending(article, bookmarkId) {
      pending.set(article, bookmarkId);
      const context = await loadPresentationContext(bookmarkId);
      if (
        !context ||
        stopped ||
        !article.isConnected ||
        pending.get(article) !== bookmarkId
      ) {
        pending.delete(article);
        return;
      }
      const settings = context.settings;
      if (!settings.behavior.metadata.summary) {
        removeMounted(article);
        return;
      }
      const host = ensureHost(article, bookmarkId);
      if (!host) return;
      pending.set(article, bookmarkId);
      const existing = context.items.find((item) => item.bookmark.id === bookmarkId);
      const item: BookmarkDecorationItem =
        existing ??
        ({
          bookmark: {
            id: bookmarkId,
            text: "",
            url: "",
            note: "",
            folderId: null,
            tagIds: [],
            status: "current",
          },
          breadcrumb: [],
          tags: [],
        } satisfies BookmarkDecorationItem);
      renderDecoration({
        document: options.document,
        host,
        item,
        settings,
        translate: lastTranslator,
        pending: true,
      });
    },
    stop() {
      if (stopped) return;
      stopped = true;
      generation += 1;
      observer.disconnect();
      if (frame !== null && frame !== 0) {
        if (options.cancelFrame) options.cancelFrame(frame);
        else options.document.defaultView?.cancelAnimationFrame(frame);
      }
      for (const article of [...mounted.keys()]) removeMounted(article);
      queued.clear();
      pending.clear();
    },
  };
}
