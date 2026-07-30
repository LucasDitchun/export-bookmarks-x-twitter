export class BookmarkXError extends Error {
  readonly code: string;
  readonly retryAt: string | null;

  constructor(code: string, message: string, retryAt: string | null = null) {
    super(message);
    this.name = "BookmarkXError";
    this.code = code;
    this.retryAt = retryAt;
  }
}
