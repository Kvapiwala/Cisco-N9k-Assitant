export interface AppConfig {
  appName: string;
  assistantName: string;
  welcomeMessage: string;
  model: string;
  starterQuestions: string[];
}

export interface NetInterface {
  id: string;
  name: string;
  description: string;
  status: "up" | "down";
  connectedTo?: { device: string; iface: string };
}

export interface NetDevice {
  id: string;
  name: string;
  role: string;
  model: string;
  mgmtIp: string;
  interfaces: NetInterface[];
}

export interface Topology {
  devices: NetDevice[];
  links: NetLink[];
}

export interface NetLink {
  id: string;
  a: { device: string; iface: string };
  b: { device: string; iface: string };
}

export interface Citation {
  filename: string;
  fileId?: string;
  index: number;
}

export interface UploadedFile {
  fileId: string;
  filename: string;
}

export async function fetchConfig(): Promise<AppConfig> {
  const res = await fetch("/api/config");
  if (!res.ok) throw new Error("Failed to load config");
  return res.json();
}

export async function fetchTopology(): Promise<Topology> {
  const res = await fetch("/api/topology");
  if (!res.ok) throw new Error("Failed to load topology");
  return res.json();
}

export async function uploadFile(file: File): Promise<UploadedFile> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Upload failed");
  }
  return res.json();
}

export interface StreamHandlers {
  onDelta: (text: string) => void;
  onCitation: (citation: Citation) => void;
  onDone: (payload: { responseId: string; citations: Citation[] }) => void;
  onError: (message: string) => void;
  onTopology?: (topology: Topology) => void;
}

/**
 * Streams a chat turn over SSE. Returns an abort function.
 */
export function streamChat(
  params: {
    message: string;
    previousResponseId?: string;
    deviceId?: string;
    fileIds?: UploadedFile[];
  },
  handlers: StreamHandlers
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        handlers.onError(body.error ?? `Request failed (${res.status})`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          let event = "message";
          let data = "";
          for (const line of chunk.split("\n")) {
            if (line.startsWith("event: ")) event = line.slice(7).trim();
            else if (line.startsWith("data: ")) data += line.slice(6);
          }
          if (!data) continue;
          let parsed: any;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }
          if (event === "delta") handlers.onDelta(parsed.text);
          else if (event === "citation") handlers.onCitation(parsed);
          else if (event === "done") handlers.onDone(parsed);
          else if (event === "error") handlers.onError(parsed.error);
          else if (event === "topology") handlers.onTopology?.(parsed);
        }
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        handlers.onError(err?.message ?? "Connection lost");
      }
    }
  })();

  return () => controller.abort();
}
