export type SourceInfo = {
  name: string;
  description: string;
  postCount: number;
  live: boolean;
  lastUpdated: string;
  errors: string[];
};

export type SourceSnapshot = {
  sources: SourceInfo[];
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
  latestScripts: LatestScript[];
};

export type LatestScript = {
  scamType: string;
  summary: string;
  count: number;
};

export type MatchedEntity = {
  type: string;
  value: string;
};

export type EvidenceItem = {
  id: string;
  source: string;
  title: string;
  snippet: string;
  score: string;
  scamType: string;
  url?: string;
  publishedAt?: string;
};

export type GraphNode = {
  id: string;
  label: string;
  type: string;
  weight: number;
  group: string;
  url?: string;
  source?: string;
  scamType?: string;
  publishedAt?: string;
};

export type GraphEdge = {
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  relation: string;
};

export type GraphResponse = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  provider: "neo4j" | "memory";
  stats: {
    totalNodes: number;
    totalEdges: number;
    typeBreakdown: Record<string, number>;
  };
};

export type AnalysisResponse = {
  risk: {
    score: number;
    level: "low" | "medium" | "high";
  };
  matches: {
    keywords: string[];
    entities: MatchedEntity[];
  };
  evidence: EvidenceItem[];
  knowledgeGraph: {
    nodes: GraphNode[];
    edges: GraphEdge[];
  };
  alert: {
    summary: string;
    actions: string[];
  };
};

export type FeedPost = {
  id: string;
  source: string;
  board: string;
  title: string;
  snippet: string;
  scamType: string;
  url?: string;
  publishedAt?: string;
};

export type FeedResponse = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  posts: FeedPost[];
};

export type SiteVerificationResponse = {
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
  };
};

export type UserReportRecord = {
  id: string;
  message: string;
  reporterHint?: string;
  suspectedUrl?: string;
  suspectedChannel?: string;
  riskLevel?: string;
  riskScore?: number;
  matchedKeywords: string[];
  createdAt: string;
  status: "pending" | "reviewed" | "ignored";
};

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};
