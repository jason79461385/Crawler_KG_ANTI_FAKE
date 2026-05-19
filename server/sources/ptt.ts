import * as cheerio from "cheerio";
import { filterScamCandidate } from "../lib/contentFilter";
import { normalizePost } from "../lib/postUtils";

const USER_AGENT =
  "Mozilla/5.0 (compatible; ScamIntelDemo/1.0; +https://localhost)";
const BOARDS = [
  "Gossiping",
  "e-shopping",
  "part-time",
  "Salary",
  "MobilePay",
];
const TITLE_FILTER =
  /(詐騙|被騙|假投資|解除分期|保證金|假買家|165|假客服|求職詐騙|交友詐騙|虛擬貨幣)/i;
const CONTENT_SIGNAL =
  /(詐騙|被騙|165|假客服|保證金|解除分期|投資平台|保證獲利|指定帳戶|假買家|交友軟體|安全帳戶)/i;

export async function crawlPttPosts() {
  const posts = [];

  for (const board of BOARDS) {
    const articleLinks = await fetchBoardLinks(board);

    for (const link of articleLinks.slice(0, 4)) {
      const article = await fetchArticle(link, board);
      if (article) {
        posts.push(article);
      }
    }
  }

  if (posts.length === 0) {
    throw new Error("PTT crawler did not retrieve any scam-related posts.");
  }

  return posts;
}

async function fetchBoardLinks(board: string) {
  let pageUrl = `https://www.ptt.cc/bbs/${board}/index.html`;
  const collectedLinks: string[] = [];

  for (let depth = 0; depth < 4; depth += 1) {
    const response = await fetch(pageUrl, {
      headers: {
        Cookie: "over18=1",
        "User-Agent": USER_AGENT,
      },
    });

    if (!response.ok) {
      throw new Error(`PTT board fetch failed for ${board}: ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const pageLinks = $(".r-ent .title a")
      .toArray()
      .map((element) => {
        const anchor = $(element);
        return {
          href: anchor.attr("href"),
          title: anchor.text().trim(),
        };
      })
      .filter(
        (item): item is { href: string; title: string } =>
          Boolean(item.href) && TITLE_FILTER.test(item.title),
      )
      .map((item) => `https://www.ptt.cc${item.href}`);

    collectedLinks.push(...pageLinks);

    if (collectedLinks.length >= 4) {
      break;
    }

    const previousPage = $(".btn-group-paging a")
      .toArray()
      .map((element) => ({
        text: $(element).text().trim(),
        href: $(element).attr("href"),
      }))
      .find((item) => item.text.includes("上頁"))?.href;

    if (!previousPage) {
      break;
    }

    pageUrl = `https://www.ptt.cc${previousPage}`;
  }

  return [...new Set(collectedLinks)];
}

async function fetchArticle(url: string, board: string) {
  const response = await fetch(url, {
    headers: {
      Cookie: "over18=1",
      "User-Agent": USER_AGENT,
    },
  });

  if (!response.ok) {
    return null;
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const metaValues = $(".article-meta-value")
    .toArray()
    .map((element) => $(element).text().trim());
  const normalizedTitle =
    metaValues[2] || $("meta[property='og:title']").attr("content") || "";

  if (!TITLE_FILTER.test(normalizedTitle) && !CONTENT_SIGNAL.test($.text())) {
    return null;
  }

  const mainContent = $("#main-content").clone();
  mainContent.find(".article-metaline").remove();
  mainContent.find(".article-metaline-right").remove();
  mainContent.find(".push").remove();
  const content = mainContent.text().split("--")[0]?.replace(/\s+/g, " ").trim();

  if (!normalizedTitle || !content) {
    return null;
  }

  const verdict = filterScamCandidate({ title: normalizedTitle, content });
  if (!verdict.accept) {
    console.log(`[PTT] filtered out: ${verdict.reason} | ${normalizedTitle.slice(0, 50)}`);
    return null;
  }

  return normalizePost({
    id: extractArticleId(url),
    source: "PTT",
    board,
    title: normalizedTitle,
    content,
    url,
    });
}

function extractArticleId(url: string) {
  const match = url.match(/\/([^/]+)\.html$/);
  return match?.[1] ?? `ptt-${Date.now()}`;
}
