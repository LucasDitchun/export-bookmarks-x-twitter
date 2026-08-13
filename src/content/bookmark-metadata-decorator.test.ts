// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import type { BookmarkDecorationReadModel } from "../domain/types";
import { DEFAULT_SETTINGS } from "../settings/settings-repository";
import {
  startBookmarkMetadataDecorator,
  type BookmarkDecorationLookupResult,
} from "./bookmark-metadata-decorator";

const categorizedBookmark: BookmarkDecorationReadModel = {
  id: "123",
  text: "Useful post",
  url: "https://x.com/alice/status/123",
  note: '<img src=x onerror="alert(1)">Keep this for the launch plan.',
  folderId: "folder-ai",
  tagIds: ["tag-ai", "tag-research"],
  status: "current",
};

function renderArticle(id: string): HTMLElement {
  const article = document.createElement("article");
  article.dataset.testid = "tweet";
  const link = document.createElement("a");
  link.href = `https://x.com/alice/status/${id}`;
  const time = document.createElement("time");
  time.dateTime = "2026-08-09T09:00:00.000Z";
  link.append(time);
  const actions = document.createElement("div");
  actions.setAttribute("role", "group");
  actions.dataset.testid = "actions";
  const button = document.createElement("button");
  button.dataset.testid = "removeBookmark";
  actions.append(button);
  article.append(link, actions);
  document.body.append(article);
  return article;
}

function result(): BookmarkDecorationLookupResult {
  return {
    locale: "en",
    messages: {},
    settings: structuredClone(DEFAULT_SETTINGS),
    items: [
      {
        bookmark: categorizedBookmark,
        breadcrumb: ["Research", "Artificial intelligence"],
        tags: [
          { id: "tag-ai", name: "AI", normalizedName: "ai" },
          { id: "tag-research", name: "Research", normalizedName: "research" },
        ],
      },
    ],
  };
}

function uncategorizedResult(
  overrides: Partial<BookmarkDecorationLookupResult> = {},
): BookmarkDecorationLookupResult {
  return {
    locale: "en",
    messages: {},
    settings: structuredClone(DEFAULT_SETTINGS),
    items: [
      {
        bookmark: {
          ...categorizedBookmark,
          note: "",
          folderId: null,
          tagIds: [],
        },
        breadcrumb: [],
        tags: [],
      },
    ],
    ...overrides,
  };
}

async function settle(): Promise<void> {
  await vi.waitFor(() => {
    expect(document.querySelector("bookmark-x-metadata")).not.toBeNull();
  });
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("startBookmarkMetadataDecorator", () => {
  it("waits for localized settings before rendering a pending bookmark", async () => {
    const article = renderArticle("123");
    let resolveLookup!: (value: BookmarkDecorationLookupResult) => void;
    const lookupResult = new Promise<BookmarkDecorationLookupResult>((resolve) => {
      resolveLookup = resolve;
    });
    const lookup = vi.fn(() => lookupResult);
    const decorator = startBookmarkMetadataDecorator({ document, lookup });

    const pending = decorator.setPending(article, "123");
    expect(article.querySelector("bookmark-x-metadata")).toBeNull();
    resolveLookup(
      uncategorizedResult({ messages: { liveBookmarkPending: "Salvando…" } }),
    );
    await pending;

    const host = article.querySelector<HTMLElement>("bookmark-x-metadata");
    expect(host?.dataset.state).toBe("pending");
    expect(host?.shadowRoot?.textContent).toContain("Salvando…");
    expect(host?.shadowRoot?.textContent).not.toContain("liveBookmarkPending");
    decorator.stop();
  });

  it("does not render pending metadata when context fails or summary is disabled", async () => {
    const failedArticle = renderArticle("123");
    const failed = startBookmarkMetadataDecorator({
      document,
      lookup: async () => Promise.reject(new Error("temporary lookup failure")),
    });
    await failed.setPending(failedArticle, "123");
    expect(failedArticle.querySelector("bookmark-x-metadata")).toBeNull();
    failed.stop();

    document.body.replaceChildren();
    const hiddenArticle = renderArticle("123");
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.behavior.metadata.summary = false;
    const hidden = startBookmarkMetadataDecorator({
      document,
      lookup: async () => uncategorizedResult({ settings }),
    });
    await hidden.setPending(hiddenArticle, "123");
    expect(hiddenArticle.querySelector("bookmark-x-metadata")).toBeNull();
    hidden.stop();
  });

  it("injects safe, isolated metadata after the actions only for a local bookmark", async () => {
    const local = renderArticle("123");
    const unknown = renderArticle("999");
    const lookup = vi.fn(async () => result());
    const onOrganize = vi.fn();
    const decorator = startBookmarkMetadataDecorator({
      document,
      lookup,
      onOrganize,
    });

    await settle();

    expect(lookup).toHaveBeenCalledWith(["123", "999"]);
    const host = local.querySelector<HTMLElement>("bookmark-x-metadata");
    expect(host?.previousElementSibling?.getAttribute("data-testid")).toBe("actions");
    expect(unknown.querySelector("bookmark-x-metadata")).toBeNull();
    expect(host?.shadowRoot).not.toBeNull();
    const styles = host?.shadowRoot?.querySelector("style")?.textContent ?? "";
    expect(styles).not.toContain("#a8d500");
    expect(styles).not.toContain("#f8ffe2");
    expect(styles).not.toContain("border-left: 4px");
    expect(styles).toContain("font-size: 14px");
    expect(host?.shadowRoot?.querySelector("img")).toBeNull();
    expect(host?.shadowRoot?.textContent).toContain(
      '<img src=x onerror="alert(1)">Keep this for the launch plan.',
    );
    expect(host?.shadowRoot?.textContent).toContain("Research");
    expect(host?.shadowRoot?.textContent).toContain("AI");
    expect(host?.shadowRoot?.textContent).toContain("bookmarkPromptFolder:");
    expect(host?.shadowRoot?.textContent).toContain("bookmarkPromptTags:");
    expect(host?.shadowRoot?.textContent).not.toContain("bookmarkMetadataMapped");
    expect(host?.shadowRoot?.querySelectorAll(".metadata-field")).toHaveLength(2);
    expect(host?.getAttribute("aria-label")).toBe("bookmarkMetadataLabel");
    const organize = host?.shadowRoot?.querySelector<HTMLButtonElement>(".organize");
    expect(organize?.textContent).toBe("bookmarkMetadataOrganize");
    expect(organize?.getAttribute("aria-label")).toBe("bookmarkMetadataOrganize");
    expect(organize?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(styles).toContain("margin-inline-start: auto");
    organize?.click();
    expect(onOrganize).toHaveBeenCalledOnce();

    decorator.stop();
  });

  it("rerenders an injected card with the latest localization", async () => {
    const article = renderArticle("123");
    const current = uncategorizedResult({
      messages: { uncategorizedFolder: "Uncategorized" },
    });
    const decorator = startBookmarkMetadataDecorator({
      document,
      lookup: async () => current,
    });
    await settle();
    const host = article.querySelector<HTMLElement>("bookmark-x-metadata");
    expect(host?.shadowRoot?.textContent).toContain("Uncategorized");

    decorator.setLocalization({
      locale: "pt_BR",
      messages: { uncategorizedFolder: "Sem categoria" },
    });

    expect(host?.shadowRoot?.textContent).toContain("Sem categoria");
    expect(host?.shadowRoot?.textContent).not.toContain("Uncategorized");
    decorator.stop();
  });

  it("moves through pending, uncategorized, mapped, and archived states without duplicate hosts", async () => {
    const article = renderArticle("123");
    let current = uncategorizedResult();
    const lookup = vi.fn(async () => current);
    const decorator = startBookmarkMetadataDecorator({
      document,
      lookup,
    });
    await settle();

    const host = article.querySelector<HTMLElement>("bookmark-x-metadata")!;
    expect(host.dataset.state).toBe("uncategorized");
    expect(host.shadowRoot?.textContent).not.toContain("bookmarkNeedsCategory");
    expect(host.shadowRoot?.textContent).toContain("uncategorizedFolder");
    expect(host.shadowRoot?.querySelector(".status")?.textContent).not.toContain("!");

    await decorator.setPending(article, "123");
    expect(article.querySelectorAll("bookmark-x-metadata")).toHaveLength(1);
    expect(host.dataset.state).toBe("pending");
    expect(host.shadowRoot?.textContent).toContain("liveBookmarkPending");
    const lookupsBeforeXChange = lookup.mock.calls.length;
    article.querySelector("button")!.dataset.testid = "bookmark";
    await vi.waitFor(() =>
      expect(lookup.mock.calls.length).toBeGreaterThan(lookupsBeforeXChange),
    );
    expect(host.dataset.state).toBe("pending");

    current = result();
    decorator.refresh("123");
    await vi.waitFor(() => expect(host.dataset.state).toBe("mapped"));
    expect(article.querySelectorAll("bookmark-x-metadata")).toHaveLength(1);
    expect(host.shadowRoot?.textContent).not.toContain("bookmarkNeedsCategory");

    current = {
      ...uncategorizedResult(),
      items: [
        {
          ...uncategorizedResult().items[0]!,
          breadcrumb: ["Research"],
        },
      ],
    };
    decorator.refresh("123");
    await vi.waitFor(() => expect(host.dataset.state).toBe("mapped"));
    expect(host.shadowRoot?.textContent).not.toContain("uncategorizedFolder");

    current = {
      ...uncategorizedResult(),
      items: [
        {
          ...uncategorizedResult().items[0]!,
          tags: [{ id: "tag-ai", name: "AI", normalizedName: "ai" }],
        },
      ],
    };
    decorator.refresh("123");
    await vi.waitFor(() => expect(host.dataset.state).toBe("mapped"));
    expect(host.shadowRoot?.textContent).not.toContain("uncategorizedFolder");

    current = {
      ...result(),
      items: [
        {
          ...result().items[0]!,
          bookmark: {
            ...categorizedBookmark,
            status: "archived",
          },
        },
      ],
    };
    decorator.refresh("123");
    await vi.waitFor(() => expect(host.dataset.state).toBe("archived"));
    expect(host.shadowRoot?.textContent).toContain("bookmarkMetadataArchived");

    decorator.stop();
    expect(article.querySelector("bookmark-x-metadata")).toBeNull();
  });

  it("respects every metadata and appearance preference", async () => {
    const article = renderArticle("123");
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.appearance.largeText = false;
    settings.appearance.highContrast = false;
    settings.appearance.reduceMotion = true;
    settings.behavior.metadata = {
      summary: false,
      breadcrumb: false,
      tags: false,
      note: false,
      categoryIndicator: true,
    };
    let current = uncategorizedResult({ settings });
    const decorator = startBookmarkMetadataDecorator({
      document,
      lookup: async () => current,
    });
    await settle();

    const host = article.querySelector<HTMLElement>("bookmark-x-metadata")!;
    expect(host.dataset.largeText).toBe("false");
    expect(host.dataset.highContrast).toBe("false");
    expect(host.dataset.reduceMotion).toBe("true");
    expect(host.dataset.state).toBe("uncategorized");
    expect(host.shadowRoot?.textContent).not.toContain("bookmarkMetadataMapped");
    expect(host.shadowRoot?.textContent).not.toContain("bookmarkNeedsCategory");
    expect(host.shadowRoot?.textContent).toContain("uncategorizedFolder");

    current = {
      ...current,
      settings: {
        ...current.settings,
        behavior: {
          ...current.settings.behavior,
          metadata: {
            summary: false,
            breadcrumb: false,
            tags: false,
            note: false,
            categoryIndicator: false,
          },
        },
      },
    };
    decorator.refresh("123");
    await vi.waitFor(() =>
      expect(article.querySelector("bookmark-x-metadata")).toBeNull(),
    );

    decorator.stop();
  });

  it("reconciles added, removed, and recycled SPA articles in batched frames", async () => {
    const first = renderArticle("123");
    const scheduleFrame = vi.fn((callback: FrameRequestCallback) => {
      queueMicrotask(() => callback(performance.now()));
      return 1;
    });
    const lookup = vi.fn(async (ids: string[]) => ({
      ...result(),
      items: ids.includes("123") ? result().items : [],
    }));
    const decorator = startBookmarkMetadataDecorator({
      document,
      lookup,
      scheduleFrame,
    });
    await settle();

    const link = first.querySelector("a")!;
    link.href = "https://x.com/alice/status/456";
    await vi.waitFor(() => {
      expect(first.querySelector("bookmark-x-metadata")).toBeNull();
    });

    first.remove();
    const replacement = renderArticle("123");
    await vi.waitFor(() => {
      expect(replacement.querySelectorAll("bookmark-x-metadata")).toHaveLength(1);
    });
    expect(scheduleFrame.mock.calls.length).toBeLessThanOrEqual(4);

    decorator.stop();
  });

  it("bounds large visible timelines to 100 post IDs per local lookup", async () => {
    for (let id = 1; id <= 101; id += 1) renderArticle(String(id));
    const lookup = vi.fn(
      async (ids: string[]): Promise<BookmarkDecorationLookupResult> => {
        void ids;
        return { ...result(), items: [] };
      },
    );
    const decorator = startBookmarkMetadataDecorator({
      document,
      lookup,
    });

    await vi.waitFor(() => expect(lookup).toHaveBeenCalledTimes(2));
    expect(lookup.mock.calls[0]?.[0]).toHaveLength(100);
    expect(lookup.mock.calls[1]?.[0]).toHaveLength(1);
    expect(document.querySelector("bookmark-x-metadata")).toBeNull();

    decorator.stop();
  });
});
