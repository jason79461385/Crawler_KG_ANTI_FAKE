import {
  AlertTriangle,
  DatabaseZap,
  Globe,
  Network,
  RefreshCw,
  SearchCheck,
  ShieldAlert,
} from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { KnowledgeGraphPanel } from "./components/KnowledgeGraphPanel";
import type {
  AnalysisResponse,
  FeedResponse,
  FeedPost,
  GraphResponse,
  SiteVerificationResponse,
  SourceSnapshot,
} from "./types";

const sampleMessage =
  "有人在 LINE 上說可以帶我做虛擬貨幣保證獲利，還要我先匯款到指定帳戶，對方又說因為訂單錯誤要解除分期，這樣安全嗎？";

const sampleSite = "secure-wallet-bonus.xyz/login";

function App() {
  const [snapshot, setSnapshot] = useState<SourceSnapshot | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [feed, setFeed] = useState<FeedPost[]>([]);
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [message, setMessage] = useState(sampleMessage);
  const [siteUrl, setSiteUrl] = useState(sampleSite);
  const [siteResult, setSiteResult] = useState<SiteVerificationResponse | null>(
    null,
  );
  const [loadingSnapshot, setLoadingSnapshot] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [verifyingSite, setVerifyingSite] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void initializeDashboard();
  }, []);

  async function initializeDashboard() {
    await Promise.all([
      loadSnapshot(),
      loadFeed(),
      loadGraph(),
      analyzeMessage(sampleMessage),
      verifySite(sampleSite),
    ]);
  }

  async function loadSnapshot() {
    setLoadingSnapshot(true);
    try {
      const response = await fetch("/api/snapshot");
      if (!response.ok) {
        throw new Error("無法取得系統快照。");
      }

      const data = (await response.json()) as SourceSnapshot;
      setSnapshot(data);
    } finally {
      setLoadingSnapshot(false);
    }
  }

  async function loadFeed() {
    const response = await fetch("/api/feed");
    if (!response.ok) {
      throw new Error("無法取得文章列表。");
    }

    const data = (await response.json()) as FeedResponse;
    setFeed(data.posts);
  }

  async function loadGraph() {
    const response = await fetch("/api/graph");
    if (!response.ok) {
      throw new Error("無法取得圖譜資料。");
    }

    const data = (await response.json()) as GraphResponse;
    setGraph(data);
  }

  async function refreshSources() {
    setRefreshing(true);
    setError(null);

    try {
      const response = await fetch("/api/crawl", { method: "POST" });
      if (!response.ok) {
        throw new Error("重新同步資料失敗。");
      }

      const data = (await response.json()) as SourceSnapshot;
      setSnapshot(data);
      await loadFeed();
      await loadGraph();
      await analyzeMessage(message);
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "同步資料時發生錯誤。",
      );
    } finally {
      setRefreshing(false);
    }
  }

  async function analyzeMessage(input: string) {
    setAnalyzing(true);
    setError(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: input }),
      });

      if (!response.ok) {
        throw new Error("分析流程失敗。");
      }

      const data = (await response.json()) as AnalysisResponse;
      setAnalysis(data);
    } catch (analyzeError) {
      setError(
        analyzeError instanceof Error
          ? analyzeError.message
          : "分析訊息時發生錯誤。",
      );
    } finally {
      setAnalyzing(false);
    }
  }

  async function verifySite(input: string) {
    setVerifyingSite(true);
    setError(null);

    try {
      const response = await fetch("/api/verify-site", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: input }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "網站驗證失敗。",
        );
      }

      setSiteResult(data as SiteVerificationResponse);
    } catch (verifyError) {
      setError(
        verifyError instanceof Error
          ? verifyError.message
          : "驗證網站時發生錯誤。",
      );
    } finally {
      setVerifyingSite(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await analyzeMessage(message);
  }

  async function handleVerifySite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await verifySite(siteUrl);
  }

  const graphNodes = graph?.nodes ?? analysis?.knowledgeGraph.nodes ?? [];
  const graphEdges = graph?.edges ?? analysis?.knowledgeGraph.edges ?? [];

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#25334d_0%,#15233a_40%,#0f1b2e_100%)] px-5 py-8 text-white sm:px-8 lg:px-10">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-8">
        <section className="overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(21,33,54,0.92)_0%,rgba(14,23,38,0.94)_100%)] p-7 shadow-[0_24px_80px_rgba(2,8,23,0.45)] sm:p-9">
          <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-5">
              <span className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm font-semibold tracking-[0.18em] text-cyan-200 uppercase">
                <ShieldAlert className="h-4 w-4" />
                Scam Intel Console
              </span>
              <div className="space-y-4">
                <h1 className="max-w-[14ch] text-4xl font-bold leading-[1.08] sm:text-5xl">
                  最新詐騙腳本與網站驗證中心
                </h1>
                <p className="max-w-[65ch] text-[1.05rem] leading-8 text-slate-200/86">
                  這個頁面會同步 PTT 與 Google News 的案例，整理最新詐騙腳本，並提供
                  KG 視覺化與可疑網站驗證，讓使用者能直接看見目前流行的詐騙話術與操作手法。
                </p>
              </div>
              <div className="flex flex-wrap gap-3 text-sm text-slate-200/85">
                <StatPill
                  icon={<DatabaseZap className="h-4 w-4" />}
                  label={loadingSnapshot ? "資料同步中" : `${snapshot?.stats.posts ?? 0} 篇案例`}
                />
                <StatPill
                  icon={<Network className="h-4 w-4" />}
                  label={`${snapshot?.stats.nodes ?? 0} 個 KG 節點`}
                />
                <StatPill
                  icon={<SearchCheck className="h-4 w-4" />}
                  label={`${feed.length} 則可查看文章`}
                />
                <StatPill
                  icon={<DatabaseZap className="h-4 w-4" />}
                  label={`Graph: ${snapshot?.graphStore.provider ?? "memory"}`}
                />
              </div>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-white/6 p-5 backdrop-blur-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold tracking-[0.14em] text-cyan-200 uppercase">
                    系統狀態
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-white">
                    資料源與風險索引
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => void refreshSources()}
                  disabled={refreshing}
                  className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
                  />
                  重新同步
                </button>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {snapshot?.sources.map((source) => (
                  <div
                    key={source.name}
                    className="rounded-2xl border border-white/8 bg-slate-950/30 p-4"
                  >
                    <p className="text-sm font-semibold text-slate-200">
                      {source.name}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-slate-300/84">
                      {source.description}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs tracking-[0.14em] uppercase">
                      <span className="text-cyan-200">
                        {source.postCount} 篇案例已索引
                      </span>
                      <span
                        className={`rounded-full px-2 py-1 ${source.live ? "bg-emerald-500/12 text-emerald-100" : "bg-amber-500/12 text-amber-100"}`}
                      >
                        {source.live ? "Live" : "Fallback"}
                      </span>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-slate-400/80">
                      更新時間：{new Date(source.lastUpdated).toLocaleString("zh-TW")}
                    </p>
                    {source.errors.length > 0 ? (
                      <p className="mt-2 text-xs leading-5 text-amber-100/88">
                        {source.errors.join(" / ")}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-2xl border border-white/8 bg-slate-950/28 px-4 py-3 text-sm text-slate-200">
                KG 儲存層：{snapshot?.graphStore.enabled ? `Neo4j (${snapshot.graphStore.database})` : "Memory fallback"}
              </div>

              {error ? (
                <div className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                  {error}
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(55,69,95,0.94)_0%,rgba(38,50,72,0.95)_100%)] p-6 shadow-[0_20px_50px_rgba(2,8,23,0.28)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold tracking-[0.14em] text-cyan-200 uppercase">
                  最新詐騙腳本
                </p>
                <h2 className="mt-2 text-3xl font-bold">近期常見手法</h2>
              </div>
              <div className="rounded-2xl bg-cyan-400/12 p-3 text-cyan-300">
                <AlertTriangle className="h-6 w-6" />
              </div>
            </div>

            <div className="mt-6 space-y-4">
              {snapshot?.latestScripts.map((script) => (
                <article
                  key={script.scamType}
                  className="rounded-[22px] border border-white/8 bg-slate-950/28 p-5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-xl font-semibold text-white">
                      {script.scamType}
                    </h3>
                    <span className="rounded-full bg-cyan-400/12 px-3 py-1 text-xs font-semibold tracking-[0.14em] text-cyan-200 uppercase">
                      {script.count} 篇
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-7 text-slate-300/88">
                    {script.summary}
                  </p>
                </article>
              ))}
            </div>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(26,37,56,0.96)_0%,rgba(15,23,38,0.98)_100%)] p-6 shadow-[0_20px_50px_rgba(2,8,23,0.32)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold tracking-[0.14em] text-cyan-200 uppercase">
                  網站驗證
                </p>
                <h2 className="mt-2 text-3xl font-bold">真假網站檢查</h2>
              </div>
              <div className="rounded-2xl bg-cyan-400/12 p-3 text-cyan-300">
                <Globe className="h-6 w-6" />
              </div>
            </div>

            <form className="mt-6 space-y-4" onSubmit={(event) => void handleVerifySite(event)}>
              <label className="block">
                <span className="mb-3 block text-sm font-semibold text-slate-200">
                  輸入對方提供的網站
                </span>
                <input
                  value={siteUrl}
                  onChange={(event) => setSiteUrl(event.target.value)}
                  className="w-full rounded-[18px] border border-white/10 bg-slate-950/35 px-5 py-4 text-base text-white outline-none transition placeholder:text-slate-400 focus:border-cyan-300/35"
                  placeholder="例如：secure-wallet-bonus.xyz/login"
                />
              </label>
              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  disabled={verifyingSite || !siteUrl.trim()}
                  className="inline-flex items-center gap-2 rounded-full bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Globe className="h-4 w-4" />
                  {verifyingSite ? "驗證中..." : "驗證網站"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSiteUrl(sampleSite);
                    void verifySite(sampleSite);
                  }}
                  className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/6 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/12"
                >
                  使用範例網址
                </button>
              </div>
            </form>

            {siteResult ? (
              <div className="mt-6 space-y-4">
                <SiteVerdictCard result={siteResult} />
                <div className="rounded-[22px] border border-white/8 bg-white/5 p-5">
                  <p className="text-sm font-semibold text-cyan-100">判斷依據</p>
                  <ul className="mt-3 space-y-2 text-sm leading-7 text-slate-300/88">
                    {siteResult.reasons.map((reason) => (
                      <li key={reason}>- {reason}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1fr_1.05fr]">
          <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(55,69,95,0.94)_0%,rgba(38,50,72,0.95)_100%)] p-6 shadow-[0_20px_50px_rgba(2,8,23,0.28)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold tracking-[0.14em] text-cyan-200 uppercase">
                  LLM + RAG
                </p>
                <h2 className="mt-2 text-3xl font-bold">對話風險分析</h2>
              </div>
              <RiskBadge level={analysis?.risk.level ?? "low"} score={analysis?.risk.score ?? 0} />
            </div>

            <form className="mt-6 space-y-4" onSubmit={(event) => void handleSubmit(event)}>
              <label className="block">
                <span className="mb-3 block text-sm font-semibold text-slate-200">
                  輸入用戶收到的訊息或對話
                </span>
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  className="min-h-[210px] w-full rounded-[22px] border border-white/10 bg-slate-950/35 px-5 py-4 text-base leading-8 text-white outline-none transition placeholder:text-slate-400 focus:border-cyan-300/35"
                  placeholder="例如：客服要求解除分期、投資老師保證獲利、要求改用 LINE 私下交易..."
                />
              </label>
              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  disabled={analyzing || !message.trim()}
                  className="inline-flex items-center gap-2 rounded-full bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <AlertTriangle className="h-4 w-4" />
                  {analyzing ? "分析中..." : "開始分析"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMessage(sampleMessage);
                    void analyzeMessage(sampleMessage);
                  }}
                  className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/6 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/12"
                >
                  使用範例訊息
                </button>
              </div>
            </form>

            <div className="mt-6 space-y-5">
              <div className="rounded-[22px] border border-white/8 bg-white/5 p-5">
                <p className="text-sm font-semibold text-cyan-100">風險摘要</p>
                <p className="mt-3 text-[1.03rem] leading-8 text-slate-100/90">
                  {analysis?.alert.summary ??
                    "輸入訊息後，系統會在這裡生成一段具脈絡的防詐提醒。"}
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <InfoCard
                  title="命中關鍵字"
                  value={`${analysis?.matches.keywords.length ?? 0} 組`}
                  details={analysis?.matches.keywords.join("、") || "尚未分析"}
                />
                <InfoCard
                  title="命中實體"
                  value={`${analysis?.matches.entities.length ?? 0} 個`}
                  details={
                    analysis?.matches.entities
                      .map((entity) => `${entity.value}（${entity.type}）`)
                      .join("、") || "尚未分析"
                  }
                />
              </div>
            </div>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(28,39,60,0.96)_0%,rgba(16,24,39,0.96)_100%)] p-6 shadow-[0_20px_50px_rgba(2,8,23,0.32)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold tracking-[0.14em] text-cyan-200 uppercase">
                  相關案例
                </p>
                <h2 className="mt-2 text-3xl font-bold">目前抓到的文章與新聞</h2>
              </div>
              <div className="rounded-2xl bg-cyan-400/12 p-3 text-cyan-300">
                <SearchCheck className="h-6 w-6" />
              </div>
            </div>

            <div className="mt-6 max-h-[620px] space-y-3 overflow-auto pr-1">
              {feed.map((item) => (
                <article
                  key={item.id}
                  className="rounded-2xl border border-white/8 bg-slate-950/28 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs tracking-[0.14em] text-cyan-200 uppercase">
                    <span>{item.source}</span>
                    <span>{item.board}</span>
                    <span>{item.scamType}</span>
                  </div>
                  <h3 className="mt-2 text-lg font-semibold text-white">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-7 text-slate-300/90">
                    {item.snippet}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
                    <span className="text-slate-400/85">
                      {item.publishedAt
                        ? new Date(item.publishedAt).toLocaleString("zh-TW")
                        : "時間未提供"}
                    </span>
                    {item.url ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-cyan-200 transition hover:text-cyan-100"
                      >
                        查看來源
                      </a>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.08fr_0.92fr]">
          <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(46,60,84,0.94)_0%,rgba(26,37,57,0.97)_100%)] p-6 shadow-[0_20px_50px_rgba(2,8,23,0.28)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold tracking-[0.14em] text-cyan-200 uppercase">
                  Knowledge Graph
                </p>
                <h2 className="mt-2 text-3xl font-bold">vis.js 圖譜視覺化</h2>
              </div>
              <div className="rounded-2xl bg-cyan-400/12 p-3 text-cyan-300">
                <Network className="h-6 w-6" />
              </div>
            </div>
            <div className="mt-6">
              <KnowledgeGraphPanel nodes={graphNodes} edges={graphEdges} />
            </div>
            <p className="mt-4 text-sm leading-7 text-slate-300/82">
              目前圖譜資料來源：{graph?.provider === "neo4j" ? "Neo4j 即時查詢" : "記憶體 fallback"}。
            </p>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(26,37,56,0.96)_0%,rgba(15,23,38,0.98)_100%)] p-6 shadow-[0_20px_50px_rgba(2,8,23,0.28)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold tracking-[0.14em] text-cyan-200 uppercase">
                  驗證結果
                </p>
                <h2 className="mt-2 text-3xl font-bold">圖譜節點與處置建議</h2>
              </div>
            </div>
            <div className="mt-6 space-y-3">
              {graphNodes.map((node) => (
                <div
                  key={node.id}
                  className="flex items-start justify-between gap-4 rounded-2xl border border-white/8 bg-slate-950/28 p-4"
                >
                  <div>
                    <p className="text-lg font-semibold text-white">{node.label}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-300/80">
                      {node.type}
                    </p>
                  </div>
                  <span className="rounded-full bg-cyan-400/12 px-3 py-1 text-xs font-semibold tracking-[0.14em] text-cyan-200 uppercase">
                    {node.weight}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-6 rounded-[22px] border border-amber-300/20 bg-amber-500/10 p-5">
              <p className="text-sm font-semibold text-amber-100">建議處置</p>
              <ul className="mt-3 space-y-2 text-sm leading-7 text-amber-50/92">
                {(analysis?.alert.actions ?? [
                  "先輸入訊息並查看建議處置。",
                ]).map((action) => (
                  <li key={action}>- {action}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function StatPill({
  icon,
  label,
}: {
  icon: ReactNode;
  label: string;
}) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-4 py-2">
      <span className="text-cyan-300">{icon}</span>
      <span>{label}</span>
    </div>
  );
}

function RiskBadge({
  level,
  score,
}: {
  level: AnalysisResponse["risk"]["level"];
  score: number;
}) {
  const tone =
    level === "high"
      ? "border-rose-300/25 bg-rose-500/12 text-rose-100"
      : level === "medium"
        ? "border-amber-300/25 bg-amber-500/12 text-amber-100"
        : "border-emerald-300/25 bg-emerald-500/12 text-emerald-100";
  const label =
    level === "high" ? "高風險" : level === "medium" ? "中風險" : "低風險";

  return (
    <div className={`rounded-2xl border px-4 py-3 text-right ${tone}`}>
      <p className="text-xs tracking-[0.14em] uppercase">Risk Score</p>
      <p className="mt-1 text-2xl font-bold">{score}</p>
      <p className="mt-1 text-sm font-semibold">{label}</p>
    </div>
  );
}

function InfoCard({
  title,
  value,
  details,
}: {
  title: string;
  value: string;
  details: string;
}) {
  return (
    <div className="rounded-[22px] border border-white/8 bg-white/5 p-5">
      <p className="text-sm font-semibold text-cyan-100">{title}</p>
      <p className="mt-2 text-3xl font-bold text-white">{value}</p>
      <p className="mt-3 text-sm leading-7 text-slate-300/85">{details}</p>
    </div>
  );
}

function SiteVerdictCard({
  result,
}: {
  result: SiteVerificationResponse;
}) {
  const tone =
    result.verdict === "danger"
      ? "border-rose-300/20 bg-rose-500/10 text-rose-100"
      : result.verdict === "warning"
        ? "border-amber-300/20 bg-amber-500/10 text-amber-100"
        : "border-emerald-300/20 bg-emerald-500/10 text-emerald-100";

  const label =
    result.verdict === "danger"
      ? "高風險網站"
      : result.verdict === "warning"
        ? "可疑網站"
        : "暫無明顯異常";

  return (
    <div className={`rounded-[22px] border p-5 ${tone}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold tracking-[0.14em] uppercase">
            {label}
          </p>
          <p className="mt-2 break-all text-sm leading-6 opacity-90">
            {result.normalizedUrl}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs tracking-[0.14em] uppercase">Site Risk</p>
          <p className="mt-1 text-3xl font-bold">{result.riskScore}</p>
        </div>
      </div>
      <p className="mt-4 text-sm leading-7 opacity-95">{result.summary}</p>
    </div>
  );
}

export default App;
