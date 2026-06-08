import React, { useEffect, useRef, useState } from "react";

/**
 * ChatSidebar
 * -----------
 * Conversational UI for the AskCell agent.
 *
 * - Local message history with alternating "user" / "model" roles.
 * - Auto-scrolls to the newest message.
 * - Disables input while a request is in flight; shows a typing indicator.
 * - Renders **bold** markdown the agent emits for key figures.
 *
 * Props:
 *   apiUrl: string         — backend base URL
 *   datasetReady: boolean  — gate input until a dataset is loaded
 */

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

const SUGGESTIONS = [
  "What is the expression profile of gene CD3D?",
  "Check the expression of MS4A1.",
  "How widely is PDCD1 expressed?",
];

// Minimal, safe markdown: escape HTML, then apply **bold** and line breaks.
function renderMarkdown(text) {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const bolded = escaped.replace(
    /\*\*(.+?)\*\*/g,
    '<strong class="text-emerald-300 font-semibold">$1</strong>'
  );
  return bolded.replace(/\n/g, "<br/>");
}

function MessageBubble({ role, content }) {
  const isUser = role === "user";
  return (
    <div
      className={`flex animate-fade-up ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`max-w-[88%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-indigo-600 text-white"
            : "border border-slate-800 bg-slate-900 text-slate-200"
        }`}
      >
        {isUser ? (
          content
        ) : (
          <span dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
        )}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1.5 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-indigo-400"
            style={{ animationDelay: `${i * 0.18}s` }}
          />
        ))}
      </div>
    </div>
  );
}

export default function ChatSidebar({ datasetReady }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);

  // Auto-scroll to the latest entry.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading]);

  async function sendMessage(text) {
    const trimmed = text.trim();
    if (!trimmed || loading || !datasetReady) return;

    setMessages((m) => [...m, { role: "user", content: trimmed }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Request failed (${res.status})`);
      }

      const data = await res.json();
      setMessages((m) => [...m, { role: "model", content: data.reply }]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: "model", content: `⚠️ ${e.message}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  return (
    <div className="flex h-full flex-col bg-slate-900/40">
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-slate-800 px-5 py-4">
        <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400/60" />
        <h2 className="font-semibold tracking-tight text-slate-100">
          AskCell AI
        </h2>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-widest text-slate-500">
          claude-haiku-4-5
        </span>
      </div>

      {/* Transcript */}
      <div
        ref={scrollRef}
        className="askcell-scroll flex-1 space-y-3 overflow-y-auto px-5 py-4"
      >
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-3 text-3xl">🧬</div>
            <p className="max-w-[240px] text-sm text-slate-400">
              {datasetReady
                ? "Ask about any gene's expression in your loaded dataset."
                : "Upload an .h5ad dataset to start querying gene expression."}
            </p>
            {datasetReady && (
              <div className="mt-5 flex flex-col gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => sendMessage(s)}
                    className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-left text-xs text-slate-300 transition hover:border-indigo-500/50 hover:text-indigo-200"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((m, i) => (
          <MessageBubble key={i} role={m.role} content={m.content} />
        ))}

        {loading && <TypingIndicator />}
      </div>

      {/* Composer */}
      <div className="border-t border-slate-800 p-4">
        <div className="flex items-end gap-2 rounded-xl border border-slate-800 bg-slate-950 p-2 focus-within:border-indigo-500/60">
          <textarea
            rows={1}
            value={input}
            disabled={loading || !datasetReady}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              datasetReady ? "Ask about a gene…" : "Load a dataset first…"
            }
            className="max-h-28 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none disabled:cursor-not-allowed"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={loading || !datasetReady || !input.trim()}
            className="rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
