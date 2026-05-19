import { XMLParser } from "fast-xml-parser";
import { filterScamCandidate } from "../lib/contentFilter";
import { normalizePost } from "../lib/postUtils";

const NEWS_QUERY = encodeURIComponent("詐騙 OR 假投資 OR 解除分期 OR 假買家");
const NEWS_URL = `https://news.google.com/rss/search?q=${NEWS_QUERY}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;

type RssItem = {
  title?: string;
  link?: string;
  description?: string;
  pubDate?: string;
};

export async function crawlGoogleNewsPosts() {
  const response = await fetch(NEWS_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; ScamIntelDemo/1.0; +https://localhost)",
    },
  });

  if (!response.ok) {
    throw new Error(`Google News RSS fetch failed: ${response.status}`);
  }

  const xml = await response.text();
  const parser = new XMLParser({
    ignoreAttributes: false,
    trimValues: true,
  });
  const parsed = parser.parse(xml) as {
    rss?: {
      channel?: {
        item?: RssItem | RssItem[];
      };
    };
  };

  const items = parsed.rss?.channel?.item;
  const normalizedItems = Array.isArray(items) ? items : items ? [items] : [];

  // 先抓多一點(20 筆),再經 contentFilter 篩到實際案例,最後上限取 12 筆
  const candidates = await Promise.all(
    normalizedItems.slice(0, 20).map(async (item, index) => ({
      raw: {
        title: sanitize(item.title ?? ""),
        content: sanitize(item.description ?? item.link ?? ""),
      },
      post: normalizePost({
        id: `google-news-${index}`,
        source: "Google News" as const,
        board: "News Search",
        title: sanitize(item.title ?? "Google News 詐騙案例"),
        content: sanitize(item.description ?? item.link ?? ""),
        url: item.link ? await resolveArticleUrl(item.link) : undefined,
        publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : undefined,
      }),
    })),
  );

  const filtered: ReturnType<typeof normalizePost>[] = [];
  const dropped: string[] = [];
  for (const { raw, post } of candidates) {
    const verdict = filterScamCandidate(raw);
    if (verdict.accept) {
      filtered.push(post);
    } else {
      dropped.push(`${verdict.reason} | ${raw.title.slice(0, 50)}`);
    }
  }

  if (dropped.length > 0) {
    console.log(`[GoogleNews] filtered out ${dropped.length} non-case items:`);
    for (const item of dropped.slice(0, 8)) {
      console.log(`  - ${item}`);
    }
  }

  if (filtered.length === 0) {
    throw new Error("Google News RSS 抓到的內容皆被過濾(可能全是宣導/政治類)。");
  }

  return filtered.slice(0, 12);
}

function sanitize(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function resolveArticleUrl(url: string) {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; ScamIntelDemo/1.0; +https://localhost)",
      },
    });

    return response.url || url;
  } catch {
    return url;
  }
}
