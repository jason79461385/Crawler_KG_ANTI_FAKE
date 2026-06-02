import "dotenv/config";
import cors from "cors";
import express from "express";
import {
  analyzeMessage,
  crawlLiveSources,
  getFeed,
  getGraph,
  getSnapshot,
  invalidateGraphCache,
  purgeFilteredPosts,
  verifySiteUrl,
} from "./lib/scamEngine";
import { chatWithLlm, isLlmConfigured } from "./lib/llm";
import {
  getAllPosts as getAllStoredPosts,
  getRecentReports,
  insertReport,
  type UserReport,
} from "./lib/db";
import {
  getThreatIntelStatus,
  refreshPhishFeeds,
} from "./lib/threatIntel";
import {
  isNeo4jEnabled,
  probeNeo4jOnStartup,
  syncPostsToNeo4j,
} from "./lib/neo4j";
import {
  broadcast,
  registerSseClient,
  sseHeartbeat,
} from "./lib/events";

const app = express();
const port = 8787;

const CRAWL_INTERVAL_MS = Number(process.env.CRAWL_INTERVAL_MS ?? 15 * 60 * 1000);
const SSE_HEARTBEAT_MS = 25 * 1000;

let crawlInFlight = false;

async function runScheduledCrawl(reason: "startup" | "interval" | "manual") {
  if (crawlInFlight) {
    console.log(`[crawl] skip (${reason}): another crawl is still running`);
    return;
  }
  crawlInFlight = true;
  try {
    const result = await crawlLiveSources();
    broadcast({
      type: "crawl",
      at: result.updatedAt,
      inserted: result.inserted,
      updated: result.updated,
      totalPosts: result.posts.length,
      bySource: result.bySource,
    });
    console.log(
      `[crawl] (${reason}) inserted=${result.inserted} updated=${result.updated} total=${result.posts.length}`,
    );
  } catch (error) {
    console.error(`[crawl] (${reason}) failed:`, error);
  } finally {
    crawlInFlight = false;
  }
}

app.use(cors());
app.use(express.json({ limit: "200kb" }));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, threatIntel: getThreatIntelStatus() });
});

app.get("/api/snapshot", (_request, response) => {
  response.json(getSnapshot());
});

app.get("/api/feed", (request, response) => {
  const page = Math.max(1, Number(request.query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(request.query.pageSize) || 12));
  response.json(getFeed(page, pageSize));
});

app.get("/api/graph", async (request, response) => {
  const limit = Math.min(200, Math.max(8, Number(request.query.limit) || 80));
  const result = await getGraph(limit);
  const { etag, ...payload } = result;

  response.setHeader("ETag", etag);
  response.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=120");

  if (request.headers["if-none-match"] === etag) {
    response.status(304).end();
    return;
  }

  response.json(payload);
});

app.post("/api/crawl", async (_request, response) => {
  await runScheduledCrawl("manual");
  void refreshPhishFeeds().catch((error) => {
    console.error("Phish feed refresh failed:", error);
  });
  response.json(getSnapshot());
});

app.get("/api/events", (request, response) => {
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.setHeader("X-Accel-Buffering", "no");
  response.flushHeaders?.();
  response.write(
    `data: ${JSON.stringify({ type: "hello", at: new Date().toISOString() })}\n\n`,
  );
  registerSseClient(response);
  request.on("close", () => {
    try { response.end(); } catch { /* ignore */ }
  });
});

app.post("/api/purge-noise", (_request, response) => {
  const result = purgeFilteredPosts();
  response.json({
    removed: result.removed,
    samples: result.samples,
    snapshot: getSnapshot(),
  });
});

app.post("/api/analyze", async (request, response) => {
  const message =
    typeof request.body?.message === "string" ? request.body.message : "";

  if (!message.trim()) {
    response.status(400).json({ error: "message is required" });
    return;
  }

  try {
    response.json(await analyzeMessage(message));
  } catch (error) {
    console.error("[/api/analyze] failed:", error);
    response.status(500).json({
      error: error instanceof Error ? error.message : "analyze failed",
    });
  }
});

app.post("/api/verify-site", async (request, response) => {
  const url = typeof request.body?.url === "string" ? request.body.url : "";

  if (!url.trim()) {
    response.status(400).json({ error: "url is required" });
    return;
  }

  try {
    response.json(await verifySiteUrl(url));
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "site verification failed",
    });
  }
});

app.post("/api/report", async (request, response) => {
  const body = request.body ?? {};
  const message = typeof body.message === "string" ? body.message.trim() : "";

  if (!message) {
    response.status(400).json({ error: "message is required" });
    return;
  }

  if (message.length > 4000) {
    response.status(400).json({ error: "message too long" });
    return;
  }

  let analysis: Awaited<ReturnType<typeof analyzeMessage>> | null = null;
  try {
    analysis = await analyzeMessage(message);
  } catch {
    /* swallow analysis errors; report still saved */
  }

  const report: UserReport = {
    id: `report-${Date.now()}-${Math.floor(Math.random() * 10_000).toString(16)}`,
    message,
    reporterHint: typeof body.reporterHint === "string" ? body.reporterHint.slice(0, 200) : undefined,
    suspectedUrl: typeof body.suspectedUrl === "string" ? body.suspectedUrl.slice(0, 500) : undefined,
    suspectedChannel: typeof body.suspectedChannel === "string" ? body.suspectedChannel.slice(0, 80) : undefined,
    riskLevel: analysis?.risk.level,
    riskScore: analysis?.risk.score,
    matchedKeywords: analysis?.matches.keywords ?? [],
    createdAt: new Date().toISOString(),
    status: "pending",
  };

  insertReport(report);
  response.json({ report, analysis });
});

app.get("/api/reports", (request, response) => {
  const limit = Math.min(100, Math.max(1, Number(request.query.limit) || 30));
  response.json({ reports: getRecentReports(limit) });
});

app.post("/api/chat", async (request, response) => {
  const body = request.body ?? {};
  const messages = Array.isArray(body.messages) ? body.messages : [];

  const cleaned = messages
    .filter(
      (m: unknown): m is { role: string; content: string } =>
        Boolean(m) &&
        typeof (m as { role?: unknown }).role === "string" &&
        typeof (m as { content?: unknown }).content === "string",
    )
    .filter((m: { role: string }) => m.role === "user" || m.role === "assistant")
    .slice(-12);

  if (cleaned.length === 0) {
    response.status(400).json({ error: "messages required" });
    return;
  }

  const lastUser = [...cleaned].reverse().find((m) => m.role === "user");
  let evidenceContext = "";

  if (lastUser) {
    try {
      const analysis = await analyzeMessage(lastUser.content);
      evidenceContext = analysis.evidence
        .slice(0, 3)
        .map(
          (item, index) =>
            `[${index + 1}] (${item.scamType}/${item.source}) ${item.title} — ${item.snippet.slice(0, 160)}`,
        )
        .join("\n");
    } catch {
      /* ignore */
    }
  }

  if (!isLlmConfigured()) {
    response.json({
      content: buildLocalMarkdownReply(lastUser?.content ?? "", evidenceContext),
      mode: "local",
    });
    return;
  }

  try {
    const reply = await chatWithLlm(
      cleaned.map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { evidence: evidenceContext },
    );
    response.json({
      content: reply ?? buildLocalMarkdownReply(lastUser?.content ?? "", evidenceContext),
      mode: reply ? "llm" : "local",
    });
  } catch (error) {
    response.json({
      content: buildLocalMarkdownReply(lastUser?.content ?? "", evidenceContext),
      mode: "local",
      error: error instanceof Error ? error.message : "chat failed",
    });
  }
});

function buildLocalMarkdownReply(userInput: string, evidenceContext: string) {
  const trimmed = userInput.trim();
  return [
    `### 🛡️ 防詐快速建議`,
    "",
    trimmed
      ? `針對你提到的「${trimmed.slice(0, 60)}${trimmed.length > 60 ? "…" : ""}」,以下是初步觀察:`
      : "請再描述具體訊息或網址,我會給你更精準的建議。",
    "",
    "**請務必檢查以下三件事:**",
    "",
    "1. 對方是否要求你 **匯款到陌生帳戶** 或提供 OTP / 驗證碼?",
    "2. 對方是否堅持改用 **LINE / Telegram 等私下管道**?",
    "3. 是否有 **保證獲利 / 解除分期 / 安全帳戶** 等高風險話術?",
    "",
    evidenceContext
      ? `> 系統比對到的相似案例:\n>\n> ${evidenceContext.replace(/\n/g, "\n> ")}`
      : "> 目前尚未比對到強相似案例,但仍建議撥打 **165 反詐騙專線** 進一步確認。",
    "",
    "---",
    "_本回覆由本地規則生成。設定 `WORKER_API_URL` / `WORKER_MODEL_NAME` 後可切換為 LLM 真生成模式。_",
  ].join("\n");
}

app.listen(port, () => {
  console.log(`Scam demo API listening on http://localhost:${port}`);
});

// 開機階段背景跑這幾件事,不阻擋 listen。
// 1) 先 probe Neo4j → 2) 跑初次 crawl(內部會做一次 syncPostsToNeo4j) →
// 3) 用 SQLite 全量 posts 再強制 resync 一次,避免 Neo4j 殘留舊資料 →
// 4) 失效 graph cache,讓下一次 /api/graph 拿到最新資料。
void (async () => {
  try {
    await probeNeo4jOnStartup();
  } catch (error) {
    console.error("[startup] Neo4j probe failed:", error);
  }

  try {
    await runScheduledCrawl("startup");
  } catch (error) {
    console.error("[startup] initial crawl failed:", error);
  }

  if (isNeo4jEnabled()) {
    try {
      const posts = getAllStoredPosts();
      const result = await syncPostsToNeo4j(posts);
      console.log(
        `[startup] forced Neo4j resync from SQLite: posts=${posts.length} result=${JSON.stringify(result)}`,
      );
    } catch (error) {
      console.error("[startup] forced Neo4j resync failed:", error);
    }
  }

  invalidateGraphCache();
})();

setInterval(() => {
  void runScheduledCrawl("interval");
}, CRAWL_INTERVAL_MS);

setInterval(() => {
  sseHeartbeat();
}, SSE_HEARTBEAT_MS);

void refreshPhishFeeds(true).catch((error) => {
  console.error("Initial phish feed refresh failed:", error);
});
