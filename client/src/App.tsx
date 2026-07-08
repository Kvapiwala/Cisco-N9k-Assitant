import { useState, useEffect, useRef } from "react";
import { fetchConfig, fetchTopology, AppConfig, NetDevice, NetLink, NetInterface, streamChat, Citation, UploadedFile, uploadFile } from "./lib/api";
import { Terminal, Network, AlertCircle, FileText, X, Send, Paperclip, ChevronRight, ChevronDown, CheckCircle2, XCircle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { cn } from "./lib/utils";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  files?: UploadedFile[];
  isStreaming?: boolean;
};

type Conversation = {
  messages: Message[];
  previousResponseId?: string;
};

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [topology, setTopology] = useState<{ devices: NetDevice[]; links: NetLink[] } | null>(null);
  const [activeSession, setActiveSession] = useState<string>("fabric"); // "fabric" or deviceId
  
  // Conversations mapping: session ID -> Conversation
  const [conversations, setConversations] = useState<Record<string, Conversation>>({});
  const [selectedInterface, setSelectedInterface] = useState<{device: NetDevice, iface: NetInterface} | null>(null);
  const [pendingAsk, setPendingAsk] = useState<string | null>(null);

  useEffect(() => {
    fetchConfig().then(setConfig).catch(console.error);
    fetchTopology().then(setTopology).catch(console.error);
  }, []);

  if (!config || !topology) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-primary font-mono text-xl">
        <div className="flex flex-col items-center gap-4">
          <Network className="w-12 h-12 animate-pulse" />
          Loading N9K Fabric State...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-background text-foreground overflow-hidden">
      <Sidebar 
        topology={topology} 
        activeSession={activeSession} 
        setActiveSession={setActiveSession} 
      />
      <main className="flex-1 flex flex-col h-screen overflow-hidden border-r border-border">
        <ChatWindow 
          key={activeSession}
          config={config}
          deviceId={activeSession === "fabric" ? undefined : activeSession}
          conversation={conversations[activeSession] || { messages: [] }}
          setConversation={(updater) => setConversations(prev => ({
            ...prev,
            [activeSession]: typeof updater === 'function' ? updater(prev[activeSession] || { messages: [] }) : updater
          }))}
          deviceName={activeSession === "fabric" ? "Global Fabric" : topology.devices.find(d => d.id === activeSession)?.name}
          pendingAsk={pendingAsk}
          clearPendingAsk={() => setPendingAsk(null)}
        />
      </main>
      <aside className="w-[400px] h-screen bg-card flex flex-col overflow-y-auto">
        <TopologyView 
          topology={topology} 
          onSelectInterface={(device, iface) => setSelectedInterface({device, iface})} 
        />
        {selectedInterface && (
          <InterfaceDetail 
            device={selectedInterface.device} 
            iface={selectedInterface.iface} 
            onClose={() => setSelectedInterface(null)}
            onAsk={(q) => {
              setActiveSession(selectedInterface.device.id);
              setPendingAsk(q);
            }}
            allConversations={conversations}
          />
        )}
      </aside>
    </div>
  );
}

function Sidebar({ topology, activeSession, setActiveSession }: { 
  topology: { devices: NetDevice[] }, 
  activeSession: string, 
  setActiveSession: (id: string) => void 
}) {
  const spines = topology.devices.filter(d => d.role === "spine");
  const leafs = topology.devices.filter(d => d.role === "leaf");

  const NavItem = ({ id, name, icon: Icon }: { id: string, name: string, icon: any }) => (
    <button
      onClick={() => setActiveSession(id)}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-2 text-sm text-left transition-colors font-mono",
        activeSession === id ? "bg-primary/20 text-primary border-r-2 border-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
      )}
    >
      <Icon className="w-4 h-4" />
      {name}
    </button>
  );

  return (
    <div className="w-64 h-screen bg-card border-r border-border flex flex-col">
      <div className="p-4 border-b border-border">
        <h1 className="font-bold text-primary font-mono flex items-center gap-2">
          <Terminal className="w-5 h-5" />
          N9K Assistant
        </h1>
      </div>
      
      <div className="flex-1 overflow-y-auto py-4">
        <div className="px-4 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Scope</div>
        <NavItem id="fabric" name="Global Fabric" icon={Network} />
        
        <div className="px-4 mt-6 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Spines</div>
        {spines.map(d => <NavItem key={d.id} id={d.id} name={d.name} icon={Terminal} />)}
        
        <div className="px-4 mt-6 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Leafs</div>
        {leafs.map(d => <NavItem key={d.id} id={d.id} name={d.name} icon={Terminal} />)}
      </div>
    </div>
  );
}

function ChatWindow({ 
  config, 
  deviceId, 
  conversation, 
  setConversation,
  deviceName,
  pendingAsk,
  clearPendingAsk
}: { 
  config: AppConfig, 
  deviceId?: string, 
  conversation: Conversation, 
  setConversation: React.Dispatch<React.SetStateAction<Conversation>>,
  deviceName?: string,
  pendingAsk?: string | null,
  clearPendingAsk?: () => void
}) {
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [isSending, setIsSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // A session is busy if we're mid-send or any of its messages is still streaming.
  const isStreaming = conversation.messages.some(m => m.isStreaming);
  const busy = isSending || isStreaming;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation.messages]);

  useEffect(() => {
    if (pendingAsk && !busy) {
      clearPendingAsk?.();
      handleSend(pendingAsk);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAsk, busy]);

  const handleSend = async (text: string) => {
    if (!text.trim() && files.length === 0) return;
    if (isSending) return;
    
    setIsSending(true);
    let uploaded: UploadedFile[] = [];
    
    if (files.length > 0) {
      for (const f of files) {
        const up = await uploadFile(f).catch(e => { console.error(e); return null; });
        if (up) uploaded.push(up);
      }
    }

    const userMsg: Message = { id: Date.now().toString(), role: "user", content: text, files: uploaded };
    setConversation(prev => ({ ...prev, messages: [...prev.messages, userMsg] }));
    setInput("");
    setFiles([]);

    const assistantMsgId = (Date.now() + 1).toString();
    setConversation(prev => ({ 
      ...prev, 
      messages: [...prev.messages, { id: assistantMsgId, role: "assistant", content: "", isStreaming: true, citations: [] }] 
    }));

    streamChat({
      message: text,
      deviceId,
      previousResponseId: conversation.previousResponseId,
      fileIds: uploaded.length > 0 ? uploaded : undefined
    }, {
      onDelta: (delta) => {
        setConversation(prev => ({
          ...prev,
          messages: prev.messages.map(m => m.id === assistantMsgId ? { ...m, content: m.content + delta } : m)
        }));
      },
      onCitation: (citation) => {
        setConversation(prev => ({
          ...prev,
          messages: prev.messages.map(m => m.id === assistantMsgId ? { ...m, citations: [...(m.citations || []), citation] } : m)
        }));
      },
      onDone: ({ responseId, citations }) => {
        setConversation(prev => ({
          ...prev,
          previousResponseId: responseId,
          messages: prev.messages.map(m => m.id === assistantMsgId ? { ...m, isStreaming: false, citations } : m)
        }));
        setIsSending(false);
      },
      onError: (err) => {
        console.error("Chat error:", err);
        setConversation(prev => ({
          ...prev,
          messages: prev.messages.map(m => m.id === assistantMsgId ? { ...m, isStreaming: false, content: m.content + `\n\n**Error:** ${err}` } : m)
        }));
        setIsSending(false);
      }
    });
  };

  return (
    <div className="flex flex-col h-full bg-background relative">
      <div className="px-6 py-3 border-b border-border bg-card flex justify-between items-center">
        <h2 className="font-mono text-primary font-semibold">{deviceName} Session</h2>
        <span className="text-xs text-muted-foreground font-mono">Assisted by {config.assistantName}</span>
      </div>
      
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {conversation.messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Terminal className="w-8 h-8 text-primary" />
            </div>
            <div>
              <h3 className="text-2xl font-mono text-foreground mb-2">{config.welcomeMessage}</h3>
              <p className="text-muted-foreground">Connected to {deviceName}. Ask me anything about configuration, status, or debugging.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full">
              {config.starterQuestions.map((q, i) => (
                <button 
                  key={i}
                  onClick={() => handleSend(q)}
                  className="p-3 text-left border border-border rounded bg-secondary/50 hover:bg-secondary hover:border-primary transition-colors text-sm"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {conversation.messages.map(m => (
          <div key={m.id} className={cn("flex gap-4", m.role === "user" ? "justify-end" : "justify-start")}>
            {m.role === "assistant" && (
              <div className="w-8 h-8 shrink-0 rounded bg-primary/20 flex items-center justify-center">
                <Terminal className="w-4 h-4 text-primary" />
              </div>
            )}
            <div className={cn(
              "max-w-[80%] rounded px-4 py-3",
              m.role === "user" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"
            )}>
              {m.files && m.files.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {m.files.map(f => (
                    <span key={f.fileId} className="flex items-center gap-1 text-xs bg-black/20 px-2 py-1 rounded">
                      <FileText className="w-3 h-3" /> {f.filename}
                    </span>
                  ))}
                </div>
              )}
              <div className="prose prose-invert prose-p:leading-relaxed prose-pre:bg-background prose-pre:border prose-pre:border-border max-w-none text-sm">
                <ReactMarkdown>{m.content || (m.isStreaming ? "..." : "")}</ReactMarkdown>
              </div>
              {m.citations && m.citations.length > 0 && (
                <CitationList citations={m.citations} />
              )}
            </div>
            {m.role === "user" && (
               <div className="w-8 h-8 shrink-0 rounded bg-muted flex items-center justify-center font-bold text-xs">
                 ME
               </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="p-4 border-t border-border bg-card">
        {files.length > 0 && (
          <div className="flex gap-2 mb-2">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-1 text-xs bg-secondary px-2 py-1 rounded">
                {f.name}
                <button onClick={() => setFiles(fs => fs.filter((_, idx) => idx !== i))} className="hover:text-destructive">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 relative">
          <label className="cursor-pointer p-2 hover:bg-secondary rounded transition-colors text-muted-foreground">
            <Paperclip className="w-5 h-5" />
            <input type="file" className="hidden" multiple onChange={(e) => {
              if (e.target.files) setFiles(prev => [...prev, ...Array.from(e.target.files!)]);
            }} />
          </label>
          <input 
            type="text" 
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(input); } }}
            disabled={busy}
            placeholder={`Message ${deviceName}...`}
            className="flex-1 bg-secondary border border-border rounded-md px-4 py-2 text-sm focus:outline-none focus:border-primary font-mono transition-colors"
          />
          <button 
            onClick={() => handleSend(input)}
            disabled={busy || (!input.trim() && files.length === 0)}
            className="p-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function CitationList({ citations }: { citations: Citation[] }) {
  const [expanded, setExpanded] = useState(false);
  const unique = citations.filter(
    (c, i) => citations.findIndex(x => x.filename === c.filename) === i
  );

  return (
    <div className="mt-4 pt-3 border-t border-border/50">
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-primary transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        References ({unique.length})
      </button>
      {expanded && (
        <div className="mt-2 space-y-1 animate-in fade-in slide-in-from-top-1 duration-200">
          {unique.map((c, i) => (
            <div
              key={i}
              className="text-xs bg-background border border-border px-2 py-1.5 rounded text-muted-foreground flex items-center gap-2"
            >
              <FileText className="w-3 h-3 shrink-0 text-primary" />
              <span className="font-mono truncate">{c.filename}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TopologyView({ topology, onSelectInterface }: { topology: { devices: NetDevice[], links: NetLink[] }, onSelectInterface: (d: NetDevice, i: NetInterface) => void }) {
  const spines = topology.devices.filter(d => d.role === "spine");
  const leafs = topology.devices.filter(d => d.role === "leaf");

  return (
    <div className="p-6 border-b border-border flex-1">
      <h3 className="font-mono text-sm font-semibold mb-6 flex items-center gap-2">
        <Network className="w-4 h-4" /> Fabric Topology
      </h3>
      
      <div className="space-y-8">
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground font-mono uppercase text-center tracking-widest">Spine Layer</div>
          <div className="flex justify-center gap-6">
            {spines.map(d => (
              <DeviceNode key={d.id} device={d} onSelectInterface={onSelectInterface} />
            ))}
          </div>
        </div>
        
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground font-mono uppercase text-center tracking-widest">Leaf Layer</div>
          <div className="flex justify-center gap-4 flex-wrap">
            {leafs.map(d => (
              <DeviceNode key={d.id} device={d} onSelectInterface={onSelectInterface} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DeviceNode({ device, onSelectInterface }: { device: NetDevice, onSelectInterface: (d: NetDevice, i: NetInterface) => void }) {
  const hasDown = device.interfaces.some(i => i.status === "down");
  
  return (
    <div className={cn(
      "border rounded-md bg-secondary flex flex-col items-center p-3 transition-colors",
      hasDown ? "border-destructive/50 shadow-[0_0_10px_rgba(226,35,26,0.2)]" : "border-border hover:border-primary/50"
    )}>
      <Terminal className={cn("w-6 h-6 mb-2", hasDown ? "text-destructive" : "text-primary")} />
      <div className="font-mono text-sm font-bold mb-1">{device.name}</div>
      <div className="text-[10px] text-muted-foreground mb-3">{device.mgmtIp}</div>
      
      <div className="flex flex-wrap gap-1 justify-center max-w-[120px]">
        {device.interfaces.filter(i => i.name.startsWith("Ethernet")).map(i => (
          <button 
            key={i.id}
            onClick={() => onSelectInterface(device, i)}
            title={`${i.name}: ${i.description}`}
            className={cn(
              "w-3 h-3 rounded-sm border cursor-pointer hover:scale-125 transition-transform",
              i.status === "up" ? "bg-success border-success-foreground/20" : "bg-destructive border-destructive-foreground/20 animate-pulse"
            )}
          />
        ))}
      </div>
    </div>
  );
}

function InterfaceDetail({ device, iface, onClose, onAsk, allConversations }: { 
  device: NetDevice, 
  iface: NetInterface, 
  onClose: () => void,
  onAsk: (q: string) => void,
  allConversations: Record<string, Conversation>
}) {
  const deviceHistory = allConversations[device.id]?.messages || [];
  const mentionedCommands = deviceHistory
    .filter(m => m.role === "assistant")
    .flatMap(m => {
      const blocks = m.content.match(/```[a-z]*\n([\s\S]*?)```/g) || [];
      return blocks.map(b => b.replace(/```[a-z]*\n/, "").replace(/```/, ""));
    })
    .filter(code => code.includes(iface.name));

  return (
    <div className="h-1/2 border-t border-border bg-card flex flex-col animate-in slide-in-from-bottom-8">
      <div className="px-4 py-3 border-b border-border flex justify-between items-center bg-secondary/50">
        <h4 className="font-mono text-sm font-semibold flex items-center gap-2">
          {device.name} <ChevronRight className="w-3 h-3" /> {iface.name}
        </h4>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>
      
      <div className="p-4 overflow-y-auto space-y-4 flex-1">
        <div className="flex items-center gap-3 bg-background p-3 rounded border border-border">
          {iface.status === "up" ? <CheckCircle2 className="w-5 h-5 text-success" /> : <AlertCircle className="w-5 h-5 text-destructive" />}
          <div>
            <div className="text-sm font-mono uppercase">Status: {iface.status}</div>
            <div className="text-xs text-muted-foreground">{iface.description}</div>
          </div>
        </div>

        {iface.connectedTo && (
          <div className="text-sm border border-border rounded overflow-hidden">
            <div className="bg-secondary px-3 py-1 text-xs font-mono uppercase text-muted-foreground">Connected Peer</div>
            <div className="p-3 bg-background font-mono text-primary">
              {iface.connectedTo.device} &rarr; {iface.connectedTo.iface}
            </div>
          </div>
        )}

        {mentionedCommands.length > 0 && (
          <div className="space-y-2">
             <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Related Configuration</div>
             {mentionedCommands.map((cmd, i) => (
                <pre key={i} className="text-xs bg-background p-2 rounded border border-border overflow-x-auto text-foreground">
                  {cmd.trim()}
                </pre>
             ))}
          </div>
        )}

        <button 
          onClick={() => {
            onAsk(`What is the configuration and status of interface ${iface.name}?`);
            onClose();
          }}
          className="w-full py-2 bg-primary/10 text-primary border border-primary/30 rounded hover:bg-primary hover:text-primary-foreground transition-colors text-sm font-mono"
        >
          Ask Nexus TWO about this interface
        </button>
      </div>
    </div>
  );
}
