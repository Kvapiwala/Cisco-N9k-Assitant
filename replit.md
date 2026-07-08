# Cisco N9K Assistant

## Overview
A dark, Cisco-themed chat app powered by an OpenAI assistant named "Nexus TWO". It generates per-interface Cisco Nexus 9000 configurations, debugs network problems, and cites the N9K command reference corpus stored in an existing OpenAI vector store.

## Architecture
- **Backend**: Express + TypeScript (`server/`), run with tsx. Serves the API and the Vite dev middleware on port 5000.
  - `GET /api/config` — assistant name, welcome message, starter questions (from `config.json`)
  - `GET /api/topology` — sample spine-leaf fabric (devices, interfaces, links) defined in `server/topology.ts`
  - `POST /api/upload` — uploads a user document to OpenAI (`purpose: "assistants"`), returns `fileId`
  - `POST /api/chat` — SSE stream. Uses the OpenAI **Responses API** (`client.responses.create`) with `file_search` bound to the corpus vector store, `previous_response_id` chaining per conversation, and uploaded files attached as `input_file` content parts.
- **Frontend**: React 18 + Vite + Tailwind CSS v3 (`client/`). API helpers in `client/src/lib/api.ts`.
- **Config**: `config.json` holds `assistant_name`, `assistant_instructions`, `model`, `vector_store_id`. The vector store already contains the corpus — never rebuild or re-upload it.
- **Secrets**: `OPENAI_API_KEY` from environment variables (Replit Secrets). Never hardcoded.

## Key constraints
- Use the Responses API only — no `client.beta.assistants` / `threads` / `runs`.
- Keep the existing vector store attached and unchanged.
- Per-device conversations: each device CLI window keeps its own `previousResponseId` chain (client-side state).

## User preferences
- Dark themed, Cisco-themed UI.
