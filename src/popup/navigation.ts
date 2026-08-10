export type AppView = "home" | "library" | "detail" | "settings";

interface AppNavigationOptions {
  document: Document;
  onViewChange?: (view: AppView) => void;
}

interface AppNavigation {
  destroy: () => void;
  openDetail: () => void;
  show: (view: Exclude<AppView, "detail">) => void;
}

function isAppView(value: string | undefined): value is AppView {
  return (
    value === "home" ||
    value === "library" ||
    value === "detail" ||
    value === "settings"
  );
}

export function createAppNavigation({
  document,
  onViewChange,
}: AppNavigationOptions): AppNavigation {
  const viewElements = Array.from(
    document.querySelectorAll<HTMLElement>("[data-app-view]"),
  ).filter((element) => isAppView(element.dataset.appView));
  const navigationButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-app-nav]"),
  );
  const backButton = document.querySelector<HTMLButtonElement>("[data-detail-back]");
  let currentView: AppView = "home";

  const render = (view: AppView, focusHeading: boolean): void => {
    currentView = view;
    for (const element of viewElements) {
      element.hidden = element.dataset.appView !== view;
    }

    const primaryView = view === "detail" ? "library" : view;
    for (const button of navigationButtons) {
      if (button.dataset.appNav === primaryView) {
        button.setAttribute("aria-current", "page");
      } else {
        button.removeAttribute("aria-current");
      }
    }

    if (focusHeading) {
      const dashboard = document.querySelector<HTMLElement>(".dashboard");
      if (dashboard) dashboard.scrollTop = 0;
      document
        .querySelector<HTMLElement>(`[data-app-view="${view}"] [data-view-heading]`)
        ?.focus({ preventScroll: true });
    }
    onViewChange?.(view);
  };

  const buttonListeners = new Map<HTMLButtonElement, () => void>();
  for (const button of navigationButtons) {
    const view = button.dataset.appNav;
    if (view !== "home" && view !== "library" && view !== "settings") continue;
    const listener = (): void => render(view, true);
    button.addEventListener("click", listener);
    buttonListeners.set(button, listener);
  }

  const returnToLibrary = (): void => render("library", true);
  const handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && currentView === "detail") returnToLibrary();
  };
  backButton?.addEventListener("click", returnToLibrary);
  document.addEventListener("keydown", handleKeydown);
  render("home", false);

  return {
    show: (view) => render(view, true),
    openDetail: () => render("detail", true),
    destroy: () => {
      for (const [button, listener] of buttonListeners) {
        button.removeEventListener("click", listener);
      }
      backButton?.removeEventListener("click", returnToLibrary);
      document.removeEventListener("keydown", handleKeydown);
    },
  };
}
