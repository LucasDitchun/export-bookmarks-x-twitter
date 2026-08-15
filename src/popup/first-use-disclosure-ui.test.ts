// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFirstUseDisclosureUi } from "./first-use-disclosure-ui";

beforeEach(() => {
  document.body.innerHTML = `
    <main class="shell"><button id="behind">Behind</button></main>
    <section id="first-use-disclosure" role="dialog" aria-modal="true" hidden>
      <button id="accept-first-use-disclosure" type="button">Accept</button>
      <p id="first-use-disclosure-status" role="status"></p>
    </section>
  `;
});

describe("first-use disclosure UI", () => {
  it("blocks the popup until the current disclosure is accepted", async () => {
    const accept = vi.fn(async () => undefined);
    const onAccepted = vi.fn();
    const ui = createFirstUseDisclosureUi({
      document,
      loadAccepted: vi.fn(async () => false),
      accept,
      onAccepted,
      failureMessage: "Could not save your choice.",
    });

    await ui.initialize();

    const disclosure = document.getElementById("first-use-disclosure");
    const shell = document.querySelector<HTMLElement>(".shell");
    const button = document.getElementById(
      "accept-first-use-disclosure",
    ) as HTMLButtonElement;
    expect(disclosure?.hidden).toBe(false);
    expect(shell?.inert).toBe(true);
    expect(document.activeElement).toBe(button);

    button.click();
    await vi.waitFor(() => expect(accept).toHaveBeenCalledOnce());
    expect(disclosure?.hidden).toBe(true);
    expect(shell?.inert).toBe(false);
    expect(onAccepted).toHaveBeenCalledOnce();

    ui.destroy();
  });

  it("does not interrupt returning users who accepted the current disclosure", async () => {
    const ui = createFirstUseDisclosureUi({
      document,
      loadAccepted: vi.fn(async () => true),
      accept: vi.fn(async () => undefined),
      onAccepted: vi.fn(),
      failureMessage: "Could not save your choice.",
    });

    await ui.initialize();

    expect(document.getElementById("first-use-disclosure")?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>(".shell")?.inert).toBe(false);
    ui.destroy();
  });

  it("keeps the disclosure open and announces storage failures", async () => {
    const ui = createFirstUseDisclosureUi({
      document,
      loadAccepted: vi.fn(async () => false),
      accept: vi.fn(async () => {
        throw new Error("storage unavailable");
      }),
      onAccepted: vi.fn(),
      failureMessage: "Could not save your choice.",
    });
    await ui.initialize();

    document.getElementById("accept-first-use-disclosure")?.click();

    await vi.waitFor(() =>
      expect(document.getElementById("first-use-disclosure-status")?.textContent).toBe(
        "Could not save your choice.",
      ),
    );
    expect(document.getElementById("first-use-disclosure")?.hidden).toBe(false);
    ui.destroy();
  });
});
