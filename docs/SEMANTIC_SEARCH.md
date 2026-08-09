# Optional semantic search

Bookmark X can complement its instant lexical search with local multilingual
embeddings. The feature is optional, disabled by default, and designed so that
bookmark content never crosses a network boundary.

## Consent and network boundary

The **Download and enable** button is the only operation that allows a model
download. It records a device-local consent timestamp and starts a dedicated
module Web Worker. Normal searches use cached files only and set Transformers.js
to local-only mode.

The extension package contains all executable code:

- `@huggingface/transformers` 4.2.0 (Apache-2.0), pinned in `pnpm-lock.yaml`;
- `onnxruntime-web` `1.26.0-dev.20260416-b7804b056c`, pinned transitively and
  directly so its local WASM assets are deterministic;
- the asyncify WASM binary and factory module emitted by Vite into the ZIP.

Only model data is remote. `Xenova/multilingual-e5-small` is pinned to revision
`761b726dd34fb83930e26aab4e9ac3899aa1fa78`; its upstream
`intfloat/multilingual-e5-small` model card declares the MIT license. The q8 ONNX
weights are 118,308,185 bytes and the tokenizer is 17,082,730 bytes, for about
135.4 MB before small configuration files and cache overhead.

## Local indexing and ranking

Each document passage includes post text, author, private note, tag names, and
the complete folder breadcrumb. The E5-required `passage:` and `query:` prefixes
are added locally. Mean-pooled 384-dimensional vectors are normalized and stored
in a dedicated IndexedDB database. A SHA-256 fingerprint avoids re-embedding
unchanged posts, and one update transaction prevents partial index changes when
an inference batch fails.

At query time, cosine similarity produces the semantic ranking. Bookmark X
combines that list with the existing lexical ranking through Reciprocal Rank
Fusion (RRF) with stable tie-breaking. If consent is absent, cache files are
missing, the browser is offline, or inference fails, the semantic client returns
no ranking and the lexical result is displayed unchanged.

## Execution and storage

WebGPU is attempted first. Session creation failures fall back to the packaged
WASM runtime with one thread, keeping inference off the popup's main thread. The
packaged runtime adds about 24 MB unpacked (roughly 6 MB compressed) to the
extension. Vectors use 1,536 bytes per post, plus bookmark snapshots, keys, and
IndexedDB overhead.

The `unlimitedStorage` permission covers IndexedDB and Cache Storage quota, but
the user's free disk space remains the real limit. The options page displays
the browser's current storage estimate.

## Lifecycle and limitations

- **Cancel** terminates the Worker, which aborts an in-flight fetch or inference.
- **Reindex saved posts** compares fingerprints and embeds only changed records.
- **Remove model and index** clears the dedicated Cache Storage entry, vectors,
  lifecycle state, and consent.
- JSON backup intentionally excludes weights, embeddings, and device consent.
- The model truncates input after 512 tokens, and low-resource languages may
  have lower retrieval quality.
- First indexing is compute-intensive; time scales with post count and varies
  widely by GPU, CPU, memory pressure, and browser support.
- WebGPU availability does not guarantee model-session support, which is why the
  local WASM fallback remains packaged and tested.
