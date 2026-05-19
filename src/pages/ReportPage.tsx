import { CheckCircle2, Flag, Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { fetchReports, postReport } from "../api/client";
import { Markdown } from "../components/Markdown";
import type { AnalysisResponse, UserReportRecord } from "../types";

export function ReportPage() {
  const [message, setMessage] = useState("");
  const [suspectedUrl, setSuspectedUrl] = useState("");
  const [suspectedChannel, setSuspectedChannel] = useState("");
  const [reporterHint, setReporterHint] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{
    report: UserReportRecord;
    analysis: AnalysisResponse | null;
  } | null>(null);
  const [reports, setReports] = useState<UserReportRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadReports();
  }, []);

  async function loadReports() {
    try {
      const data = await fetchReports(20);
      setReports(data.reports);
    } catch {
      /* ignore */
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!message.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      const result = await postReport({
        message: message.trim(),
        suspectedUrl: suspectedUrl.trim() || undefined,
        suspectedChannel: suspectedChannel.trim() || undefined,
        reporterHint: reporterHint.trim() || undefined,
      });
      setSubmitted(result);
      setMessage("");
      setSuspectedUrl("");
      setSuspectedChannel("");
      setReporterHint("");
      void loadReports();
    } catch (e) {
      setError(e instanceof Error ? e.message : "回報失敗");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-semibold tracking-[0.14em] text-cyan-200 uppercase">使用者回報</p>
        <h1 className="mt-2 text-3xl font-bold">回報疑似詐騙案例</h1>
        <p className="mt-1 max-w-[60ch] text-sm leading-7 text-slate-300/80">
          您的回報會儲存於 SQLite,系統會自動跑一次風險分析並記錄結果。
          不會收集任何識別資料,請避免貼上含個資的內容。
        </p>
      </header>

      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-3xl border border-white/10 bg-[linear-gradient(180deg,rgba(26,37,56,0.96)_0%,rgba(15,23,38,0.98)_100%)] p-6"
        >
          <div>
            <label className="text-sm font-semibold text-slate-200">收到的訊息或對話 *</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={6}
              required
              maxLength={4000}
              placeholder="例如:對方在 LINE 自稱投資老師,要求加 Telegram 並匯款 50000 元到指定帳戶..."
              className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-3 text-sm leading-7 text-white outline-none focus:border-cyan-300/35"
            />
            <p className="mt-1 text-right text-xs text-slate-400/80">{message.length} / 4000</p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="text-sm font-semibold text-slate-200">可疑網址(可選)</label>
              <input
                value={suspectedUrl}
                onChange={(e) => setSuspectedUrl(e.target.value)}
                placeholder="https://..."
                className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/35 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/35"
              />
            </div>
            <div>
              <label className="text-sm font-semibold text-slate-200">接觸管道(可選)</label>
              <input
                value={suspectedChannel}
                onChange={(e) => setSuspectedChannel(e.target.value)}
                placeholder="LINE / 簡訊 / 電話 / FB..."
                className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/35 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/35"
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-semibold text-slate-200">補充說明(可選)</label>
            <input
              value={reporterHint}
              onChange={(e) => setReporterHint(e.target.value)}
              placeholder="例如:已轉帳 / 尚未轉帳 / 對方使用的話術..."
              className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/35 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/35"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={submitting || !message.trim()}
              className="inline-flex items-center gap-2 rounded-full bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-60"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flag className="h-4 w-4" />}
              {submitting ? "送出中..." : "送出回報"}
            </button>
            {submitted ? (
              <span className="inline-flex items-center gap-1 text-sm text-emerald-200">
                <CheckCircle2 className="h-4 w-4" />
                已收到回報 (#{submitted.report.id.slice(-6)})
              </span>
            ) : null}
          </div>

          {error ? <p className="rounded-xl border border-rose-300/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">{error}</p> : null}

          {submitted?.analysis ? (
            <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
              <p className="text-sm font-semibold text-cyan-100">系統初步分析</p>
              <p className="mt-1 text-xs text-slate-300">
                風險分數 {submitted.analysis.risk.score} · 等級 {submitted.analysis.risk.level}
              </p>
              <div className="mt-2">
                <Markdown>{submitted.analysis.alert.summary}</Markdown>
              </div>
            </div>
          ) : null}
        </form>

        <aside className="rounded-3xl border border-white/10 bg-slate-950/40 p-6">
          <p className="text-sm font-semibold text-cyan-100">最近的回報</p>
          <div className="mt-3 max-h-[600px] space-y-2 overflow-y-auto pr-1">
            {reports.length === 0 ? (
              <p className="text-xs text-slate-400/85">目前還沒有任何回報。</p>
            ) : (
              reports.map((r) => (
                <div key={r.id} className="rounded-2xl border border-white/8 bg-slate-950/30 p-3">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>#{r.id.slice(-6)}</span>
                    <span>{new Date(r.createdAt).toLocaleString("zh-TW")}</span>
                  </div>
                  <p className="mt-1 line-clamp-3 text-sm text-slate-100">{r.message}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                    {r.riskLevel ? (
                      <span
                        className={`rounded-full px-2 py-0.5 ${
                          r.riskLevel === "high"
                            ? "bg-rose-500/20 text-rose-100"
                            : r.riskLevel === "medium"
                              ? "bg-amber-500/20 text-amber-100"
                              : "bg-emerald-500/20 text-emerald-100"
                        }`}
                      >
                        {r.riskLevel} ({r.riskScore})
                      </span>
                    ) : null}
                    {r.suspectedChannel ? (
                      <span className="rounded-full bg-white/8 px-2 py-0.5 text-slate-200">{r.suspectedChannel}</span>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>
      </section>
    </div>
  );
}
