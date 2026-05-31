import { Globe, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { postVerifySite } from "../api/client";
import type { SiteVerificationResponse } from "../types";

const sampleSite = "secure-wallet-bonus.xyz/login";

export function VerifyPage() {
  const [siteUrl, setSiteUrl] = useState(sampleSite);
  const [result, setResult] = useState<SiteVerificationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function verify(url: string) {
    setLoading(true);
    setError(null);
    try {
      const data = await postVerifySite(url);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "驗證失敗");
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void verify(siteUrl);
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-semibold tracking-[0.14em] text-cyan-200 uppercase">網站驗證</p>
        <h1 className="mt-2 text-3xl font-bold">真假網站檢查</h1>
        <p className="mt-1 max-w-[60ch] text-sm leading-7 text-slate-300/80">
          綜合 SSRF 防護、Google Safe Browsing、PhishTank/OpenPhish feed、規則式啟發判斷,給出風險判斷。
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="rounded-3xl border border-white/10 bg-[linear-gradient(180deg,rgba(26,37,56,0.96)_0%,rgba(15,23,38,0.98)_100%)] p-6"
      >
        <label className="block text-sm font-semibold text-slate-200">輸入對方提供的網站</label>
        <input
          value={siteUrl}
          onChange={(e) => setSiteUrl(e.target.value)}
          placeholder="例如:secure-wallet-bonus.xyz/login"
          className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-3 text-base text-white outline-none focus:border-cyan-300/35"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={loading || !siteUrl.trim()}
            className="inline-flex items-center gap-2 rounded-full bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-60"
          >
            <Globe className="h-4 w-4" />
            {loading ? "驗證中..." : "驗證網站"}
          </button>
          <button
            type="button"
            onClick={() => {
              setSiteUrl(sampleSite);
              void verify(sampleSite);
            }}
            className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/6 px-4 py-2 text-sm font-semibold text-white hover:bg-white/12"
          >
            範例網址
          </button>
        </div>
      </form>

      {error ? (
        <div className="rounded-2xl border border-rose-300/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
      ) : null}

      {result ? <VerificationResult result={result} /> : null}
    </div>
  );
}

function VerificationResult({ result }: { result: SiteVerificationResponse }) {
  const tone =
    result.verdict === "danger"
      ? "border-rose-300/25 bg-rose-500/10 text-rose-100"
      : result.verdict === "warning"
        ? "border-amber-300/25 bg-amber-500/10 text-amber-100"
        : "border-emerald-300/25 bg-emerald-500/10 text-emerald-100";

  const label = result.verdict === "danger" ? "高風險網站" : result.verdict === "warning" ? "可疑網站" : "暫無明顯異常";
  const content = result.signals.content;

  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <div className={`rounded-3xl border p-6 ${tone}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs tracking-[0.16em] uppercase">{label}</p>
            <p className="mt-2 break-all text-sm leading-6 opacity-90">{result.normalizedUrl}</p>
          </div>
          <div className="text-right">
            <p className="text-xs tracking-[0.14em] uppercase">Risk</p>
            <p className="text-3xl font-bold">{result.riskScore}</p>
          </div>
        </div>
        <p className="mt-4 text-sm leading-7">{result.summary}</p>

        {content?.fetched ? (
          <div className="mt-5 space-y-2 rounded-2xl border border-white/15 bg-black/15 p-4 text-xs leading-6">
            <p className="text-[11px] tracking-[0.14em] uppercase opacity-80">擷取的網站內容</p>
            {content.title ? (
              <p><span className="opacity-70">Title:</span> {content.title}</p>
            ) : null}
            {content.description ? (
              <p><span className="opacity-70">描述:</span> {content.description}</p>
            ) : null}
            {content.lang ? (
              <p><span className="opacity-70">語言:</span> {content.lang}</p>
            ) : null}
            {content.llmVerdict ? (
              <p className="mt-2 rounded-xl bg-white/8 px-3 py-2">
                <span className="font-semibold">LLM 判讀({content.llmVerdict.verdict}):</span>{" "}
                {content.llmVerdict.reason}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="rounded-3xl border border-white/10 bg-slate-950/40 p-6">
        <p className="text-sm font-semibold text-cyan-100">判斷依據</p>
        <ul className="mt-3 space-y-2 text-sm leading-7 text-slate-200/88">
          {result.reasons.length === 0 ? (
            <li>- 沒有特別命中的高風險信號。</li>
          ) : (
            result.reasons.map((reason, idx) => <li key={idx}>- {reason}</li>)
          )}
        </ul>

        {content?.fetched && content.categories.length > 0 ? (
          <div className="mt-5">
            <p className="text-xs font-semibold tracking-[0.14em] text-cyan-100 uppercase">內容類別</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {content.categories.map((cat) => (
                <span
                  key={cat.category}
                  className="rounded-full border border-rose-300/30 bg-rose-500/15 px-3 py-1 text-xs text-rose-100"
                  title={cat.matches.join("、")}
                >
                  {cat.label}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {content?.fetched && content.suspiciousFormFields.length > 0 ? (
          <div className="mt-4">
            <p className="text-xs font-semibold tracking-[0.14em] text-amber-100 uppercase">高敏感表單欄位</p>
            <ul className="mt-2 space-y-1 text-xs text-amber-100/90">
              {content.suspiciousFormFields.map((f, idx) => (
                <li key={idx}>· {f}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-5 grid grid-cols-2 gap-3 text-xs">
          <SignalChip label="HTTPS" ok={result.signals.https} />
          <SignalChip label="無 punycode" ok={!result.signals.punycode} />
          <SignalChip label="非 IP 主機" ok={!result.signals.rawIpHost} />
          <SignalChip label="SSRF 安全" ok={!result.signals.ssrfBlocked} />
          <SignalChip label="未列釣魚 Feed" ok={!result.signals.phishingFeed.matched} />
          <SignalChip label="Safe Browsing 乾淨" ok={result.signals.safeBrowsing.length === 0} />
          <SignalChip
            label="內容已擷取"
            ok={Boolean(content?.fetched)}
          />
          <SignalChip
            label="無敏感表單欄位"
            ok={!content?.suspiciousFormFields.length}
          />
        </div>

        {result.signals.phishingFeed.matched ? (
          <p className="mt-3 text-xs text-rose-200">
            ⚠️ 命中釣魚清單(來源:{result.signals.phishingFeed.source})
          </p>
        ) : null}
        {result.signals.safeBrowsing.length > 0 ? (
          <p className="mt-2 text-xs text-rose-200">
            ⚠️ Safe Browsing 標記:{result.signals.safeBrowsing.map((t) => t.threatType).join(", ")}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function SignalChip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${
        ok ? "bg-emerald-500/10 text-emerald-100" : "bg-rose-500/15 text-rose-100"
      }`}
    >
      <ShieldCheck className="h-3 w-3" />
      {label}
    </span>
  );
}
