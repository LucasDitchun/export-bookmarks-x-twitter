// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAppNavigation } from "./navigation";

beforeEach(() => {
  document.body.innerHTML = `
    <main class="dashboard">
      <section data-app-view="home"><h2 data-view-heading tabindex="-1">Home</h2></section>
      <section data-app-view="library" hidden><h2 data-view-heading tabindex="-1">Library</h2></section>
      <section data-app-view="detail" hidden><h2 data-view-heading tabindex="-1">Detail</h2></section>
      <section data-app-view="settings" hidden><h2 data-view-heading tabindex="-1">Settings</h2></section>
    </main>
    <nav aria-label="Primary">
      <button data-app-nav="home">Home</button>
      <button data-app-nav="library">Library</button>
      <button data-app-nav="settings">Settings</button>
    </nav>
    <button data-detail-back>Back</button>
  `;
});

describe("app navigation", () => {
  it("opens on Home and exposes one current destination", () => {
    const navigation = createAppNavigation({ document });

    expect(document.querySelector<HTMLElement>('[data-app-view="home"]')?.hidden).toBe(
      false,
    );
    expect(
      document.querySelector<HTMLElement>('[data-app-view="library"]')?.hidden,
    ).toBe(true);
    expect(
      document.querySelector('[data-app-nav="home"]')?.getAttribute("aria-current"),
    ).toBe("page");
    expect(
      document.querySelector('[data-app-nav="library"]')?.hasAttribute("aria-current"),
    ).toBe(false);

    navigation.destroy();
  });

  it("navigates between primary destinations and focuses their heading", () => {
    const onViewChange = vi.fn();
    const navigation = createAppNavigation({ document, onViewChange });
    const libraryButton = document.querySelector<HTMLButtonElement>(
      '[data-app-nav="library"]',
    );
    const dashboard = document.querySelector<HTMLElement>(".dashboard");
    if (dashboard) dashboard.scrollTop = 180;

    libraryButton?.click();

    expect(document.querySelector<HTMLElement>('[data-app-view="home"]')?.hidden).toBe(
      true,
    );
    expect(
      document.querySelector<HTMLElement>('[data-app-view="library"]')?.hidden,
    ).toBe(false);
    expect(libraryButton?.getAttribute("aria-current")).toBe("page");
    expect(document.activeElement?.textContent).toBe("Library");
    expect(dashboard?.scrollTop).toBe(0);
    expect(onViewChange).toHaveBeenLastCalledWith("library");

    navigation.destroy();
  });

  it("opens bookmark details and returns to the library with Back or Escape", () => {
    const navigation = createAppNavigation({ document });

    navigation.openDetail();
    expect(
      document.querySelector<HTMLElement>('[data-app-view="detail"]')?.hidden,
    ).toBe(false);
    expect(
      document.querySelector('[data-app-nav="library"]')?.getAttribute("aria-current"),
    ).toBe("page");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(
      document.querySelector<HTMLElement>('[data-app-view="library"]')?.hidden,
    ).toBe(false);

    navigation.openDetail();
    document.querySelector<HTMLButtonElement>("[data-detail-back]")?.click();
    expect(
      document.querySelector<HTMLElement>('[data-app-view="library"]')?.hidden,
    ).toBe(false);

    navigation.destroy();
  });
});
