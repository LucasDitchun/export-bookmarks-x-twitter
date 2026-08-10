# Third-party notices

Bookmark X distributes the browser-compatible portions of the following
third-party software and model data. The complete corresponding license texts
are included in `THIRD_PARTY_LICENSES/` and in every release ZIP.

## @huggingface/transformers 4.2.0

- Project: Transformers.js
- Source: https://github.com/huggingface/transformers.js
- License: Apache License 2.0
- Complete text: `THIRD_PARTY_LICENSES/huggingface-transformers-Apache-2.0.txt`

## onnxruntime-web 1.26.0-dev.20260416-b7804b056c

- Project: ONNX Runtime Web
- Source: https://github.com/microsoft/onnxruntime
- License: MIT
- Complete text: `THIRD_PARTY_LICENSES/onnxruntime-web-MIT.txt`

## Xenova/multilingual-e5-small

- Upstream model: `intfloat/multilingual-e5-small`
- Distribution: https://huggingface.co/Xenova/multilingual-e5-small
- Pinned revision: `761b726dd34fb83930e26aab4e9ac3899aa1fa78`
- License: MIT, as declared by the upstream model card
- License text source: `microsoft/unilm` (the upstream E5 implementation)
- Complete text: `THIRD_PARTY_LICENSES/multilingual-e5-small-MIT.txt`

## Build-only software

sharp and libvips are Node-only build dependencies. They are not loaded by the
extension and neither their binaries nor their package trees are included in
the browser ZIP.
