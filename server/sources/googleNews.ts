import { XMLParser } from "fast-xml-parser";
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

  const posts = await Promise.all(
    normalizedItems.slice(0, 8).map(async (item, index) =>
      normalizePost({
        id: `google-news-${index}`,
        source: "Google News",
        board: "News Search",
        title: sanitize(item.title ?? "Google News 詐騙案例"),
        content: sanitize(item.description ?? item.link ?? ""),
        url: item.link ? await resolveArticleUrl(item.link) : undefined,
        publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : undefined,
      }),
    ),
  );

  if (posts.length === 0) {
    throw new Error("Google News RSS did not return usable items.");
  }

  return posts;
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
