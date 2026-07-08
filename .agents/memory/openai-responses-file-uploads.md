---
name: OpenAI Responses API file uploads
description: How per-message user uploads combine with an existing file_search vector store in the Responses API
---

Rule: To let a user-uploaded document be searched alongside an existing corpus vector store in the Responses API, upload with `purpose: "assistants"` and attach it to that turn as an `input_file` content part (`{ type: "input_file", file_id }`) next to the `input_text`, while keeping `tools: [{ type: "file_search", vector_store_ids: [corpusId] }]`.

**Why:** Assistants-style `attachments` do not exist in the Responses API, and adding uploads to the corpus vector store would mutate a store that must stay unchanged. `input_file` was verified to work for plain .txt files too (not only PDF) — the model answered from the attached txt while file_search still cited the corpus.

**How to apply:** Any chat app on the Responses API with a fixed reference corpus + per-conversation user uploads. Chain turns with `previous_response_id`; citations arrive as `file_citation` annotations (streaming event `response.output_text.annotation.added` plus the final `response.completed` output).
