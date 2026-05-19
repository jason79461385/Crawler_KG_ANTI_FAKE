import type {
  AnalysisResponse,
  ChatMessage,
  FeedResponse,
  GraphResponse,
  SiteVerificationResponse,
  SourceSnapshot,
  UserReportRecord,
} from "../types";

async function jsonOrThrow<T>(response: Response, fallbackMsg: string): Promise<T> {
  if (!response.ok) {
    let msg = fallbackMsg;
    try {
      const data = (await response.json()) as { error?: string };
      if (typeof data?.error === "string") msg = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await response.json()) as T;
}

export async function fetchSnapshot(): Promise<SourceSnapshot> {
  const response = await fetch("/api/snapshot");
  return jsonOrThrow(response, "無法取得系統快照");
}

export async function fetchFeed(page = 1, pageSize = 12): Promise<FeedResponse> {
  const response = await fetch(`/api/feed?page=${page}&pageSize=${pageSize}`);
  return jsonOrThrow(response, "無法取得文章列表");
}

export async function fetchGraph(limit = 80): Promise<GraphResponse> {
  const response = await fetch(`/api/graph?limit=${limit}`);
  return jsonOrThrow(response, "無法取得圖譜資料");
}

export async function postCrawl(): Promise<SourceSnapshot> {
  const response = await fetch("/api/crawl", { method: "POST" });
  return jsonOrThrow(response, "重新同步資料失敗");
}

export async function postAnalyze(message: string): Promise<AnalysisResponse> {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  return jsonOrThrow(response, "分析流程失敗");
}

export async function postVerifySite(url: string): Promise<SiteVerificationResponse> {
  const response = await fetch("/api/verify-site", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  return jsonOrThrow(response, "網站驗證失敗");
}

export async function postReport(input: {
  message: string;
  reporterHint?: string;
  suspectedUrl?: string;
  suspectedChannel?: string;
}): Promise<{ report: UserReportRecord; analysis: AnalysisResponse | null }> {
  const response = await fetch("/api/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return jsonOrThrow(response, "回報失敗");
}

export async function fetchReports(limit = 30): Promise<{ reports: UserReportRecord[] }> {
  const response = await fetch(`/api/reports?limit=${limit}`);
  return jsonOrThrow(response, "無法取得回報列表");
}

export async function postChat(messages: ChatMessage[]): Promise<{ content: string; mode: "llm" | "local" }> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  return jsonOrThrow(response, "聊天請求失敗");
}
