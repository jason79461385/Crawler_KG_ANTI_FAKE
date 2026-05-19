import { filterScamCandidate } from "../lib/contentFilter";
import { normalizePost } from "../lib/postUtils";
import type { DemoPost } from "../data/demoPosts";

// 165 全民防騙網真實 API(從 dashboard SPA bundle 反查得到)
//   POST https://165dashboard.tw/CIB_DWS_API/api/CaseSummary/GetCaseSummaryList
//   Body: { PageIndex, NumberOfPerPage, UsingPaging, SortOrderInfos }
//   Response: { body: { Detail: [...], TotalPages, RecordCount, ... } }
//
// 全資料集約 16 萬筆,我們只抓最新 N 筆作為 demo / 索引用。
// 若要全量存,改寫成 cron job 並分批寫入 SQLite。

const ENDPOINT = "https://165dashboard.tw/CIB_DWS_API/api/CaseSummary/GetCaseSummaryList";
const LIMIT = Number(process.env.DASHBOARD_165_LIMIT ?? "30");

type Case = {
  Id: string;
  CaseDate?: string;
  CityName?: string;
  CityId?: number;
  Summary?: string;
  CaseTitle?: string;
};

export async function crawlDashboard165Posts(): Promise<DemoPost[]> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; ScamIntelDemo/1.0)",
      Origin: "https://165dashboard.tw",
      Referer: "https://165dashboard.tw/",
    },
    body: JSON.stringify({
      PageIndex: 1,
      NumberOfPerPage: LIMIT,
      UsingPaging: true,
      SortOrderInfos: [{ PropertyName: "CaseDate", IsDesc: true }],
      SearchTermInfos: [],
    }),
  });

  if (!response.ok) {
    throw new Error(`165 dashboard API failed: ${response.status}`);
  }

  const json = (await response.json()) as {
    body?: { Detail?: Case[] };
    isSuccess?: boolean;
  };

  const items = json.body?.Detail ?? [];
  if (items.length === 0) {
    throw new Error("165 dashboard API 回傳空陣列");
  }

  const accepted: DemoPost[] = [];
  let filteredCount = 0;
  for (const item of items) {
    if (!item.Summary || !item.CaseTitle) continue;
    const cleaned = cleanText(item.Summary);
    const verdict = filterScamCandidate({
      title: item.CaseTitle,
      content: cleaned,
    });
    if (!verdict.accept) {
      filteredCount += 1;
      continue;
    }
    accepted.push(
      normalizePost({
        id: `165-${item.Id}`,
        source: "165 全民防騙網",
        board: item.CityName ?? "Unknown",
        title: `${item.CaseTitle} · ${item.CityName ?? ""}`,
        content: cleaned,
        // 165 案例詳情頁需 dashboard 互動才能存取,給 list URL 加 fragment 識別,避免被 url_hash dedup 折成單一節點
        url: `https://165dashboard.tw/case-detail/${item.Id}`,
        publishedAt: item.CaseDate ?? new Date().toISOString(),
      }),
    );
    if (accepted.length >= LIMIT) break;
  }

  if (filteredCount > 0) {
    console.log(`[165] filtered out ${filteredCount} non-case items`);
  }

  return accepted;
}

function cleanText(input: string): string {
  return input
    .replace(/\r\n|\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 1500);
}
