import { useEffect, useState } from "react";
import { BellRing, X } from "lucide-react";
import { useSnapshot } from "../context/SnapshotContext";

export function CrawlToast() {
  const { lastCrawlEvent } = useSnapshot();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!lastCrawlEvent) return;
    if (lastCrawlEvent.inserted === 0 && lastCrawlEvent.updated === 0) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 8000);
    return () => clearTimeout(t);
  }, [lastCrawlEvent]);

  if (!visible || !lastCrawlEvent) return null;

  const { inserted, updated, bySource } = lastCrawlEvent;
  const sourceLines = Object.entries(bySource)
    .filter(([, v]) => v.inserted > 0 || v.updated > 0)
    .map(([name, v]) => `${name}: +${v.inserted}${v.updated ? ` / 更新 ${v.updated}` : ""}`);

  return (
    <div className="pointer-events-auto fixed right-6 bottom-24 z-40 w-[320px] rounded-2xl border border-cyan-300/30 bg-slate-900/95 p-4 text-sm shadow-[0_18px_40px_rgba(2,8,23,0.45)] backdrop-blur">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full bg-cyan-400/15 text-cyan-200">
          <BellRing className="h-4 w-4" />
        </span>
        <div className="flex-1">
          <p className="font-semibold text-cyan-100">
            爬蟲同步完成 · 新增 {inserted} 篇
            {updated > 0 ? ` · 更新 ${updated}` : ""}
          </p>
          {sourceLines.length > 0 ? (
            <ul className="mt-1.5 space-y-0.5 text-xs text-slate-300/85">
              {sourceLines.map((line, i) => (
                <li key={i}>· {line}</li>
              ))}
            </ul>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setVisible(false)}
          className="rounded-full p-1 text-slate-400 transition hover:bg-white/8 hover:text-slate-200"
          aria-label="關閉"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
