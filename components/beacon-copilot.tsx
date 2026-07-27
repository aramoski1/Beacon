"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2, Send, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { askCopilot, type CopilotMessage } from "@/app/copilot/actions";

// ─── Markdown renderer ────────────────────────────────────────────────────────

function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**")
      ? <strong key={i}>{p.slice(2, -2)}</strong>
      : p
  );
}

function MarkdownText({ text }: { text: string }) {
  const paragraphs = text.split(/\n\n+/);
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {paragraphs.map((para, pi) => {
        const lines = para.split("\n");
        const isBullet = lines.some((l) => /^[-*]\s/.test(l.trimStart()));
        const isOrdered = lines.some((l) => /^\d+\.\s/.test(l.trimStart()));

        if (isBullet) {
          return (
            <ul key={pi} className="list-disc pl-4 space-y-0.5">
              {lines.map((l, li) => {
                const m = l.trimStart().match(/^[-*]\s+(.*)/);
                if (!m) return null;
                return <li key={li}>{renderInline(m[1])}</li>;
              })}
            </ul>
          );
        }

        if (isOrdered) {
          return (
            <ol key={pi} className="list-decimal pl-4 space-y-0.5">
              {lines.map((l, li) => {
                const m = l.trimStart().match(/^\d+\.\s+(.*)/);
                if (!m) return null;
                return <li key={li}>{renderInline(m[1])}</li>;
              })}
            </ol>
          );
        }

        return (
          <p key={pi}>
            {lines.map((l, li) => (
              <span key={li}>
                {renderInline(l)}
                {li < lines.length - 1 && <br />}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

// ─── Example prompts ──────────────────────────────────────────────────────────

const EXAMPLES = [
  "What should I focus on today?",
  "Which leases expire in the next 90 days?",
  "Who haven't I contacted in over 60 days?",
  "Show me all industrial properties over 50k SF",
  "Summarize my active deals",
  "How do I import a lease abstract?",
];

// ─── BeaconCopilot ────────────────────────────────────────────────────────────

export function BeaconCopilot() {
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, thinking]);

  async function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || thinking) return;

    const userMsg: CopilotMessage = { role: "user", content: trimmed };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setInput("");
    setThinking(true);
    setError(null);

    const result = await askCopilot(nextHistory);
    setThinking(false);

    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.reply) {
      setMessages([...nextHistory, { role: "assistant", content: result.reply }]);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submit(input);
  }

  const hasMessages = messages.length > 0;

  return (
    <div className="w-full space-y-2">
      {/* Conversation panel — only shown when active */}
      {hasMessages && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
            <div className="flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-primary" />
              <span className="text-xs font-semibold text-foreground">Beacon Copilot</span>
            </div>
            <button
              type="button"
              onClick={() => { setMessages([]); setError(null); setInput(""); }}
              className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
              aria-label="Clear conversation"
            >
              <X className="size-3.5" />
            </button>
          </div>

          {/* Messages */}
          <div className="max-h-[22rem] overflow-y-auto px-3 py-3 space-y-4">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={cn(
                  "flex gap-2",
                  msg.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                {msg.role === "assistant" && (
                  <div className="shrink-0 mt-0.5 size-5 rounded-full bg-primary/10 flex items-center justify-center">
                    <Sparkles className="size-3 text-primary" />
                  </div>
                )}
                <div
                  className={cn(
                    "max-w-[85%] rounded-lg px-3 py-2",
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground text-sm"
                      : "bg-muted/50 text-foreground"
                  )}
                >
                  {msg.role === "assistant" ? (
                    <MarkdownText text={msg.content} />
                  ) : (
                    <p className="text-sm">{msg.content}</p>
                  )}
                </div>
              </div>
            ))}

            {thinking && (
              <div className="flex gap-2 justify-start">
                <div className="shrink-0 mt-0.5 size-5 rounded-full bg-primary/10 flex items-center justify-center">
                  <Sparkles className="size-3 text-primary" />
                </div>
                <div className="bg-muted/50 rounded-lg px-3 py-2 flex items-center gap-1.5">
                  <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Thinking…</span>
                </div>
              </div>
            )}

            {error && !thinking && (
              <p className="text-xs text-destructive px-1">{error}</p>
            )}

            <div ref={bottomRef} />
          </div>

          <p className="px-3 py-1.5 border-t text-[10px] text-muted-foreground bg-muted/20">
            AI-generated from your CRM data — verify before relying on it.
          </p>
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="relative">
        {!hasMessages && (
          <Sparkles className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        )}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={hasMessages ? "Ask a follow-up…" : "Ask Beacon Copilot anything…"}
          disabled={thinking}
          className={cn(
            "w-full rounded-lg border border-border bg-background py-2.5 text-sm outline-none focus:ring-2 ring-ring placeholder:text-muted-foreground/60 disabled:opacity-60",
            hasMessages ? "pl-3 pr-24" : "pl-9 pr-24"
          )}
        />
        <button
          type="submit"
          disabled={thinking || !input.trim()}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
        >
          {thinking ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Send className="size-3.5" />
          )}
          Ask
        </button>
      </form>

      {/* Example chips — only when no conversation */}
      {!hasMessages && (
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => submit(ex)}
              disabled={thinking}
              className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40"
            >
              {ex}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
