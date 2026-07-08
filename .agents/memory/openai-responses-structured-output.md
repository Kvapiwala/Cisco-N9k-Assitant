---
name: Responses API structured output syntax
description: Correct parameter shape for JSON-schema structured outputs with client.responses.create
---

The Responses API takes structured output config under `text.format`, not `response_format`:

```ts
text: { format: { type: "json_schema", name: "...", strict: true, schema: {...} } }
```

**Why:** `response_format` is the Chat Completions parameter; using it with `responses.create` fails. With `strict: true`, every property must be in `required` and objects need `additionalProperties: false`; express optional fields as `type: ["string", "null"]`.

**How to apply:** any time this project adds a structured extraction/classification call via `client.responses.create`. Parse the result from `response.output_text`.
