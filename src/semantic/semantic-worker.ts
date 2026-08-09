/// <reference lib="webworker" />

import { SemanticIndexRepository } from "./semantic-index-repository";
import { TransformersEmbeddingModel } from "./transformers-embedding-model";
import { SemanticWorkerRuntime } from "./semantic-worker-runtime";
import type {
  SemanticWorkerRequest,
  SemanticWorkerResponse,
} from "./semantic-worker-protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;
let activeRequestId = "startup";
let operationQueue: Promise<void> = Promise.resolve();
const runtime = new SemanticWorkerRuntime(
  new TransformersEmbeddingModel(),
  new SemanticIndexRepository(),
  (progress) => {
    const response: SemanticWorkerResponse = {
      kind: "progress",
      requestId: activeRequestId,
      progress,
    };
    scope.postMessage(response);
  },
);

async function execute(request: SemanticWorkerRequest): Promise<unknown> {
  switch (request.type) {
    case "LOAD":
      return runtime.load(request.allowDownload);
    case "SYNC":
      return runtime.synchronize(request.documents);
    case "SEARCH":
      return runtime.search(request.query, request.view, request.limit);
    case "STATS":
      return runtime.stats();
    case "CLEAR":
      return runtime.clear();
    case "DISPOSE":
      return runtime.dispose();
  }
}

scope.addEventListener("message", (event: MessageEvent<SemanticWorkerRequest>) => {
  const request = event.data;
  operationQueue = operationQueue.then(async () => {
    activeRequestId = request.requestId;
    try {
      const data = await execute(request);
      const response: SemanticWorkerResponse = {
        kind: "result",
        requestId: request.requestId,
        ok: true,
        data,
      };
      scope.postMessage(response);
    } catch {
      const response: SemanticWorkerResponse = {
        kind: "result",
        requestId: request.requestId,
        ok: false,
        error: { code: "semantic_worker_failed" },
      };
      scope.postMessage(response);
    }
  });
});
