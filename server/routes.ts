import { Router } from "express";
import multer from "multer";
import OpenAI, { toFile } from "openai";
import fs from "fs";
import path from "path";
import { devices, links, topologyDescription } from "./topology";

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
  "Configure a VLAN 100 trunk between LEAF-1 and both spines",
  "Set up OSPF on all fabric uplinks with area 0",
  "LEAF-1 Ethernet1/3 is down — help me debug and fix it",
  "Generate a vPC configuration for LEAF-1 and LEAF-2",
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
  res.json({ devices, links });
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

  try {
    const device = deviceId ? devices.find((d) => d.id === deviceId) : undefined;

    let instructions = config.assistant_instructions;
    instructions += "\n\n" + topologyDescription();
    if (device) {
      instructions += `\n\nThe user is currently working in the CLI session of device ${device.name} (${device.model}, mgmt ${device.mgmtIp}). Focus your configurations and debugging on this device unless the user asks about others.`;
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
    res.end();
  }
});
