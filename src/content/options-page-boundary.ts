export function openOptionsPageSafely(
  openOptionsPage: () => void | Promise<void>,
): void {
  try {
    void Promise.resolve(openOptionsPage()).catch(() => undefined);
  } catch {
    // The extension context may be invalidated while the content script remains.
  }
}
