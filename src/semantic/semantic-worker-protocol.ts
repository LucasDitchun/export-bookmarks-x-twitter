import type { SemanticSourceDocument } from "../domain/semantic-search";
import type { SearchBookmarkView } from "../domain/search-bookmarks";
import type { SemanticProgress } from "./semantic-worker-runtime";

interface RequestBase {
  requestId: string;
}

export type SemanticWorkerRequest =
  | (RequestBase & { type: "LOAD"; allowDownload: boolean; forceWasm?: boolean })
  | (RequestBase & { type: "SYNC"; documents: SemanticSourceDocument[] })
  | (RequestBase & {
      type: "SEARCH";
      query: string;
      view: SearchBookmarkView;
      limit: number;
    })
  | (RequestBase & { type: "STATS" })
  | (RequestBase & { type: "CLEAR" })
  | (RequestBase & { type: "DISPOSE" });

export type SemanticWorkerResponse =
  | { kind: "progress"; requestId: string; progress: SemanticProgress }
  | {
      kind: "result";
      requestId: string;
      ok: true;
      data: unknown;
    }
  | {
      kind: "result";
      requestId: string;
      ok: false;
      error: { code: string };
    };
