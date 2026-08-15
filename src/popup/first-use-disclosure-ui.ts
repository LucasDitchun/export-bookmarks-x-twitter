interface FirstUseDisclosureUiOptions {
  document: Document;
  loadAccepted(): Promise<boolean>;
  accept(): Promise<void>;
  onAccepted(): void;
  failureMessage: string;
}

export interface FirstUseDisclosureUi {
  initialize(): Promise<void>;
  destroy(): void;
}

function requiredElement<T extends HTMLElement>(document: Document, id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing first-use disclosure element: ${id}`);
  return element as T;
}

export function createFirstUseDisclosureUi(
  options: FirstUseDisclosureUiOptions,
): FirstUseDisclosureUi {
  const disclosure = requiredElement<HTMLElement>(
    options.document,
    "first-use-disclosure",
  );
  const acceptButton = requiredElement<HTMLButtonElement>(
    options.document,
    "accept-first-use-disclosure",
  );
  const status = requiredElement<HTMLElement>(
    options.document,
    "first-use-disclosure-status",
  );
  const shell = options.document.querySelector<HTMLElement>(".shell");
  let destroyed = false;

  const hide = (): void => {
    disclosure.hidden = true;
    if (shell) shell.inert = false;
  };
  const show = (): void => {
    disclosure.hidden = false;
    if (shell) shell.inert = true;
    acceptButton.focus();
  };
  const onAccept = (): void => {
    if (destroyed || acceptButton.disabled) return;
    status.textContent = "";
    acceptButton.disabled = true;
    void options
      .accept()
      .then(() => {
        if (destroyed) return;
        hide();
        options.onAccepted();
      })
      .catch(() => {
        if (destroyed) return;
        status.textContent = options.failureMessage;
      })
      .finally(() => {
        if (!destroyed) acceptButton.disabled = false;
      });
  };
  acceptButton.addEventListener("click", onAccept);

  return {
    async initialize() {
      const accepted = await options.loadAccepted().catch(() => false);
      if (destroyed) return;
      if (accepted) hide();
      else show();
    },
    destroy() {
      destroyed = true;
      acceptButton.removeEventListener("click", onAccept);
      if (shell) shell.inert = false;
    },
  };
}
