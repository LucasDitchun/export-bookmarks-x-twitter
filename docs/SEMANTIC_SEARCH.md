# Optional semantic search

Bookmark X can complement its instant lexical search with local multilingual
embeddings. The feature is optional, disabled by default, and designed so that
bookmark content never crosses a network boundary.

## Consent and network boundary

The **Download and enable** button is the only operation that allows a model
download. It records a device-local consent timestamp and starts a dedicated
module Web Worker. Normal searches read the pinned files from Browser Cache and
replace the Transformers.js remote fetch hook with a cache-miss response, so a
missing asset cannot start a network request.

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

## Release-candidate model gate

The manually dispatched **Release train** is the release-candidate boundary. It
runs `pnpm semantic-model:gate`; normal pull-request CI runs only the gate's unit
tests and `--dry-run`, so it never downloads model weights.

The gate downloads the pinned revision into a temporary local filesystem cache.
Every request is a bodyless `GET` for a model asset. Before Transformers.js is
loaded, the cache is verified against the SHA-256 and byte length published by
the Hugging Face model API for that exact revision:

| Asset                       |       Bytes | SHA-256                                                            |
| --------------------------- | ----------: | ------------------------------------------------------------------ |
| `onnx/model_quantized.onnx` | 118,308,185 | `f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193` |
| `tokenizer.json`            |  17,082,730 | `0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39` |

Configuration files are pinned and hashed as well. Inference then switches
Transformers.js to `local_files_only`, disables remote models, and installs a
rejecting fetch handler before any test content is embedded. No query or passage
can leave the runner. The Node gate uses the supported ONNX Runtime CPU backend;
the q8 graph, tokenizer, mean pooling, and normalization match the production
browser pipeline, whose deterministic fallback is WASM.

The real q8 model must produce finite, unit-normalized, 384-dimensional query
and passage embeddings. Eight deterministic retrieval cases cover German,
English, Spanish, French, Italian, Japanese, Brazilian Portuguese, and Simplified
Chinese. In every case, the matching passage must rank first by cosine similarity
with a score margin of at least 0.01 over the runner-up.

The opt-in `pnpm semantic-browser:gate` additionally builds and loads the real
extension in a temporary headless Chrome profile. It verifies that pre-consent
startup creates no semantic cache or index and sends no model request, then
automates explicit consent, downloads the pinned q8 model, indexes a synthetic
three-bookmark corpus, and runs a query whose lexical result is empty. A fresh
popup is put offline to prove cache-only model reuse and retrieval before the
gate removes the model, index, state, and consent. This download is intentionally
excluded from the default test and `smoke:chrome` commands; use
`pnpm semantic-browser:gate:dry-run` to check the opt-in guard without Chrome or
network access.

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

WebGPU is attempted only after `requestAdapter()` returns an adapter. A missing
or rejected adapter goes directly to the packaged WASM runtime. If WebGPU
pipeline creation fails after that preflight, the client retries WASM in a fresh
Worker so the ONNX Runtime singleton is clean. Inference stays off the popup's
main thread and WASM uses one thread. The packaged runtime adds about 24 MB
unpacked (roughly 6 MB compressed) to the extension. Vectors use 1,536 bytes per
post, plus bookmark snapshots, keys, and IndexedDB overhead.

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
