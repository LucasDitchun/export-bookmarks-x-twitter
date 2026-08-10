import type {
  BookmarkDecorationItem,
  BookmarkDecorationLookupResult,
} from "../shared/protocol";
import type { ExtensionSettings } from "../settings/settings-repository";
import { isBookmarkCategorized } from "../domain/bookmark-categorization";

export type {
  BookmarkDecorationItem,
  BookmarkDecorationLookupResult,
} from "../shared/protocol";

const ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
const HOST_TAG = "bookmark-x-metadata";
const STATUS_PATH_PATTERN = /^\/[A-Za-z0-9_]+\/status\/(\d+)$/;
const DEFAULT_DECORATION_SETTINGS = {
  appearance: { largeText: true, highContrast: true, reduceMotion: false },
  behavior: {
    surface: "modal",
    promptAfterBookmark: true,
    metadata: {
      summary: true,
      breadcrumb: true,
      tags: true,
      note: true,
      categoryIndicator: true,
    },
  },
  export: {
    includeLink: true,
    includeText: true,
    includeAuthor: true,
    includeDate: true,
    includeImages: true,
    includeVideos: true,
    includeNote: true,
    includeTags: true,
    includeFolder: true,
    includeFirstSavedAt: true,
    includeLastSeenAt: true,
  },
  search: { filterAsYouType: true },
  data: { keepArchived: true },
} as const satisfies ExtensionSettings;

export interface BookmarkMetadataDecoratorOptions {
  document: Document;
  lookup(ids: string[]): Promise<BookmarkDecorationLookupResult>;
  scheduleFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
}

export interface BookmarkMetadataDecoratorController {
  refresh(bookmarkId?: string): void;
  setPending(article: Element, bookmarkId: string): void;
  stop(): void;
}

interface MountedDecoration {
  bookmarkId: string;
  host: HTMLElement;
}

type Translate = (key: string) => string;

const componentStyles = String.raw`
  :host {
    --bx-border: #cfd9de;
    --bx-ink: #0f1419;
    --bx-muted: #536471;
    --bx-surface: #ffffff;
    --bx-soft: #eff3f4;
    color: var(--bx-ink);
    display: block;
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 14px;
    line-height: 1.4;
    min-width: 0;
  }

  :host([data-large-text="true"]) { font-size: 15px; }

  .card {
    background: var(--bx-surface);
    border: 1px solid var(--bx-border);
    border-radius: 12px;
    box-sizing: border-box;
    display: grid;
    gap: 6px;
    margin: 6px 12px 4px;
    max-width: calc(100% - 24px);
    padding: 8px 10px;
  }

  .status-row, .tags, .breadcrumb {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    min-width: 0;
  }

  .status, .category, .tag {
    border-radius: 999px;
    font-size: 0.8125em;
    font-weight: 650;
    padding: 2px 7px;
    max-width: 100%;
    overflow-wrap: anywhere;
    white-space: normal;
  }

  .status::before { content: "✓ "; }
  .status[data-state="pending"]::before { content: "… "; }
  .status[data-state="archived"]::before { content: "↺ "; }
  .category::before { content: "! "; }
  .status { background: var(--bx-soft); color: var(--bx-muted); }
  .category { background: #fff3c4; color: #6b4e00; }
  .tag { background: var(--bx-soft); color: var(--bx-ink); }

  .breadcrumb { color: var(--bx-muted); font-size: 0.875em; font-weight: 600; }
  .crumb + .crumb::before { content: "›"; margin-inline-end: 6px; }

  .note {
    color: var(--bx-muted);
    display: -webkit-box;
    margin: 0;
    overflow: hidden;
    overflow-wrap: anywhere;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;
  }

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

  :host([data-high-contrast="true"]) {
    --bx-border: #111;
    --bx-ink: #000;
    --bx-muted: #242424;
    --bx-surface: #fff;
    --bx-soft: #f1f1f1;
  }

  @media (prefers-color-scheme: dark) {
    :host {
      --bx-border: #536471;
      --bx-ink: #e7e9ea;
      --bx-muted: #8b98a5;
      --bx-surface: #000;
      --bx-soft: #16181c;
    }
    .category { background: #3a2b00; color: #ffe28a; }
    .tag { background: #16181c; color: #e7e9ea; }
  }

  @media (forced-colors: active) {
    .card, .status, .category, .tag { border-color: CanvasText; }
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
  translate: Translate;
  pending?: boolean;
}): void {
  const { document, host, item, settings, translate } = options;
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = componentStyles;
  const card = document.createElement("section");
  card.className = "card";

  host.dataset.bookmarkId = item.bookmark.id;
  host.dataset.largeText = String(settings.appearance.largeText);
  host.dataset.highContrast = String(settings.appearance.highContrast);
  host.dataset.reduceMotion = String(settings.appearance.reduceMotion);
  host.dataset.state = options.pending
    ? "pending"
    : item.bookmark.status === "archived"
      ? "archived"
      : isBookmarkCategorized(item.bookmark, settings.behavior.metadata)
        ? "mapped"
        : "uncategorized";
  host.setAttribute("aria-label", translate("bookmarkMetadataLabel"));
  host.setAttribute("role", "group");

  if (
    settings.behavior.metadata.summary ||
    (!options.pending && settings.behavior.metadata.categoryIndicator)
  ) {
    const row = document.createElement("div");
    row.className = "status-row";
    if (settings.behavior.metadata.summary) {
      const status = appendTextElement(
        document,
        row,
        "span",
        "status",
        options.pending
          ? translate("liveBookmarkPending")
          : item.bookmark.status === "archived"
            ? translate("bookmarkMetadataArchived")
            : translate("bookmarkMetadataMapped"),
      );
      status.dataset.state = options.pending
        ? "pending"
        : item.bookmark.status === "archived"
          ? "archived"
          : "mapped";
    }
    if (
      !options.pending &&
      settings.behavior.metadata.categoryIndicator &&
      !isBookmarkCategorized(item.bookmark, settings.behavior.metadata)
    ) {
      appendTextElement(
        document,
        row,
        "span",
        "category",
        translate("bookmarkNeedsCategory"),
      );
    }
    card.append(row);
  }

  if (!options.pending && settings.behavior.metadata.breadcrumb) {
    const breadcrumb = document.createElement("div");
    breadcrumb.className = "breadcrumb";
    breadcrumb.setAttribute("aria-label", translate("bookmarkPromptFolder"));
    const names = item.breadcrumb.length
      ? item.breadcrumb
      : [translate("uncategorizedFolder")];
    for (const name of names) {
      appendTextElement(document, breadcrumb, "span", "crumb", name);
    }
    card.append(breadcrumb);
  }

  if (!options.pending && settings.behavior.metadata.tags && item.tags.length > 0) {
    const tags = document.createElement("div");
    tags.className = "tags";
    tags.setAttribute("aria-label", translate("bookmarkPromptTags"));
    for (const tag of item.tags) {
      appendTextElement(document, tags, "span", "tag", tag.name);
    }
    card.append(tags);
  }

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
  let generation = 0;
  let lastResult: BookmarkDecorationLookupResult | null = null;
  let lastTranslator: Translate = (key) => key;

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
    target.insertAdjacentElement("afterend", host);
    mounted.set(article, { bookmarkId, host });
    return host;
  };

  const flush = async (): Promise<void> => {
    frame = null;
    if (stopped) return;
    const run = ++generation;
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
    if (byId.size === 0) return;

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
      if (!result) return;
      result = { ...result, items: collectedItems };
      const translate: Translate = (key) => result.messages[key] ?? key;
      if (stopped || run !== generation) return;
      lastResult = result;
      lastTranslator = translate;
      const itemsById = new Map(result.items.map((item) => [item.bookmark.id, item]));
      for (const [id, matchingArticles] of byId) {
        const item = itemsById.get(id);
        for (const article of matchingArticles) {
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
            });
          }
        }
      }
    } catch {
      // Host-page decoration is supplementary; X must remain fully usable if lookup fails.
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
    refresh(bookmarkId) {
      for (const [article, pendingId] of pending) {
        if (!bookmarkId || pendingId === bookmarkId) pending.delete(article);
      }
      for (const article of Array.from(
        options.document.querySelectorAll(ARTICLE_SELECTOR),
      )) {
        if (!bookmarkId || bookmarkIdFromArticle(article) === bookmarkId) {
          queueArticle(article);
        }
      }
    },
    setPending(article, bookmarkId) {
      const host = ensureHost(article, bookmarkId);
      if (!host) return;
      const settings = lastResult?.settings ?? DEFAULT_DECORATION_SETTINGS;
      if (!settings.behavior.metadata.summary) {
        removeMounted(article);
        return;
      }
      pending.set(article, bookmarkId);
      const existing = lastResult?.items.find(
        (item) => item.bookmark.id === bookmarkId,
      );
      const item: BookmarkDecorationItem =
        existing ??
        ({
          bookmark: {
            id: bookmarkId,
            text: "",
            url: "",
            author: { id: "", username: "", name: "" },
            postCreatedAt: "",
            media: { images: [], videos: [] },
            note: "",
            folderId: null,
            tagIds: [],
            firstSavedAt: "",
            lastSeenAt: "",
            archivedAt: null,
            metadataUpdatedAt: "",
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
