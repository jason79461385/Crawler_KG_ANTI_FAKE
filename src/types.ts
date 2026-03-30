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
  };
};
