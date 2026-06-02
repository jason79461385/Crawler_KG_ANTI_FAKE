import { demoPosts, type DemoPost } from "../data/demoPosts";
import {
  cosineSimilarity,
  createEmbedding,
  generateAlertWithLlm,
  isEmbeddingConfigured,
  isLlmConfigured,
} from "./llm";
import {
  getGraphFromNeo4j,
  getNeo4jStatus,
  isNeo4jEnabled,
  syncPostsToNeo4j,
} from "./neo4j";
import { getRiskKeywords } from "./postUtils";
import { crawlGoogleNewsPosts } from "../sources/googleNews";
import { crawlPttPosts } from "../sources/ptt";
import { crawlDashboard165Posts } from "../sources/dashboard165";
import {
  backfillDemoUrls,
  countPosts,
  countPostsBySource,
  deletePostsByIds,
  getAllPosts as getAllStoredPosts,
  getAllSourceStatus,
  getRecentPosts,
  upsertPost,
  upsertSourceStatus,
  type SourceStatusRecord,
} from "./db";
import { filterScamCandidate } from "./contentFilter";
import { safeFetch, SsrfBlockedError } from "./safeFetch";
import {
  checkGoogleSafeBrowsing,
  isSafeBrowsingConfigured,
  lookupPhishingUrl,
} from "./threatIntel";
import {
  extractSiteContent,
  CATEGORY_LABELS,
  CATEGORY_WEIGHTS,
  type ExtractedSite,
} from "./siteContent";
import { chatWithLlm } from "./llm";

type EntityType = DemoPost["entities"][number]["type"];

export type SnapshotResponse = {
  sources: Array<{
    name: string;
    description: string;
    postCount: number;
    live: boolean;
    lastUpdated: string;
    errors: string[];
  }>;
  stats: {
    posts: number;
    nodes: number;
    edges: number;
    keywords: number;
  };
  graphStore: {
    provider: "neo4j" | "memory";
    enabled: boolean;
    database: string;
    message: string;
  };
  latestScripts: Array<{
    scamType: string;
    summary: string;
    count: number;
  }>;
};

export type GraphResponse = {
  nodes: Array<{
    id: string;
    label: string;
    type: string;
    weight: number;
    group: string;
  }>;
  edges: Array<{
    from: string;
    to: string;
    fromLabel: string;
    toLabel: string;
    relation: string;
  }>;
  provider: "neo4j" | "memory";
  stats: {
    totalNodes: number;
    totalEdges: number;
    typeBreakdown: Record<string, number>;
  };
};

export type AnalysisResult = {
  risk: {
    score: number;
    level: "low" | "medium" | "high";
  };
  matches: {
    keywords: string[];
    entities: Array<{
      type: EntityType;
      value: string;
    }>;
  };
  evidence: Array<{
    id: string;
    source: string;
    title: string;
    snippet: string;
    score: string;
    scamType: string;
  }>;
  knowledgeGraph: {
    nodes: Array<{
      id: string;
      label: string;
      type: string;
      weight: number;
      group: string;
    }>;
    edges: Array<{
      from: string;
      to: string;
      fromLabel: string;
      toLabel: string;
      relation: string;
    }>;
  };
  alert: {
    summary: string;
    actions: string[];
  };
};

export type FeedResponse = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  posts: Array<{
    id: string;
    source: string;
    board: string;
    title: string;
    snippet: string;
    scamType: string;
    url?: string;
    publishedAt?: string;
  }>;
};

export type SiteVerificationResult = {
  url: string;
  normalizedUrl: string;
  riskScore: number;
  verdict: "safe" | "warning" | "danger";
  summary: string;
  reasons: string[];
  signals: {
    https: boolean;
    punycode: boolean;
    rawIpHost: boolean;
    suspiciousKeywords: string[];
    domainAgeHint: string;
    safeBrowsing: Array<{ threatType: string; platformType: string }>;
    phishingFeed: { matched: boolean; source?: string };
    ssrfBlocked: boolean;
    content?: {
      fetched: boolean;
      title: string;
      description: string;
      lang: string;
      categories: Array<{ category: string; label: string; matches: string[] }>;
      suspiciousFormFields: string[];
      externalScriptHosts: string[];
      llmVerdict?: {
        verdict: "safe" | "warning" | "danger";
        reason: string;
      };
    };
  };
};

const keywords = getRiskKeywords();

const SOURCE_DESCRIPTIONS: Record<string, string> = {
  PTT: "即時抓取 PTT 公開看板的最新案例。",
  "Google News": "以 Google News 詐騙關鍵字檢索近期新聞作為廣域補充來源。",
  "165 全民防騙網": "內政部刑事局 165 反詐騙官方詐騙手法公告。",
  "User Report": "使用者透過前端回報的可疑案例。",
};

seedDemoIfEmpty();

// 修復先前 dedupe bug 把 demo 種子的 URL 蓋掉的舊資料。
const restoredUrls = backfillDemoUrls(demoPosts);
if (restoredUrls > 0) {
  console.log(`[db] backfilled ${restoredUrls} demo post URLs that were cleared by dedupe`);
}

const embeddingCache = new Map<string, number[]>();

// graph cache:同一個 limit 的結果會 cache,直到 invalidateGraphCache() 被呼叫
const graphCache = new Map<number, { payload: GraphResponse; etag: string; builtAt: number }>();
const GRAPH_CACHE_TTL_MS = 5 * 60 * 1000;

export function invalidateGraphCache() {
  graphCache.clear();
}

export async function crawlLiveSources() {
  const updatedAt = new Date().toISOString();

  const bySource: Record<string, { inserted: number; updated: number; live: boolean }> = {};
  const r1 = await runOneSource("PTT", crawlPttPosts, updatedAt);
  bySource["PTT"] = r1;
  const r2 = await runOneSource("Google News", crawlGoogleNewsPosts, updatedAt);
  bySource["Google News"] = r2;
  const r3 = await runOneSource("165 全民防騙網", crawlDashboard165Posts, updatedAt);
  bySource["165 全民防騙網"] = r3;

  // 用最新 filter 規則清掉前次抓到、現在規則會 reject 的舊噪音
  const purged = purgeFilteredPosts();
  if (purged.removed > 0) {
    console.log(`[crawl] purged ${purged.removed} legacy noisy posts after crawl`);
  }

  // 內容變了,清 graph cache
  invalidateGraphCache();

  const allPosts = getAllPosts();

  if (isNeo4jEnabled()) {
    await syncPostsToNeo4j(allPosts);
  }

  await warmEmbeddings(allPosts);

  const totalInserted = r1.inserted + r2.inserted + r3.inserted;
  const totalUpdated = r1.updated + r2.updated + r3.updated;

  return {
    posts: allPosts,
    updatedAt,
    inserted: totalInserted,
    updated: totalUpdated,
    bySource,
  };
}

async function runOneSource(
  name: string,
  fetcher: () => Promise<DemoPost[]>,
  updatedAt: string,
): Promise<{ inserted: number; updated: number; live: boolean }> {
  const description =
    SOURCE_DESCRIPTIONS[name] ?? `${name} 詐騙案例來源。`;

  const result = await safeRun(fetcher);
  if (result.ok) {
    let inserted = 0;
    let updated = 0;
    for (const post of result.value) {
      const status = upsertPost(post, true);
      if (status === "inserted") inserted += 1;
      else if (status === "updated") updated += 1;
    }
    upsertSourceStatus({
      name,
      description: `${description}(本次新增 ${inserted} 筆,更新 ${updated} 筆)`,
      live: true,
      lastUpdated: updatedAt,
      errors: [],
    });
    return { inserted, updated, live: true };
  }
  upsertSourceStatus({
    name,
    description,
    live: false,
    lastUpdated: updatedAt,
    errors: [result.error],
  });
  return { inserted: 0, updated: 0, live: false };
}

export function getSnapshot(): SnapshotResponse {
  const posts = getAllPosts();
  const graph = buildKnowledgeGraph(posts);
  const neo4jStatus = getNeo4jStatus();
  const sourceCounts = countPostsBySource();
  const sources = getAllSourceStatus();

  return {
    sources: sources.map((source) => ({
      name: source.name,
      description: source.description,
      postCount: sourceCounts[source.name] ?? 0,
      live: source.live,
      lastUpdated: source.lastUpdated,
      errors: source.errors,
    })),
    stats: {
      posts: countPosts(),
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      keywords: keywords.length,
    },
    graphStore: {
      provider: neo4jStatus.enabled ? "neo4j" : "memory",
      enabled: neo4jStatus.enabled,
      database: neo4jStatus.database,
      message: neo4jStatus.message,
    },
    latestScripts: buildLatestScripts(posts),
  };
}

export function getFeed(page = 1, pageSize = 12): FeedResponse {
  const all = getAllPosts().slice().sort(sortByPublishedAt);
  const total = all.length;
  const offset = Math.max(0, (page - 1) * pageSize);
  const slice = all.slice(offset, offset + pageSize);

  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    posts: slice.map((post) => ({
      id: post.id,
      source: post.source,
      board: post.board,
      title: post.title,
      snippet: post.content.slice(0, 220),
      scamType: post.scamType,
      url: post.url,
      publishedAt: post.publishedAt,
    })),
  };
}

export async function analyzeMessage(message: string): Promise<AnalysisResult> {
  const posts = getAllPosts();
  const normalized = message.trim();
  const matchedKeywords = keywords.filter((keyword) =>
    normalized.toLowerCase().includes(keyword.toLowerCase()),
  );

  const messageEmbedding = await getEmbeddingForText(normalized);
  const scoredEvidence = posts
    .map((post) => {
      const overlap = [
        ...new Set(
          post.entities
            .map((entity) => entity.value)
            .filter((value) => normalized.includes(value)),
        ),
      ];
      const keywordHits = matchedKeywords.filter(
        (keyword) =>
          post.content.includes(keyword) ||
          post.title.includes(keyword) ||
          overlap.includes(keyword),
      );
      const embedding = embeddingCache.get(post.id);
      const semanticScore =
        messageEmbedding && embedding
          ? Math.max(0, cosineSimilarity(messageEmbedding, embedding)) * 42
          : 0;
      const score = overlap.length * 24 + keywordHits.length * 14 + semanticScore;

      return {
        post,
        overlap,
        keywordHits,
        score,
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);

  const matchedEntities = uniqueEntities(
    scoredEvidence.flatMap((item) =>
      item.post.entities.filter(
        (entity) =>
          normalized.includes(entity.value) ||
          matchedKeywords.includes(entity.value),
      ),
    ),
  );

  const graph = buildKnowledgeGraph(scoredEvidence.map((item) => item.post));
  const score = Math.min(
    96,
    10 +
      matchedKeywords.length * 8 +
      matchedEntities.length * 10 +
      scoredEvidence.length * 14,
  );
  const riskLabel =
    score >= 70 ? "高度疑似詐騙" : score >= 40 ? "具有明顯風險" : "有待進一步查證";

  const llmAlert = await buildLlmAlert({
    message: normalized,
    matchedKeywords,
    matchedEntities,
    evidence: scoredEvidence.map((item) => item.post),
    riskLabel,
  });

  return {
    risk: {
      score,
      level: score >= 70 ? "high" : score >= 40 ? "medium" : "low",
    },
    matches: {
      keywords: matchedKeywords,
      entities: matchedEntities,
    },
    evidence: scoredEvidence.map(({ post, score: itemScore }) => ({
      id: post.id,
      source: `${post.source} / ${post.board}`,
      title: post.title,
      snippet: post.content,
      score: `${Math.min(0.99, itemScore / 100).toFixed(2)}`,
      scamType: post.scamType,
      url: post.url,
      publishedAt: post.publishedAt,
    })),
    knowledgeGraph: graph,
    alert: llmAlert ?? buildAlert({
      message: normalized,
      riskScore: score,
      matchedKeywords,
      matchedEntities,
      evidence: scoredEvidence.map((item) => item.post),
    }),
  };
}

export async function getGraph(limit = 80): Promise<GraphResponse & { etag: string }> {
  const cached = graphCache.get(limit);
  if (cached && Date.now() - cached.builtAt < GRAPH_CACHE_TTL_MS) {
    return { ...cached.payload, etag: cached.etag };
  }

  const neo4jGraph = await getGraphFromNeo4j(limit);
  let payload: GraphResponse;
  if (neo4jGraph) {
    // post 節點 group 永遠是 "post",不是 scamType,
    // 否則前端會 fallback 到灰色 default palette
    const normalized = neo4jGraph.nodes.map((n) => ({
      ...n,
      group: n.id.startsWith("post:") ? "post" : n.type,
    }));
    payload = {
      nodes: normalized,
      edges: neo4jGraph.edges,
      provider: "neo4j",
      stats: computeStats(normalized, neo4jGraph.edges),
    };
  } else {
    const memoryGraph = buildKnowledgeGraph(getAllPosts(), limit);
    payload = {
      nodes: memoryGraph.nodes,
      edges: memoryGraph.edges,
      provider: "memory",
      stats: computeStats(memoryGraph.nodes, memoryGraph.edges),
    };
  }

  const etag = `"g${limit}-${payload.stats.totalNodes}-${payload.stats.totalEdges}-${countPosts()}"`;
  graphCache.set(limit, { payload, etag, builtAt: Date.now() });
  return { ...payload, etag };
}

function computeStats(
  nodes: Array<{ id?: string; type: string; group?: string }>,
  edges: unknown[],
) {
  // typeBreakdown 用前端的 group 維度計算(post / keyword / channel / ...)
  // 才會跟前端 chip 對得起來。group 缺的話,fallback 到 id-based 推斷。
  const typeBreakdown: Record<string, number> = {};
  for (const n of nodes) {
    const group =
      n.group ?? (n.id?.startsWith("post:") ? "post" : n.type);
    typeBreakdown[group] = (typeBreakdown[group] ?? 0) + 1;
  }
  return {
    totalNodes: nodes.length,
    totalEdges: edges.length,
    typeBreakdown,
  };
}

export async function verifySiteUrl(inputUrl: string): Promise<SiteVerificationResult> {
  const normalizedUrl = normalizeUrl(inputUrl);
  const url = new URL(normalizedUrl);
  const host = url.hostname.toLowerCase();
  const suspiciousKeywords = [
    "login",
    "verify",
    "wallet",
    "bonus",
    "gift",
    "bank",
    "support",
    "secure",
    "account",
    "crypto",
    "airdrop",
  ].filter((keyword) => host.includes(keyword) || url.pathname.toLowerCase().includes(keyword));

  const punycode = host.includes("xn--");
  const rawIpHost = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const https = url.protocol === "https:";
  const suspiciousTld = /\.(top|xyz|click|shop|vip|live|loan|work)$/i.test(host);

  let responseOk = false;
  const contentSignals: string[] = [];
  let ssrfBlocked = false;
  let extracted: ExtractedSite | null = null;

  try {
    const result = await safeFetch(normalizedUrl, {
      timeoutMs: 6000,
      maxBytes: 384 * 1024,
      maxRedirects: 3,
    });
    responseOk = result.ok;
    if (result.text) {
      try {
        extracted = extractSiteContent(result.text, result.finalUrl ?? normalizedUrl);
      } catch (error) {
        console.warn(
          "[verifySite] content extraction failed:",
          error instanceof Error ? error.message : error,
        );
      }
    }
    // Keep the legacy quick-hit signals so existing reasons stay populated.
    const lower = result.text.slice(0, 12000).toLowerCase();
    const legacy = [
      "metamask",
      "walletconnect",
      "立即入金",
      "保證獲利",
      "客服專員",
      "驗證帳戶",
      "輸入otp",
      "邀請碼",
    ].filter((signal) => lower.includes(signal.toLowerCase()));
    contentSignals.push(...legacy);
  } catch (error) {
    if (error instanceof SsrfBlockedError) {
      ssrfBlocked = true;
      contentSignals.push(`SSRF 防護擋下:${error.message}`);
    } else {
      contentSignals.push("網站無法正常連線或拒絕連線");
    }
  }

  const phishMatch = lookupPhishingUrl(normalizedUrl);
  let safeBrowsingThreats: Array<{ threatType: string; platformType: string }> = [];
  if (isSafeBrowsingConfigured()) {
    try {
      safeBrowsingThreats = await checkGoogleSafeBrowsing(normalizedUrl);
    } catch {
      safeBrowsingThreats = [];
    }
  }

  const reasons: string[] = [];
  let riskScore = 8;

  if (!https) {
    riskScore += 24;
    reasons.push("網站未使用 HTTPS 加密連線。");
  }
  if (punycode) {
    riskScore += 28;
    reasons.push("網域包含 punycode，常見於偽冒字形網址。");
  }
  if (rawIpHost) {
    riskScore += 24;
    reasons.push("網址直接使用 IP，較不符合一般正式服務模式。");
  }
  if (suspiciousTld) {
    riskScore += 16;
    reasons.push("網址尾碼較常出現在短生命週期或廣告型站點。");
  }
  if (suspiciousKeywords.length > 0) {
    riskScore += 10 + suspiciousKeywords.length * 4;
    reasons.push(`網址中出現高風險字詞：${suspiciousKeywords.join("、")}。`);
  }
  if (contentSignals.length > 0) {
    riskScore += 18 + contentSignals.length * 4;
    reasons.push(`頁面內容出現高風險信號：${contentSignals.join("、")}。`);
  }
  if (!responseOk && !ssrfBlocked) {
    riskScore += 12;
    reasons.push("網站回應異常或無法穩定取得內容。");
  }
  if (ssrfBlocked) {
    riskScore += 30;
    reasons.push("SSRF 防護機制擋下了該網址,可能指向內網或不允許的位址。");
  }
  if (phishMatch) {
    riskScore += 40;
    reasons.push(`已知釣魚網址清單命中(來源:${phishMatch.source})。`);
  }
  if (safeBrowsingThreats.length > 0) {
    riskScore += 35;
    const types = safeBrowsingThreats.map((t) => t.threatType).join("、");
    reasons.push(`Google Safe Browsing 標記為:${types}。`);
  }

  // Content-based scoring from the extracted page (HTML).
  if (extracted) {
    for (const { category, matches } of extracted.categories) {
      const weight = CATEGORY_WEIGHTS[category] ?? 12;
      riskScore += weight + Math.min(matches.length, 4) * 2;
      reasons.push(
        `頁面內容判定為「${CATEGORY_LABELS[category]}」傾向(命中:${matches.slice(0, 4).join("、")})。`,
      );
    }
    if (extracted.suspiciousFormFields.length > 0) {
      riskScore += 12 + extracted.suspiciousFormFields.length * 4;
      reasons.push(
        `頁面要求高敏感資料欄位:${extracted.suspiciousFormFields.slice(0, 4).join("、")}。`,
      );
    }
    if (extracted.externalScriptHosts.length >= 6) {
      riskScore += 6;
      reasons.push(
        `頁面載入較多第三方腳本(${extracted.externalScriptHosts.length} 個來源),建議再次確認。`,
      );
    }
  } else if (!ssrfBlocked && !responseOk) {
    // Already accounted for via the "回應異常" path above.
  }

  let llmContentVerdict: { verdict: "safe" | "warning" | "danger"; reason: string } | undefined;
  if (extracted && isLlmConfigured()) {
    llmContentVerdict = await judgeSiteWithLlm(normalizedUrl, extracted);
    if (llmContentVerdict) {
      if (llmContentVerdict.verdict === "danger") {
        riskScore += 22;
        reasons.push(`LLM 內容判讀為高風險:${llmContentVerdict.reason}`);
      } else if (llmContentVerdict.verdict === "warning") {
        riskScore += 10;
        reasons.push(`LLM 內容判讀為可疑:${llmContentVerdict.reason}`);
      }
    }
  }

  const cappedScore = Math.min(98, riskScore);
  const verdict =
    cappedScore >= 70 ? "danger" : cappedScore >= 40 ? "warning" : "safe";

  const contentSignal = extracted
    ? {
        fetched: true,
        title: extracted.title,
        description: extracted.metaDescription || extracted.ogDescription,
        lang: extracted.lang,
        categories: extracted.categories.map(({ category, matches }) => ({
          category,
          label: CATEGORY_LABELS[category],
          matches,
        })),
        suspiciousFormFields: extracted.suspiciousFormFields,
        externalScriptHosts: extracted.externalScriptHosts.slice(0, 12),
        llmVerdict: llmContentVerdict,
      }
    : {
        fetched: false,
        title: "",
        description: "",
        lang: "",
        categories: [],
        suspiciousFormFields: [],
        externalScriptHosts: [],
      };

  return {
    url: inputUrl,
    normalizedUrl,
    riskScore: cappedScore,
    verdict,
    summary:
      verdict === "danger"
        ? "這個網站具有多個高風險信號，建議不要登入、轉帳或輸入任何驗證資料。"
        : verdict === "warning"
          ? "這個網站有可疑跡象，建議改由官方網站、官方 App 或客服再次確認。"
          : "目前沒有明顯高風險信號，但仍建議交叉確認官方網域與憑證資訊。",
    reasons,
    signals: {
      https,
      punycode,
      rawIpHost,
      suspiciousKeywords,
      domainAgeHint: suspiciousTld ? "尾碼偏高風險" : "未檢出明顯尾碼異常",
      safeBrowsing: safeBrowsingThreats,
      phishingFeed: {
        matched: Boolean(phishMatch),
        source: phishMatch?.source,
      },
      ssrfBlocked,
      content: contentSignal,
    },
  };
}

async function judgeSiteWithLlm(
  url: string,
  extracted: ExtractedSite,
): Promise<{ verdict: "safe" | "warning" | "danger"; reason: string } | undefined> {
  const snapshot = [
    `URL: ${url}`,
    `Title: ${extracted.title}`,
    `Desc: ${extracted.metaDescription || extracted.ogDescription}`,
    `Headings: ${extracted.headings.slice(0, 4).join(" | ")}`,
    `SuspiciousFields: ${extracted.suspiciousFormFields.slice(0, 6).join(", ")}`,
    `Categories: ${extracted.categories.map((c) => c.category).join(", ")}`,
    `Text: ${extracted.textSample.slice(0, 700)}`,
  ].join("\n");

  const prompt = [
    "你是防詐網站審查員。根據下方網站資料,判斷對台灣使用者的詐騙風險。",
    "只輸出 JSON: {\"verdict\":\"safe|warning|danger\",\"reason\":\"30字內繁中\"}。",
    snapshot,
  ].join("\n");

  try {
    const reply = await chatWithLlm([{ role: "user", content: prompt }]);
    if (!reply) return undefined;
    const match = reply.match(/\{[\s\S]*\}/);
    if (!match) return undefined;
    const parsed = JSON.parse(match[0]) as { verdict?: string; reason?: string };
    const v = parsed.verdict;
    if (v !== "safe" && v !== "warning" && v !== "danger") return undefined;
    return { verdict: v, reason: (parsed.reason ?? "").slice(0, 120) };
  } catch (error) {
    console.warn(
      "[verifySite] LLM judgment failed:",
      error instanceof Error ? error.message : error,
    );
    return undefined;
  }
}

function buildAlert({
  message,
  riskScore,
  matchedKeywords,
  matchedEntities,
  evidence,
}: {
  message: string;
  riskScore: number;
  matchedKeywords: string[];
  matchedEntities: Array<{ type: EntityType; value: string }>;
  evidence: DemoPost[];
}) {
  const scamTypes = [...new Set(evidence.map((item) => item.scamType))];
  const riskLabel =
    riskScore >= 70 ? "高度疑似詐騙" : riskScore >= 40 ? "具有明顯風險" : "有待進一步查證";
  const evidenceSummary =
    scamTypes.length > 0 ? `相似案例集中在 ${scamTypes.join("、")}。` : "";
  const keywordSummary =
    matchedKeywords.length > 0
      ? `命中關鍵詞包含 ${matchedKeywords.join("、")}。`
      : "這段訊息尚未命中高風險關鍵詞，但仍建議保守處理。";
  const entitySummary =
    matchedEntities.length > 0
      ? `系統辨識到的關聯實體有 ${[...new Set(matchedEntities
          .map((entity) => entity.value))]
          .join("、")}。`
      : "";

  return {
    summary: `系統判定這段訊息 ${riskLabel}。${keywordSummary}${entitySummary}${evidenceSummary} 若對方要求改用私下聯絡、提供驗證碼、匯款到陌生帳戶或宣稱保證獲利，應立即中止互動並改由官方客服或平台再次確認。`,
    actions: [
      "不要依照對方指示匯款、轉帳或提供 OTP / 驗證碼。",
      "改用官方網站、官方 App 或銀行客服重新查證，不要回撥對方提供的號碼。",
      `將命中內容 ${message.length > 40 ? "截圖保存" : "記錄保存"}，必要時提供給 165 反詐騙專線或警方。`,
    ],
  };
}

function buildKnowledgeGraph(posts: DemoPost[], maxNodes = 60) {
  const nodeMap = new Map<
    string,
    {
      id: string;
      label: string;
      type: string;
      weight: number;
      group: string;
      url?: string;
      source?: string;
      scamType?: string;
      publishedAt?: string;
    }
  >();
  const edges: Array<{
    from: string;
    to: string;
    fromLabel: string;
    toLabel: string;
    relation: string;
  }> = [];

  for (const post of posts) {
    const postNodeId = `post:${post.id}`;
    nodeMap.set(postNodeId, {
      id: postNodeId,
      label: post.title,
      type: post.scamType,
      weight: Math.max(1, post.entities.length),
      group: "post",
      url: post.url,
      source: post.source,
      scamType: post.scamType,
      publishedAt: post.publishedAt,
    });

    for (const entity of post.entities) {
      const entityId = `${entity.type}:${entity.value}`;
      const current = nodeMap.get(entityId);

      nodeMap.set(entityId, {
        id: entityId,
        label: entity.value,
        type: entity.type,
        weight: current ? current.weight + 1 : 1,
        group: entity.type,
      });

      edges.push({
        from: postNodeId,
        to: entityId,
        fromLabel: post.title,
        toLabel: entity.value,
        relation: "mentions",
      });
    }
  }

  const nodes = [...nodeMap.values()]
    .sort((left, right) => right.weight - left.weight)
    .slice(0, maxNodes);
  const allowedIds = new Set(nodes.map((node) => node.id));

  return {
    nodes,
    edges: edges.filter(
      (edge) => allowedIds.has(edge.from) && allowedIds.has(edge.to),
    ),
  };
}

function uniqueEntities(
  entities: Array<{
    type: EntityType;
    value: string;
  }>,
) {
  const seen = new Set<string>();

  return entities.filter((entity) => {
    const key = `${entity.type}:${entity.value}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function getAllPosts(): DemoPost[] {
  return getAllStoredPosts().map(({ firstSeenAt: _f, lastSeenAt: _l, live: _v, ...post }) => post);
}

export function getRecent(limit = 50): DemoPost[] {
  return getRecentPosts(limit).map(({ firstSeenAt: _f, lastSeenAt: _l, live: _v, ...post }) => post);
}

function buildLatestScripts(posts: DemoPost[]) {
  const buckets = new Map<
    string,
    { scamType: string; samples: string[]; count: number }
  >();

  for (const post of posts) {
    const current = buckets.get(post.scamType) ?? {
      scamType: post.scamType,
      samples: [],
      count: 0,
    };
    current.count += 1;
    if (current.samples.length < 2) {
      current.samples.push(post.title);
    }
    buckets.set(post.scamType, current);
  }

  return [...buckets.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, 4)
    .map((item) => ({
      scamType: item.scamType,
      count: item.count,
      summary: `近期常見腳本偏向 ${item.scamType}，常見表述包括：${item.samples.join("、")}。`,
    }));
}

function sortByPublishedAt(left: DemoPost, right: DemoPost) {
  const leftTime = left.publishedAt ? new Date(left.publishedAt).getTime() : 0;
  const rightTime = right.publishedAt ? new Date(right.publishedAt).getTime() : 0;
  return rightTime - leftTime;
}

function normalizeUrl(inputUrl: string) {
  const trimmed = inputUrl.trim();
  if (!trimmed) {
    throw new Error("請輸入網址。");
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function seedDemoIfEmpty() {
  if (countPosts() > 0) {
    return;
  }
  const updatedAt = new Date().toISOString();
  for (const post of demoPosts) {
    const seedSource =
      post.source === "Dcard"
        ? ("Google News" as const)
        : (post.source as DemoPost["source"]);
    upsertPost({ ...post, source: seedSource, url: undefined }, false);
  }
  for (const name of Object.keys(SOURCE_DESCRIPTIONS)) {
    upsertSourceStatus({
      name,
      description: `預設資料:${SOURCE_DESCRIPTIONS[name]}`,
      live: false,
      lastUpdated: updatedAt,
      errors: [],
    });
  }
}

export function getSourceStatusList(): SourceStatusRecord[] {
  return getAllSourceStatus();
}

export function purgeFilteredPosts(): {
  removed: number;
  samples: Array<{ id: string; title: string; reason: string }>;
} {
  const samples: Array<{ id: string; title: string; reason: string }> = [];
  const toDelete: string[] = [];

  for (const post of getAllStoredPosts()) {
    // 永遠保留使用者回報,即使內容看起來像政治也讓使用者自決
    if (post.source === "User Report") continue;

    const verdict = filterScamCandidate({
      title: post.title,
      content: post.content,
    });
    if (!verdict.accept) {
      toDelete.push(post.id);
      if (samples.length < 20) {
        samples.push({
          id: post.id,
          title: post.title,
          reason: verdict.reason ?? "filtered",
        });
      }
    }
  }

  const removed = deletePostsByIds(toDelete);
  if (removed > 0) {
    invalidateGraphCache();
  }
  return { removed, samples };
}

async function safeRun<T>(runner: () => Promise<T>) {
  try {
    return { ok: true as const, value: await runner() };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "unknown crawler error",
    };
  }
}

async function warmEmbeddings(posts: DemoPost[]) {
  if (!isEmbeddingConfigured()) {
    return;
  }

  await Promise.all(
    posts.map(async (post) => {
      if (!embeddingCache.has(post.id)) {
        const embedding = await createEmbedding(`${post.title}\n${post.content}`);
        if (embedding) {
          embeddingCache.set(post.id, embedding.embedding);
        }
      }
    }),
  );
}

async function getEmbeddingForText(input: string) {
  if (!isEmbeddingConfigured()) {
    return null;
  }

  try {
    const result = await createEmbedding(input);
    return result?.embedding ?? null;
  } catch (error) {
    console.warn(
      "[scamEngine] embedding lookup failed, falling back to keyword-only scoring:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

async function buildLlmAlert(input: {
  message: string;
  matchedKeywords: string[];
  matchedEntities: Array<{ type: EntityType; value: string }>;
  evidence: DemoPost[];
  riskLabel: string;
}) {
  if (!isLlmConfigured()) {
    return null;
  }

  try {
    const generated = await generateAlertWithLlm({
      message: input.message,
      matchedKeywords: input.matchedKeywords,
      matchedEntities: input.matchedEntities.map((entity) => entity.value),
      evidence: input.evidence.map((item) => ({
        title: item.title,
        source: `${item.source}/${item.board}`,
        scamType: item.scamType,
        snippet: item.content.slice(0, 240),
      })),
      riskLabel: input.riskLabel,
    });

    if (!generated?.summary || generated.actions.length === 0) {
      return null;
    }

    return generated;
  } catch (error) {
    console.warn(
      "[scamEngine] LLM alert generation failed, using deterministic alert:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
