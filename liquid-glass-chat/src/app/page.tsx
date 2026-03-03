"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type Role = "system" | "user" | "assistant";
type Msg = { role: Role; content: string; at?: string };

type Attach = {
  id: string;
  name: string;
  size: number;
  type: string;
  textPreview?: string;
};

type ChatThread = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Msg[];
};

const MODEL = "gpt-4o-mini";
const SYSTEM =
  "You are a helpful assistant. Be concise, clear, and friendly. Use markdown when helpful.";
const STORAGE_KEY = "liquid_glass_saved_chats_v1";
const MAX_SAVED_CHATS = 30;

function isoNow() {
  return new Date().toISOString();
}
function formatTime(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function prettyBytes(n: number) {
  if (!Number.isFinite(n)) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
function isTextLike(mime: string, name: string) {
  const lower = name.toLowerCase();
  return (
    mime.startsWith("text/") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".md") ||
    lower.endsWith(".csv") ||
    lower.endsWith(".json") ||
    lower.endsWith(".log") ||
    lower.endsWith(".xml") ||
    lower.endsWith(".yaml") ||
    lower.endsWith(".yml")
  );
}
function safeJsonParse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
function makeId() {
  return `chat_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`;
}
function makeTitleFromMessages(msgs: Msg[]) {
  const firstUser = msgs.find((m) => m.role === "user" && m.content.trim());
  const base = firstUser?.content?.trim() || "New chat";
  return base.length > 42 ? base.slice(0, 42) + "…" : base;
}
function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

export default function Page() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [mode, setMode] = useState<"insert" | "chat">("chat");
  const [started, setStarted] = useState(false);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [attachments, setAttachments] = useState<Attach[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Saved chats
  const [savedChats, setSavedChats] = useState<ChatThread[]>([]);
  const [activeChatId, setActiveChatId] = useState<string>(makeId());
  const [chatSearch, setChatSearch] = useState("");

  // Mic (voice input)
  const recognitionRef = useRef<any>(null);
  const [listening, setListening] = useState(false);

  function startDictation() {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("Speech recognition not supported. Use Chrome/Edge.");
      return;
    }

    if (!recognitionRef.current) {
      const rec = new SpeechRecognition();
      rec.lang = "en-US";
      rec.interimResults = true;
      rec.continuous = false;

      rec.onstart = () => setListening(true);
      rec.onend = () => setListening(false);
      rec.onerror = () => setListening(false);

      rec.onresult = (event: any) => {
        let transcript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        setInput((prev) => (prev ? prev + " " : "") + transcript.trim());
      };

      recognitionRef.current = rec;
    }

    try {
      recognitionRef.current.start();
    } catch {}
  }

  function stopDictation() {
    try {
      recognitionRef.current?.stop();
    } catch {}
  }

  // Load saved chats after mount
  useEffect(() => {
    if (!mounted) return;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? safeJsonParse<ChatThread[]>(raw, []) : [];
    parsed.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    setSavedChats(parsed);
  }, [mounted]);

  // Persist saved chats
  useEffect(() => {
    if (!mounted) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(savedChats.slice(0, MAX_SAVED_CHATS)));
  }, [mounted, savedChats]);

  function archiveCurrentChatIfNeeded() {
    const meaningful = messages.some((m) => m.role !== "system" && m.content.trim());
    if (!meaningful) return;

    const now = isoNow();
    const title = makeTitleFromMessages(messages);

    setSavedChats((prev) => {
      const existingIdx = prev.findIndex((c) => c.id === activeChatId);
      const thread: ChatThread = {
        id: activeChatId,
        title,
        createdAt: existingIdx >= 0 ? prev[existingIdx].createdAt : now,
        updatedAt: now,
        messages,
      };

      let next = [...prev];
      if (existingIdx >= 0) next.splice(existingIdx, 1);
      next = [thread, ...next];
      return next.slice(0, MAX_SAVED_CHATS);
    });
  }

  function openChat(id: string) {
    const thread = savedChats.find((c) => c.id === id);
    if (!thread) return;

    setError(null);
    setBusy(false);
    setAttachments([]);
    setInput("");
    setActiveChatId(thread.id);
    setMessages(thread.messages);
    setStarted(true);
    setMode("chat");
  }

  function deleteChat(id: string) {
    setSavedChats((prev) => prev.filter((c) => c.id !== id));
    if (id === activeChatId) {
      const nid = makeId();
      setActiveChatId(nid);
      setMessages([]);
      setStarted(false);
      setMode("chat");
      setAttachments([]);
      setInput("");
      setError(null);
      setBusy(false);
    }
  }

  function newChat() {
  archiveCurrentChatIfNeeded();

  setError(null);
  setInput("");
  setBusy(false);
  setMessages([]);
  setAttachments([]);

  // ✅ important: go back to HOME so you see the home page + sidebar
  setStarted(false);
  setMode("chat");

  // ✅ start a brand new thread id
  setActiveChatId(makeId());

  // optional: clear home search
  setChatSearch("");
}

  // Auto-save (debounced)
  useEffect(() => {
    if (!mounted) return;
    const meaningful = messages.some((m) => m.role !== "system" && m.content.trim());
    if (!meaningful) return;

    const t = window.setTimeout(() => {
      const now = isoNow();
      const title = makeTitleFromMessages(messages);

      setSavedChats((prev) => {
        const existingIdx = prev.findIndex((c) => c.id === activeChatId);
        const thread: ChatThread = {
          id: activeChatId,
          title,
          createdAt: existingIdx >= 0 ? prev[existingIdx].createdAt : now,
          updatedAt: now,
          messages,
        };

        let next = [...prev];
        if (existingIdx >= 0) next.splice(existingIdx, 1);
        next = [thread, ...next];
        return next.slice(0, MAX_SAVED_CHATS);
      });
    }, 600);

    return () => window.clearTimeout(t);
  }, [mounted, messages, activeChatId]);

  // Chat scroll
  const chatRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = chatRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const visibleMessages = useMemo(() => messages.filter((m) => m.role !== "system"), [messages]);

  // Files
  async function onPickFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    const list = Array.from(files);
    const next: Attach[] = [];

    for (const f of list) {
      const id = `${f.name}-${f.size}-${f.lastModified}-${Math.random().toString(16).slice(2)}`;
      const a: Attach = { id, name: f.name, size: f.size, type: f.type || "application/octet-stream" };

      if (isTextLike(a.type, a.name) && f.size <= 250_000) {
        try {
          const text = await f.text();
          a.textPreview = text.slice(0, 12_000);
        } catch {}
      }
      next.push(a);
    }

    setAttachments((prev) => [...prev, ...next]);
    if (fileRef.current) fileRef.current.value = "";
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  function openFilePicker() {
    fileRef.current?.click();
  }

  // Eyes logo (oval, cursor reactive + blink)
  const eyesWrapRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const [blink, setBlink] = useState(false);

  function doBlink(ms = 140) {
    setBlink(true);
    window.setTimeout(() => setBlink(false), ms);
  }

  useEffect(() => {
    if (!mounted) return;
    let alive = true;
    const loop = () => {
      if (!alive) return;
      const next = 1500 + Math.random() * 2600;
      window.setTimeout(() => {
        if (!alive) return;
        doBlink(120 + Math.random() * 110);
        loop();
      }, next);
    };
    loop();
    return () => {
      alive = false;
    };
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    const onMove = (e: MouseEvent) => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const el = eyesWrapRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const dx = (e.clientX - cx) / (r.width / 2);
        const dy = (e.clientY - cy) / (r.height / 2);
        setGaze({ x: clamp(dx, -1, 1), y: clamp(dy, -1, 1) });
      });
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove as any);
  }, [mounted]);

  function OvalEyesLogo({ size = 102 }: { size?: number }) {
    const pupilMaxX = Math.round(size * 0.12);
    const pupilMaxY = Math.round(size * 0.07);
    const px = Math.round(gaze.x * pupilMaxX);
    const py = Math.round(gaze.y * pupilMaxY);

    return (
      <div
        ref={eyesWrapRef}
        aria-hidden="true"
        onMouseDown={() => doBlink(150)}
        style={{
          width: size,
          height: size,
          borderRadius: 999,
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 18px 55px rgba(0,0,0,0.10)",
          border: "1px solid rgba(0,0,0,0.06)",
          overflow: "hidden",
          background:
            "radial-gradient(circle at 30% 28%, rgba(255,255,255,0.95), rgba(255,255,255,0.55) 28%, rgba(255,255,255,0.18) 60%, rgba(255,255,255,0.08))",
          userSelect: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: -2,
            background: `radial-gradient(220px 180px at ${(gaze.x * 30 + 50).toFixed(1)}% ${(gaze.y * 30 + 50).toFixed(
              1
            )}%,
              rgba(255,255,255,0.70),
              rgba(255,255,255,0.14) 45%,
              rgba(255,255,255,0.02) 75%)`,
            mixBlendMode: "screen",
            opacity: 0.95,
            pointerEvents: "none",
            transition: "background 90ms linear",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 10,
            borderRadius: 999,
            border: "1px solid rgba(0,0,0,0.08)",
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.35)",
            opacity: 0.75,
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            width: Math.round(size * 0.88),
            height: Math.round(size * 0.46),
            borderRadius: 999,
            background: "rgba(255,255,255,0.86)",
            border: "1px solid rgba(0,0,0,0.07)",
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: Math.round(size * 0.10),
            position: "relative",
            zIndex: 2,
          }}
        >
          {Array.from({ length: 2 }).map((_, idx) => (
            <div
              key={idx}
              style={{
                width: Math.round(size * 0.31),
                height: Math.round(size * 0.20),
                borderRadius: 999,
                background:
                  "radial-gradient(ellipse at 35% 35%, rgba(255,255,255,0.98), rgba(255,255,255,0.78) 48%, rgba(0,0,0,0.05) 84%, rgba(0,0,0,0.09))",
                border: "1px solid rgba(0,0,0,0.09)",
                boxShadow: "0 10px 18px rgba(0,0,0,0.08), inset 0 -6px 10px rgba(0,0,0,0.04)",
                overflow: "hidden",
                position: "relative",
                transformOrigin: "center",
                transform: blink ? "scaleY(0.08)" : "scaleY(1)",
                transition: "transform 125ms ease",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: -6,
                  right: -6,
                  top: -6,
                  height: "55%",
                  borderRadius: 999,
                  background: "linear-gradient(to bottom, rgba(255,255,255,0.55), rgba(255,255,255,0.06))",
                  pointerEvents: "none",
                  opacity: blink ? 0.15 : 0.35,
                  transition: "opacity 120ms ease",
                }}
              />
              <div
                style={{
                  width: Math.round(size * 0.10),
                  height: Math.round(size * 0.085),
                  borderRadius: 999,
                  background: "rgba(10,12,16,0.90)",
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  transform: `translate(calc(-50% + ${px}px), calc(-50% + ${py}px))`,
                  transition: "transform 90ms ease",
                  boxShadow: "inset 0 0 0 2px rgba(255,255,255,0.10), 0 6px 14px rgba(0,0,0,0.14)",
                }}
              />
              <div
                style={{
                  width: Math.round(size * 0.035),
                  height: Math.round(size * 0.035),
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.92)",
                  position: "absolute",
                  left: "42%",
                  top: "38%",
                  transform: "translate(-50%,-50%)",
                  opacity: blink ? 0 : 0.95,
                  transition: "opacity 120ms ease",
                }}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  async function send(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (!text || busy) return;

    setError(null);
    setInput("");
    setBusy(true);
    setStarted(true);
    doBlink(120);

    const attachmentContext = attachments
      .map((a) => {
        const header = `File: ${a.name} (${prettyBytes(a.size)})`;
        if (a.textPreview) return `${header}\n---\n${a.textPreview}\n---`;
        return `${header}\n[Attached: ${a.type}. Not ingested in this demo without backend processing.]`;
      })
      .join("\n\n");

    const userContent =
      attachmentContext.length > 0
        ? `User message:\n${text}\n\nAttached files context:\n${attachmentContext}`
        : text;

    setMessages((prev) => [
      ...prev,
      { role: "user", content: text, at: isoNow() },
      { role: "assistant", content: "", at: isoNow() },
    ]);

    try {
      const payloadMsgs = [
        { role: "system" as const, content: SYSTEM },
        ...messages.map(({ role, content }) => ({ role, content })),
        { role: "user" as const, content: userContent },
      ];

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payloadMsgs, model: MODEL }),
      });

      if (!res.ok || !res.body) {
        const t = await res.text().catch(() => "");
        throw new Error(`API error (${res.status}): ${t || res.statusText}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        assistantText += decoder.decode(value, { stream: true });

        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant") {
            copy[copy.length - 1] = { ...last, content: assistantText };
          }
          return copy;
        });
      }

      setAttachments([]);

      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant" && !last.content.trim()) {
          copy[copy.length - 1] = { ...last, content: "(No content returned.)" };
        }
        return copy;
      });
    } catch (e: any) {
      const msg = e?.message || "Something went wrong.";
      setError(msg);

      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant" && !last.content) {
          copy[copy.length - 1] = { ...last, content: `⚠️ ${msg}` };
        }
        return copy;
      });
    } finally {
      setBusy(false);
    }
  }

  const filteredChats = useMemo(() => {
    const q = chatSearch.trim().toLowerCase();
    if (!q) return savedChats;
    return savedChats.filter((c) => c.title.toLowerCase().includes(q));
  }, [savedChats, chatSearch]);

  // ---------- HOME VIEW with left sidebar ONLY ----------
  if (!started) {
    const placeholder = "Ask anything";

    return (
      <div style={{ minHeight: "100vh", display: "grid", gridTemplateColumns: "280px 1fr" }}>
        {/* Home sidebar only */}
        <aside
          style={{
            borderRight: "1px solid rgba(0,0,0,0.06)",
            background: "rgba(255,255,255,0.55)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            padding: 16,
            position: "sticky",
            top: 0,
            height: "100vh",
            overflow: "auto",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 6px 14px 6px" }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 10,
                border: "1px solid rgba(0,0,0,0.08)",
                background: "rgba(255,255,255,0.75)",
                display: "grid",
                placeItems: "center",
              }}
            >
              ✳️
            </div>
            <div style={{ fontWeight: 700, fontSize: 14, color: "rgba(0,0,0,0.82)" }}>Chat</div>
          </div>

          <button
            type="button"
            onClick={newChat}
            style={{
              width: "100%",
              display: "flex",
              gap: 10,
              alignItems: "center",
              justifyContent: "flex-start",
              padding: "10px 12px",
              borderRadius: 14,
              border: "1px solid rgba(0,0,0,0.10)",
              background: "rgba(255,255,255,0.78)",
              cursor: "pointer",
              boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
              fontWeight: 600,
            }}
          >
            ✍️ <span>New chat</span>
          </button>

          <div
            style={{
              marginTop: 12,
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              borderRadius: 14,
              border: "1px solid rgba(0,0,0,0.08)",
              background: "rgba(255,255,255,0.70)",
            }}
          >
            🔎
            <input
              value={chatSearch}
              onChange={(e) => setChatSearch(e.target.value)}
              placeholder="Search chats"
              style={{
                border: "none",
                outline: "none",
                background: "transparent",
                width: "100%",
                fontSize: 13,
              }}
            />
          </div>

          <div style={{ marginTop: 14, fontSize: 12, color: "rgba(0,0,0,0.55)", padding: "0 6px" }}>
            Recent chats
          </div>

          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            {mounted && filteredChats.length === 0 ? (
              <div style={{ padding: 10, fontSize: 12, color: "rgba(0,0,0,0.45)" }}>No chats yet.</div>
            ) : null}

            {mounted
              ? filteredChats.slice(0, 18).map((c) => (
                  <div
                    key={c.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 12px",
                      borderRadius: 14,
                      border: "1px solid rgba(0,0,0,0.08)",
                      background: "rgba(255,255,255,0.72)",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => openChat(c.id)}
                      style={{
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                        textAlign: "left",
                        padding: 0,
                        flex: 1,
                        minWidth: 0,
                      }}
                      title={c.title}
                    >
                      <div
                        style={{
                          fontSize: 13,
                          color: "rgba(0,0,0,0.82)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {c.title}
                      </div>
                      <div style={{ fontSize: 11, color: "rgba(0,0,0,0.45)", marginTop: 2 }}>
                        {new Date(c.updatedAt).toLocaleString()}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => deleteChat(c.id)}
                      style={{
                        border: "1px solid rgba(0,0,0,0.12)",
                        background: "rgba(0,0,0,0.04)",
                        borderRadius: 12,
                        padding: "6px 8px",
                        cursor: "pointer",
                      }}
                      aria-label={`Delete ${c.title}`}
                      title="Delete"
                    >
                      🗑️
                    </button>
                  </div>
                ))
              : null}
          </div>

          {mounted && savedChats.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                if (!confirm("Clear all saved chats?")) return;
                setSavedChats([]);
              }}
              style={{
                marginTop: 14,
                width: "100%",
                borderRadius: 14,
                border: "1px solid rgba(0,0,0,0.10)",
                background: "rgba(255,255,255,0.65)",
                padding: "10px 12px",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Clear all
            </button>
          ) : null}
        </aside>

        {/* MAIN home UI (kept) */}
        <main className="page" style={{ padding: 0 }}>
          <div className="glass home">
            <input
              ref={fileRef}
              type="file"
              multiple
              onChange={(e) => onPickFiles(e.target.files)}
              style={{ display: "none" }}
            />

            <div className="logoWrap">
              <OvalEyesLogo size={102} />
              <div className="brandTitle">ChatGPT</div>
            </div>

            <div className="modeRow">
              <div className="pills">
                <button
                  className={`pillBtn ${mode === "insert" ? "active" : ""}`}
                  onClick={() => {
                    setMode("insert");
                    openFilePicker();
                  }}
                  type="button"
                >
                  ➕ Insert Files
                </button>

                <button
                  className={`pillBtn ${mode === "chat" ? "active" : ""}`}
                  onClick={() => setMode("chat")}
                  type="button"
                >
                  ✨ Chat
                </button>
              </div>
            </div>

            {/* ✅ KEEP your old bigSearch structure; mic is overlay only */}
            <div style={{ position: "relative", width: "min(720px, 100%)" }}>
              <div className="bigSearch">
                <div className="bigIcon" aria-hidden="true">
                  💬
                </div>

                <input
                  className="bigInput"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={placeholder}
                  disabled={busy}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      send();
                    }
                  }}
                />

                <button className="goBtn" onClick={() => send()} disabled={busy} type="button" aria-label="Send">
                  →
                </button>
              </div>

              {/* Mic overlay */}
              <button
                type="button"
                onMouseDown={startDictation}
                onMouseUp={stopDictation}
                onMouseLeave={stopDictation}
                aria-label="Voice input"
                title="Voice input"
                style={{
                  position: "absolute",
                  right: 64,
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: 42,
                  height: 42,
                  borderRadius: 999,
                  border: "1px solid rgba(0,0,0,0.10)",
                  background: "rgba(255,255,255,0.78)",
                  display: "grid",
                  placeItems: "center",
                  cursor: "pointer",
                  boxShadow: "0 10px 26px rgba(0,0,0,0.08)",
                }}
              >
                {listening ? "🎙️" : "🎤"}
              </button>
            </div>

            {attachments.length > 0 ? (
              <div style={{ width: "min(720px, 100%)", marginTop: 10, display: "flex", flexWrap: "wrap", gap: 10 }}>
                {attachments.map((a) => (
                  <div
                    key={a.id}
                    className="glass"
                    style={{
                      padding: "10px 12px",
                      borderRadius: 14,
                      border: "1px solid rgba(0,0,0,0.10)",
                      background: "rgba(255,255,255,0.82)",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      boxShadow: "var(--shadow2)",
                    }}
                  >
                    <span style={{ fontSize: 13, color: "rgba(0,0,0,0.75)" }}>
                      {a.name} <span style={{ color: "rgba(0,0,0,0.45)" }}>• {prettyBytes(a.size)}</span>
                    </span>
                    <button
                      onClick={() => removeAttachment(a.id)}
                      type="button"
                      style={{
                        border: "1px solid rgba(0,0,0,0.12)",
                        background: "rgba(0,0,0,0.04)",
                        borderRadius: 10,
                        padding: "4px 8px",
                        cursor: "pointer",
                      }}
                      aria-label={`Remove ${a.name}`}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="miniHint">ChatGPT can make mistakes. Check important info.</div>
          </div>
        </main>
      </div>
    );
  }

  // ---------- CHAT VIEW (unchanged, no sidebar) ----------
  return (
    <div className="page">
      <input
        ref={fileRef}
        type="file"
        multiple
        onChange={(e) => onPickFiles(e.target.files)}
        style={{ display: "none" }}
      />

      <div className="glass chatShell">
        <div className="chatTop">
          <div className="chatTitle">
            <span aria-hidden="true">💬</span>
            <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
              <b>ChatGPT</b>
              <span>Streaming responses</span>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button className="smallBtn" onClick={openFilePicker} type="button">
              ➕ Insert Files
            </button>
            <button className="smallBtn" onClick={newChat} type="button">
              New chat
            </button>
          </div>
        </div>

        {attachments.length > 0 ? (
          <div style={{ padding: "12px 18px", display: "flex", flexWrap: "wrap", gap: 10 }}>
            {attachments.map((a) => (
              <div
                key={a.id}
                style={{
                  padding: "8px 10px",
                  borderRadius: 14,
                  border: "1px solid rgba(0,0,0,0.10)",
                  background: "rgba(255,255,255,0.85)",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span style={{ fontSize: 13, color: "rgba(0,0,0,0.75)" }}>
                  {a.name} <span style={{ color: "rgba(0,0,0,0.45)" }}>• {prettyBytes(a.size)}</span>
                </span>
                <button
                  onClick={() => removeAttachment(a.id)}
                  type="button"
                  style={{
                    border: "1px solid rgba(0,0,0,0.12)",
                    background: "rgba(0,0,0,0.04)",
                    borderRadius: 10,
                    padding: "3px 7px",
                    cursor: "pointer",
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="chatArea" ref={chatRef}>
          {visibleMessages.map((m, i) => {
            const isMe = m.role === "user";
            return (
              <div key={i} className={`row ${isMe ? "me" : "ai"}`}>
                <div className={`bubble ${isMe ? "me" : "ai"}`}>
                  {m.content}
                  {busy && i === visibleMessages.length - 1 && m.role === "assistant" ? (
                    <span className="cursor">▍</span>
                  ) : null}
                  <div className="meta">
                    {isMe ? "You" : "Assistant"} • {mounted ? formatTime(m.at) : ""}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {error ? <div className="error">{error}</div> : null}

        <div className="composer">
          <div className="composerInner">
            <textarea
              className="textarea"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Message…"
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button className="sendBtn" onClick={() => send()} disabled={busy} type="button">
              {busy ? "Streaming…" : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}