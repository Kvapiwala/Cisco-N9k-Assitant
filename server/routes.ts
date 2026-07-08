import { Router } from "express";
import multer from "multer";
import OpenAI, { toFile } from "openai";
import fs from "fs";
import path from "path";
import { Device, Link, getTopology, setTopology, topologyDescription } from "./topology";

const configPath = path.resolve(process.cwd(), "config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as {
  app_name: string;
  assistant_name: string;
  assistant_instructions: string;
  welcome_message: string;
  model: string;
  vector_store_id: string;
};

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY environment variable is not set");
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

export const router = Router();

const STARTER_QUESTIONS = [
  "I have a p2p topology: SW1 Ethernet1/1 connects to SW2 Ethernet1/1",
  "I have a spine-leaf fabric with 2 spines and 3 leafs",
  "Configure a VLAN 100 trunk on the link between my switches",
  "One of my links is down — help me debug and fix it",
];

router.get("/config", (_req, res) => {
  res.json({
    appName: config.app_name,
    assistantName: config.assistant_name,
    welcomeMessage: config.welcome_message,
    model: config.model,
    starterQuestions: STARTER_QUESTIONS,
  });
});

router.get("/topology", (_req, res) => {
  res.json(getTopology());
});

router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file provided" });
    }
    const file = await client.files.create({
      file: await toFile(req.file.buffer, req.file.originalname),
      purpose: "assistants",
    });
    res.json({ fileId: file.id, filename: req.file.originalname });
  } catch (err: any) {
    console.error("Upload error:", err);
    res.status(500).json({ error: err?.message ?? "Upload failed" });
  }
});

const TOPOLOGY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    changed: { type: "boolean" },
    devices: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          role: {
            type: "string",
            enum: ["spine", "leaf", "switch", "router", "firewall", "host"],
          },
          model: { type: "string" },
          mgmtIp: { type: "string" },
          interfaces: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string" },
                description: { type: "string" },
                status: { type: "string", enum: ["up", "down"] },
                connectedToDevice: { type: ["string", "null"] },
                connectedToInterface: { type: ["string", "null"] },
              },
              required: [
                "name",
                "description",
                "status",
                "connectedToDevice",
                "connectedToInterface",
              ],
            },
          },
        },
        required: ["id", "name", "role", "model", "mgmtIp", "interfaces"],
      },
    },
    links: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          aDevice: { type: "string" },
          aInterface: { type: "string" },
          bDevice: { type: "string" },
          bInterface: { type: "string" },
        },
        required: ["aDevice", "aInterface", "bDevice", "bInterface"],
      },
    },
  },
  required: ["changed", "devices", "links"],
} as const;

// Monotonic sequencing so a slow extraction from an older message can never
// overwrite topology committed by a newer message.
let extractionSeq = 0;
let lastAppliedSeq = 0;

async function extractTopology(userMessage: string): Promise<{ devices: Device[]; links: Link[] } | null> {
  const seq = ++extractionSeq;
  const current = getTopology();
  const response = await client.responses.create({
    model: config.model,
    instructions:
      "You maintain the network topology model for a Cisco Nexus 9000 assistant. You are given the CURRENT TOPOLOGY as JSON and a USER MESSAGE. Decide whether the message defines, extends, or modifies the network topology (devices, switches, routers, links, interfaces, interface status). If it does, return changed=true and the COMPLETE updated topology (carry over existing devices unless the user replaced or removed them). If the message is not about topology structure (e.g. asking for configuration commands, debugging help, general questions), return changed=false with empty devices and links.\n\nRules:\n- Device ids: short lowercase alphanumeric (sw1, spine1, leaf2).\n- Names: uppercase display names (SW-1, SPINE-1) unless the user names them.\n- Use Cisco N9K interface naming (Ethernet1/1, Ethernet1/2, ...). If the user gives a topology without interface details (e.g. 'p2p topology with 2 switches'), invent sensible interfaces for the links.\n- Every link endpoint must reference an existing device id and one of its interface names, and the two endpoint interfaces must reference each other via connectedToDevice/connectedToInterface.\n- model: a plausible Nexus 9000 model (e.g. N9K-C93180YC-FX3) unless the user specifies one. mgmtIp: keep existing or use empty string if unknown.\n- Interface status defaults to 'up' unless the user says it is down/broken.",
    input: `CURRENT TOPOLOGY:\n${JSON.stringify(current)}\n\nUSER MESSAGE:\n${userMessage}`,
    text: {
      format: {
        type: "json_schema",
        name: "topology_update",
        strict: true,
        schema: TOPOLOGY_SCHEMA as any,
      },
    },
  });

  const parsed = JSON.parse(response.output_text);
  if (!parsed.changed || !Array.isArray(parsed.devices) || parsed.devices.length === 0) {
    return null;
  }

  const devices: Device[] = parsed.devices.map((d: any) => ({
    id: d.id,
    name: d.name,
    role: d.role,
    model: d.model,
    mgmtIp: d.mgmtIp,
    interfaces: (d.interfaces ?? []).map((i: any) => ({
      id: `${d.id}:${i.name}`,
      name: i.name,
      description: i.description,
      status: i.status === "down" ? "down" : "up",
      connectedTo:
        i.connectedToDevice && i.connectedToInterface
          ? { device: i.connectedToDevice, iface: i.connectedToInterface }
          : undefined,
    })),
  }));

  const deviceIds = new Set(devices.map((d) => d.id));
  const links: Link[] = (parsed.links ?? [])
    .filter((l: any) => deviceIds.has(l.aDevice) && deviceIds.has(l.bDevice))
    .map((l: any, idx: number) => ({
      id: `l${idx + 1}`,
      a: { device: l.aDevice, iface: l.aInterface },
      b: { device: l.bDevice, iface: l.bInterface },
    }));

  if (seq < lastAppliedSeq) {
    // A newer message already committed a topology; discard this stale result.
    return null;
  }
  lastAppliedSeq = seq;
  setTopology(devices, links);
  return getTopology();
}

interface ChatBody {
  message: string;
  previousResponseId?: string;
  deviceId?: string;
  fileIds?: { fileId: string; filename: string }[];
}

router.post("/chat", async (req, res) => {
  const { message, previousResponseId, deviceId, fileIds } = req.body as ChatBody;
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "message is required" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Run topology extraction concurrently with the chat stream. When the user
  // describes their network, the sidebar/diagram update from this result.
  const topologyPromise = extractTopology(message)
    .then((t) => {
      if (t) send("topology", t);
    })
    .catch((err) => {
      console.error("Topology extraction error:", err);
    });

  try {
    const { devices } = getTopology();
    const device = deviceId ? devices.find((d) => d.id === deviceId) : undefined;

    let instructions = config.assistant_instructions;
    instructions += "\n\n" + topologyDescription();
    if (device) {
      instructions += `\n\nThe user is currently working in the CLI session of device ${device.name} (${device.model}${device.mgmtIp ? `, mgmt ${device.mgmtIp}` : ""}). Focus your configurations and debugging on this device unless the user asks about others.`;
    }

    const vectorStoreIds = [config.vector_store_id];

    // Attach uploaded documents to this user turn so file_search can use them
    // alongside the existing corpus vector store.
    let input: any;
    if (fileIds && fileIds.length > 0) {
      const contents: any[] = fileIds.map((f) => ({ type: "input_file", file_id: f.fileId }));
      contents.push({ type: "input_text", text: message });
      input = [{ role: "user", content: contents }];
    } else {
      input = message;
    }

    const stream = await client.responses.create({
      model: config.model,
      instructions,
      input,
      tools: [{ type: "file_search", vector_store_ids: vectorStoreIds }],
      ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
      stream: true,
    });

    const citations: { filename: string; fileId?: string; index: number }[] = [];

    for await (const event of stream as any) {
      if (event.type === "response.output_text.delta") {
        send("delta", { text: event.delta });
      } else if (event.type === "response.output_text.annotation.added") {
        const ann = event.annotation;
        if (ann?.type === "file_citation") {
          citations.push({
            filename: ann.filename ?? "Unknown source",
            fileId: ann.file_id,
            index: citations.length,
          });
          send("citation", citations[citations.length - 1]);
        }
      } else if (event.type === "response.completed") {
        const response = event.response;
        // Collect any annotations missed during streaming
        for (const item of response.output ?? []) {
          if (item.type === "message") {
            for (const content of item.content ?? []) {
              for (const ann of content.annotations ?? []) {
                if (
                  ann.type === "file_citation" &&
                  !citations.some((c) => c.filename === ann.filename && c.fileId === ann.file_id)
                ) {
                  citations.push({
                    filename: ann.filename ?? "Unknown source",
                    fileId: ann.file_id,
                    index: citations.length,
                  });
                }
              }
            }
          }
        }
        // Make sure any topology update is delivered before the stream closes.
        await topologyPromise;
        send("done", { responseId: response.id, citations });
      } else if (event.type === "response.failed" || event.type === "error") {
        const msg =
          event.response?.error?.message ?? event.message ?? "The model failed to respond";
        send("error", { error: msg });
      }
    }
  } catch (err: any) {
    console.error("Chat error:", err);
    send("error", { error: err?.message ?? "Something went wrong" });
  } finally {
    await topologyPromise;
    res.end();
  }
});
