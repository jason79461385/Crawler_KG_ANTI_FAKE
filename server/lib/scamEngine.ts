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
  }>;
  edges: Array<{
    from: string;
    to: string;
    fromLabel: string;
    toLabel: string;
    relation: string;
  }>;
  provider: "neo4j" | "memory";
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
  };
};

type CrawlSourceState = {
  name: string;
  description: string;
  posts: DemoPost[];
  live: boolean;
  lastUpdated: string;
  errors: string[];
};

type CrawlState = {
  sources: CrawlSourceState[];
};

const keywords = getRiskKeywords();

let crawlState: CrawlState = createDemoState();
const embeddingCache = new Map<string, number[]>();

export async function crawlLiveSources() {
  const updatedAt = new Date().toISOString();
  const nextSources: CrawlSourceState[] = [];

  const pttResult = await safeRun(async () => {
    const posts = await crawlPttPosts();
    return {
      name: "PTT",
      description: "即時抓取 PTT 公開看板的最新案例。",
      posts,
      live: true,
      lastUpdated: updatedAt,
      errors: [] as string[],
    };
  });

  nextSources.push(
    pttResult.ok
      ? pttResult.value
      : {
          ...findFallbackSource("PTT"),
          live: false,
          lastUpdated: updatedAt,
          errors: [pttResult.error],
        },
  );

  const googleResult = await safeRun(async () => {
    const posts = await crawlGoogleNewsPosts();
    return {
      name: "Google News",
      description: "以 Google News 詐騙關鍵字檢索近期新聞作為廣域補充來源。",
      posts,
      live: true,
      lastUpdated: updatedAt,
      errors: [] as string[],
    };
  });

  nextSources.push(
    googleResult.ok
      ? googleResult.value
      : {
          ...findFallbackSource("Google News"),
          live: false,
          lastUpdated: updatedAt,
          errors: [googleResult.error],
        },
  );

  crawlState = {
    sources: nextSources,
  };

  if (isNeo4jEnabled()) {
    await syncPostsToNeo4j(getAllPosts());
  }

  await warmEmbeddings(getAllPosts());

  return {
    posts: getAllPosts(),
    updatedAt,
  };
}

export function getSnapshot(): SnapshotResponse {
  const posts = getAllPosts();
  const graph = buildKnowledgeGraph(posts);
  const neo4jStatus = getNeo4jStatus();

  return {
    sources: crawlState.sources.map((source) => ({
      name: source.name,
      description: source.description,
      postCount: source.posts.length,
      live: source.live,
      lastUpdated: source.lastUpdated,
      errors: source.errors,
    })),
    stats: {
      posts: posts.length,
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

export function getFeed(): FeedResponse {
  const posts = getAllPosts()
    .slice()
    .sort(sortByPublishedAt)
    .slice(0, 18)
    .map((post) => ({
      id: post.id,
      source: post.source,
      board: post.board,
      title: post.title,
      snippet: post.content.slice(0, 220),
      scamType: post.scamType,
      url: post.url,
      publishedAt: post.publishedAt,
    }));

  return { posts };
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

export async function getGraph(): Promise<GraphResponse> {
  const neo4jGraph = await getGraphFromNeo4j(18);
  if (neo4jGraph) {
    return {
      ...neo4jGraph,
      provider: "neo4j",
    };
  }

  const memoryGraph = buildKnowledgeGraph(getAllPosts());
  return {
    ...memoryGraph,
    provider: "memory",
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
  let fetchedTitle = "";
  let contentSignals: string[] = [];

  try {
    const response = await fetch(normalizedUrl, {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; ScamIntelDemo/1.0; +https://localhost)",
      },
    });

    responseOk = response.ok;
    const text = (await response.text()).slice(0, 12000);
    const lower = text.toLowerCase();
    fetchedTitle = text.match(/<title>(.*?)<\/title>/i)?.[1]?.trim() ?? "";
    contentSignals = [
      "metamask",
      "walletconnect",
      "立即入金",
      "保證獲利",
      "客服專員",
      "驗證帳戶",
      "輸入otp",
      "邀請碼",
    ].filter((signal) => lower.includes(signal.toLowerCase()));
  } catch {
    contentSignals.push("網站無法正常連線或拒絕連線");
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
  if (!responseOk) {
    riskScore += 12;
    reasons.push("網站回應異常或無法穩定取得內容。");
  }

  const cappedScore = Math.min(98, riskScore);
  const verdict =
    cappedScore >= 70 ? "danger" : cappedScore >= 40 ? "warning" : "safe";

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
    },
  };
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

function buildKnowledgeGraph(posts: DemoPost[]) {
  const nodeMap = new Map<
    string,
    { id: string; label: string; type: string; weight: number }
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
    });

    for (const entity of post.entities) {
      const entityId = `${entity.type}:${entity.value}`;
      const current = nodeMap.get(entityId);

      nodeMap.set(entityId, {
        id: entityId,
        label: entity.value,
        type: entity.type,
        weight: current ? current.weight + 1 : 1,
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
    .slice(0, 8);
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

function getAllPosts() {
  return crawlState.sources.flatMap((source) => source.posts);
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

function createDemoState(): CrawlState {
  const updatedAt = new Date().toISOString();

  return {
    sources: [
      {
        name: "PTT",
        description: "預設資料：模擬自公開看板案例。",
        posts: demoPosts
          .filter((post) => post.source === "PTT")
          .map((post) => ({ ...post, url: undefined })),
        live: false,
        lastUpdated: updatedAt,
        errors: [],
      },
      {
        name: "Google News",
        description: "預設資料：以新聞案例補充搜尋結果。",
        posts: demoPosts
          .filter((post) => post.source === "Dcard")
          .map((post) => ({
            ...post,
            source: "Google News" as const,
            url: undefined,
          })),
        live: false,
        lastUpdated: updatedAt,
        errors: [],
      },
    ],
  };
}

function findFallbackSource(name: string): CrawlSourceState {
  return (
    crawlState.sources.find((source) => source.name === name) ?? {
      name,
      description: `${name} 尚未成功同步，使用空資料集。`,
      posts: [],
      live: false,
      lastUpdated: new Date().toISOString(),
      errors: [],
    }
  );
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

  const result = await createEmbedding(input);
  return result?.embedding ?? null;
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
}
