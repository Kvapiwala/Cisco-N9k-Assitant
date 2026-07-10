# Cisco N9K Assistant

A dark, Cisco-themed AI assistant that generates Cisco Nexus 9000 configurations, debugs network problems, and manages a live network topology — all through natural language chat.

**Live:** https://cisco-n-9-k-assitant.replit.app

---

## What it does

- **Chat-based configuration** — Ask "Configure a VLAN 100 trunk" or "Debug my down link" and get vendor-accurate Cisco NX-OS commands.
- **Live network topology** — Describe your network (e.g. "2 spines, 3 leafs") and the assistant builds a visual topology map in real time. You can click any interface to inspect status and connections.
- **Dynamic topology editing** — Add, remove, or modify devices by talking to the assistant. Devices group automatically by role (spine, leaf, switch, router, firewall, host).
- **Spine-leaf full-mesh** — When you define a spine-leaf fabric, every leaf is automatically connected to every spine. Visual links render between devices (green for up, red dashed for down).
- **Per-device CLI sessions** — Each device gets its own chat tab. Switch from "Global Fabric" to a specific switch and the assistant knows exactly which device you're configuring.
- **Document uploads** — Drop a PDF/txt/docx into the chat and the assistant searches it alongside the built-in command reference corpus.
- **Expandable citations** — Every answer shows which sources from the N9K command reference corpus were used.

---

## Tech stack

| Layer | Tech |
|---|---|
| Backend | Express + TypeScript (run with `tsx`) |
| Frontend | React 18 + Vite + Tailwind CSS v3 |
| AI | OpenAI **Responses API** (`gpt-4o-mini`) with `file_search` |
| Streaming | Server-Sent Events (SSE) over `client.responses.create({ stream: true })` |
| State | In-memory mutable topology with monotonic version guard |
| Files | Multer uploads → OpenAI `purpose: "assistants"` |

---

## How the topology works

The topology starts **completely empty**. When you send a chat message, a concurrent structured-output call extracts any network description from your prompt. If it defines or changes devices, the server commits the update and pushes it to the client via SSE. The sidebar and diagram update instantly.

Key rules:
- Topology is built from your prompts, not hardcoded.
- Spine-leaf fabrics auto-generate full-mesh cross-layer links.
- Manual remove/clear buttons are protected against stale extraction results (version counter).

---

## Quick start (local)

```bash
npm install
npm run dev        # dev server on port 5000
npm run build      # Vite production build
npm run start      # production server
```

Requires `OPENAI_API_KEY` and a `config.json` with your `vector_store_id`.

---

## Repo

https://github.com/Kvapiwala/Cisco-N9k-Assitant
