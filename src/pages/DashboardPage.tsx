import { AlertTriangle, DatabaseZap, Network, SearchCheck, ShieldAlert } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useSnapshot } from "../context/SnapshotContext";
import { postAnalyze } from "../api/client";
import { Markdown } from "../components/Markdown";
import type { AnalysisResponse } from "../types";

const sampleMessage =
  "有人在 LINE 上說可以帶我做虛擬貨幣保證獲利,還要我先匯款到指定帳戶,對方又說因為訂單錯誤要解除分期,這樣安全嗎?";

export function DashboardPage() {
  const { snapshot, loading, error } = useSnapshot();
  const [message, setMessage] = useState(sampleMessage);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  useEffect(() => {
    void analyze(sampleMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function analyze(text: string) {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const data = await postAnalyze(text);
      setAnalysis(data);
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : "分析失敗");
    } finally {
      setAnalyzing(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void analyze(message);
  }

  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(21,33,54,0.92)_0%,rgba(14,23,38,0.94)_100%)] p-7 shadow-[0_24px_80px_rgba(2,8,23,0.45)] sm:p-9">
        <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-5">
            <span className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm font-semibold tracking-[0.18em] text-cyan-200 uppercase">
              <ShieldAlert className="h-4 w-4" />
              Scam Intel Console
            </span>
            <h1 className="text-4xl font-bold leading-[1.08] sm:text-5xl">
              防詐儀表板與對話風險分析
            </h1>
            <p className="max-w-[60ch] text-[1.05rem] leading-8 text-slate-200/86">
              整合 PTT、Google News、165 全民防騙網等來源,持續同步並建立詐騙腳本知識圖譜。
              下方可直接貼上對話進行 RAG 風險分析,或透過右下角的浮動助理隨時提問。
            </p>
            <div className="flex flex-wrap gap-3 text-sm text-slate-200/85">
              <Pill icon={<DatabaseZap className="h-4 w-4" />} label={loading ? "資料載入中" : `${snapshot?.stats.posts ?? 0} 篇案例`} />
              <Pill icon={<Network className="h-4 w-4" />} label={`${snapshot?.stats.nodes ?? 0} 個 KG 節點`} />
              <Pill icon={<SearchCheck className="h-4 w-4" />} label={`${snapshot?.stats.keywords ?? 0} 個風險關鍵詞`} />
              <Pill icon={<DatabaseZap className="h-4 w-4" />} label={`Graph: ${snapshot?.graphStore.provider ?? "memory"}`} />
            </div>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-white/6 p-5 backdrop-blur-sm">
            <p className="text-sm font-semibold tracking-[0.14em] text-cyan-200 uppercase">資料來源狀態</p>
            <div className="mt-4 space-y-3">
              {snapshot?.sources.map((source) => (
                <div key={source.name} className="rounded-2xl border border-white/8 bg-slate-950/30 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold text-slate-100">{source.name}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] tracking-[0.14em] uppercase ${source.live ? "bg-emerald-500/15 text-emerald-100" : "bg-amber-500/15 text-amber-100"}`}
                    >
                      {source.live ? "Live" : "Fallback"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-300/80">{source.postCount} 筆 · {new Date(source.lastUpdated).toLocaleString("zh-TW")}</p>
                  {source.errors.length > 0 ? (
                    <p className="mt-1 text-xs text-amber-100/85">{source.errors.join(" / ")}</p>
                  ) : null}
                </div>
              ))}
            </div>
            {error ? (
              <p className="mt-3 rounded-xl border border-rose-300/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                {error}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(55,69,95,0.94)_0%,rgba(38,50,72,0.95)_100%)] p-6 shadow-[0_20px_50px_rgba(2,8,23,0.28)]">
          <p className="text-sm font-semibold tracking-[0.14em] text-cyan-200 uppercase">最新詐騙腳本</p>
          <h2 className="mt-2 text-2xl font-bold">近期常見手法</h2>
          <div className="mt-5 space-y-3">
            {snapshot?.latestScripts.map((script) => (
              <article key={script.scamType} className="rounded-2xl border border-white/8 bg-slate-950/28 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-white">{script.scamType}</h3>
                  <span className="rounded-full bg-cyan-400/12 px-3 py-0.5 text-[11px] font-semibold tracking-[0.14em] text-cyan-200 uppercase">
                    {script.count} 篇
                  </span>
                </div>
                <p className="mt-2 text-sm leading-7 text-slate-300/88">{script.summary}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(55,69,95,0.94)_0%,rgba(38,50,72,0.95)_100%)] p-6 shadow-[0_20px_50px_rgba(2,8,23,0.28)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold tracking-[0.14em] text-cyan-200 uppercase">LLM + RAG</p>
              <h2 className="mt-2 text-2xl font-bold">對話風險分析</h2>
            </div>
            <RiskBadge level={analysis?.risk.level ?? "low"} score={analysis?.risk.score ?? 0} />
          </div>
          <form className="mt-5 space-y-3" onSubmit={handleSubmit}>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="min-h-[170px] w-full rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-3 text-sm leading-7 text-white outline-none focus:border-cyan-300/35"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={analyzing || !message.trim()}
                className="inline-flex items-center gap-2 rounded-full bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-60"
              >
                <AlertTriangle className="h-4 w-4" />
                {analyzing ? "分析中..." : "開始分析"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMessage(sampleMessage);
                  void analyze(sampleMessage);
                }}
                className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/6 px-4 py-2 text-sm font-semibold text-white hover:bg-white/12"
              >
                範例訊息
              </button>
            </div>
          </form>
          {analyzeError ? (
            <p className="mt-3 rounded-xl border border-rose-300/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
              {analyzeError}
            </p>
          ) : null}
          {analysis ? (
            <div className="mt-5 space-y-4">
              <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
                <p className="text-sm font-semibold text-cyan-100">風險摘要</p>
                <div className="mt-2">
                  <Markdown>{analysis.alert.summary}</Markdown>
                </div>
              </div>
              <div className="rounded-2xl border border-amber-300/20 bg-amber-500/10 p-4">
                <p className="text-sm font-semibold text-amber-100">建議處置</p>
                <ul className="mt-2 space-y-2">
                  {analysis.alert.actions.map((action, idx) => (
                    <li key={idx}>
                      <Markdown>{`- ${action}`}</Markdown>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function Pill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3.5 py-1.5">
      <span className="text-cyan-300">{icon}</span>
      <span>{label}</span>
    </div>
  );
}

function RiskBadge({ level, score }: { level: AnalysisResponse["risk"]["level"]; score: number }) {
  const tone =
    level === "high"
      ? "border-rose-300/25 bg-rose-500/12 text-rose-100"
      : level === "medium"
        ? "border-amber-300/25 bg-amber-500/12 text-amber-100"
        : "border-emerald-300/25 bg-emerald-500/12 text-emerald-100";
  const label = level === "high" ? "高風險" : level === "medium" ? "中風險" : "低風險";
  return (
    <div className={`rounded-2xl border px-4 py-2 text-right ${tone}`}>
      <p className="text-[11px] tracking-[0.14em] uppercase">Risk Score</p>
      <p className="text-xl font-bold">{score}</p>
      <p className="text-xs font-semibold">{label}</p>
    </div>
  );
}
