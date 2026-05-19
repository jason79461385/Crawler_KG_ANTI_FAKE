import { Loader2, MessageCircle, Send, Trash2, X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { postChat } from "../api/client";
import type { ChatMessage } from "../types";
import { Markdown } from "./Markdown";

const STORAGE_KEY = "scam-intel-chat-history";

const WELCOME: ChatMessage = {
  role: "assistant",
  content: [
    "### 👋 你好,我是 **Scam Intel 防詐助理**",
    "",
    "你可以直接貼上:",
    "",
    "- 收到的可疑 **訊息或對話**",
    "- 不確定真假的 **網址**",
    "- 對方提供的 **帳戶 / 平台名稱**",
    "",
    "我會以 Markdown 格式整理出 **風險判斷** 與 **下一步建議**。",
    "",
    "> 💡 提示:點右下角圖示隨時關閉視窗,對話會保留在瀏覽器中。",
  ].join("\n"),
};

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadHistory());
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState<"llm" | "local" | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [open, messages, sending]);

  useEffect(() => {
    if (open) {
      textareaRef.current?.focus();
    }
  }, [open]);

  async function send(content: string) {
    const trimmed = content.trim();
    if (!trimmed || sending) return;

    const next: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setSending(true);

    try {
      const result = await postChat(next);
      setMode(result.mode);
      setMessages([...next, { role: "assistant", content: result.content }]);
    } catch (error) {
      setMessages([
        ...next,
        {
          role: "assistant",
          content: `> ⚠️ 連線失敗:${error instanceof Error ? error.message : "未知錯誤"}`,
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(input);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send(input);
    }
  }

  function reset() {
    setMessages([]);
    setMode(null);
  }

  const visible = messages.length > 0 ? messages : [WELCOME];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={open ? "關閉聊天視窗" : "開啟聊天視窗"}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-sky-500 text-slate-950 shadow-[0_18px_40px_rgba(8,145,178,0.55)] transition hover:scale-105 hover:shadow-[0_22px_50px_rgba(8,145,178,0.65)]"
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </button>

      {open ? (
        <div className="fixed bottom-24 right-6 z-40 flex h-[560px] max-h-[80vh] w-[380px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-3xl border border-white/12 bg-slate-950/95 shadow-[0_30px_80px_rgba(2,8,23,0.6)] backdrop-blur">
          <header className="flex items-center justify-between border-b border-white/8 bg-gradient-to-r from-cyan-500/15 to-sky-500/10 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-white">防詐助理</p>
              <p className="text-xs text-slate-300/85">
                {mode === "llm"
                  ? "LLM 模式"
                  : mode === "local"
                    ? "本地規則模式"
                    : "Markdown 對話"}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={reset}
                className="rounded-full p-2 text-slate-300 transition hover:bg-white/10 hover:text-white"
                title="清空對話"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full p-2 text-slate-300 transition hover:bg-white/10 hover:text-white"
                title="收合"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {visible.map((m, idx) => (
              <div
                key={idx}
                className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm ${
                  m.role === "user"
                    ? "ml-auto bg-cyan-400/15 text-cyan-50"
                    : "mr-auto bg-white/6 text-slate-100"
                }`}
              >
                {m.role === "user" ? (
                  <p className="whitespace-pre-wrap leading-7">{m.content}</p>
                ) : (
                  <Markdown>{m.content}</Markdown>
                )}
              </div>
            ))}
            {sending ? (
              <div className="mr-auto inline-flex items-center gap-2 rounded-2xl bg-white/6 px-3.5 py-2.5 text-sm text-slate-300">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在分析...
              </div>
            ) : null}
          </div>

          <form
            onSubmit={handleSubmit}
            className="border-t border-white/8 bg-slate-950/80 p-3"
          >
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={2}
                placeholder="貼上訊息或網址,Enter 送出 / Shift+Enter 換行"
                className="flex-1 resize-none rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/40"
              />
              <button
                type="submit"
                disabled={!input.trim() || sending}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-400 text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="送出"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}

function loadHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatMessage[];
    return Array.isArray(parsed) ? parsed.slice(-30) : [];
  } catch {
    return [];
  }
}
