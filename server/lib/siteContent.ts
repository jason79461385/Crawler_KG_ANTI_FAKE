import * as cheerio from "cheerio";

export type SiteCategory =
  | "gambling"
  | "crypto-investment"
  | "phishing-impersonation"
  | "adult"
  | "high-pressure-cta";

export type ExtractedSite = {
  title: string;
  metaDescription: string;
  ogTitle: string;
  ogDescription: string;
  lang: string;
  textSample: string;
  headings: string[];
  formFields: string[];
  suspiciousFormFields: string[];
  externalScriptHosts: string[];
  externalLinkHosts: string[];
  categories: Array<{ category: SiteCategory; matches: string[] }>;
};

// Multilingual category dictionaries. Matched case-insensitively against
// extracted text + against the hostname/path for gambling.
const CATEGORY_PATTERNS: Record<SiteCategory, string[]> = {
  gambling: [
    // English
    "casino", "casinos", "slot", "slots", "jackpot", "roulette", "blackjack",
    "poker", "sportsbook", "wager", "gamble", "gambling", "sweepstake",
    "free spins", "welcome bonus", "deposit bonus", "live dealer",
    "betting", "bet now", "place your bet", "odds", "stake",
    // Traditional Chinese
    "賭場", "賭博", "博彩", "老虎機", "真人荷官", "體育投注", "百家樂",
    "輪盤", "二十一點", "撲克", "莊家", "出金", "入金", "首存", "返水",
    "彩金", "娛樂城",
    // Japanese / Korean
    "カジノ", "スロット", "ギャンブル", "베팅", "카지노", "슬롯",
  ],
  "crypto-investment": [
    "roi", "apy", "guaranteed profit", "double your bitcoin", "airdrop",
    "presale", "copy trading", "signal group", "auto trading bot",
    "passive income", "high yield",
    "保證獲利", "帶單", "跟單", "翻倍", "空投", "預售", "穩賺",
    "高報酬", "高收益", "穩定獲利", "套利", "量化交易",
  ],
  "phishing-impersonation": [
    "verify your account", "account suspended", "unusual activity",
    "confirm your identity", "kyc required", "two-factor", "otp code",
    "click here to unlock", "session expired", "re-authenticate",
    "帳戶異常", "帳戶凍結", "驗證身分", "補件", "立即驗證", "限時驗證",
    "解除限制", "重新登入",
  ],
  adult: [
    "escort", "hookup", "18+", "nsfw", "adult content",
    "約炮", "援交", "成人視訊", "一夜",
  ],
  "high-pressure-cta": [
    "limited time", "only today", "act now", "claim now", "register now",
    "限時優惠", "今日限定", "立即註冊", "立即入金", "立即領取", "馬上加入",
    "保證", "百分百",
  ],
};

const SUSPICIOUS_FIELD_PATTERNS = [
  /password/i,
  /passwd/i,
  /\botp\b/i,
  /one[-_ ]?time/i,
  /\bcvv\b/i,
  /\bcvc\b/i,
  /card[-_ ]?number/i,
  /credit[-_ ]?card/i,
  /\bssn\b/i,
  /id[-_ ]?number/i,
  /national[-_ ]?id/i,
  /身分證/,
  /信用卡/,
  /帳號/,
  /密碼/,
  /驗證碼/,
  /seed[-_ ]?phrase/i,
  /mnemonic/i,
  /private[-_ ]?key/i,
];

export function extractSiteContent(html: string, finalUrl: string): ExtractedSite {
  const $ = cheerio.load(html);

  let baseHost = "";
  try {
    baseHost = new URL(finalUrl).hostname.toLowerCase();
  } catch {
    /* ignore */
  }

  // Collect external script hosts BEFORE we strip <script> tags so we still
  // see them; the strip is only for visible-text extraction.
  const externalScriptHosts = collectExternalHosts($, "script[src]", "src", baseHost);
  const externalLinkHosts = collectExternalHosts($, "a[href]", "href", baseHost);

  // Remove script/style so visible text doesn't include code.
  $("script, style, noscript, template").remove();

  const title = ($("title").first().text() || "").trim().slice(0, 240);
  const metaDescription = (
    $('meta[name="description"]').attr("content") ?? ""
  ).trim().slice(0, 320);
  const ogTitle = ($('meta[property="og:title"]').attr("content") ?? "").trim().slice(0, 240);
  const ogDescription = (
    $('meta[property="og:description"]').attr("content") ?? ""
  ).trim().slice(0, 320);
  const lang = ($("html").attr("lang") ?? "").trim().slice(0, 16);

  const headings: string[] = [];
  $("h1, h2, h3").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text.length > 0 && headings.length < 24) {
      headings.push(text.slice(0, 200));
    }
  });

  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const textSample = bodyText.slice(0, 6000);

  const formFields: string[] = [];
  const suspiciousFormFields: string[] = [];
  $("input, select, textarea").each((_, el) => {
    const name = ($(el).attr("name") ?? "").trim();
    const type = ($(el).attr("type") ?? "").trim();
    const placeholder = ($(el).attr("placeholder") ?? "").trim();
    const label = [name, type, placeholder].filter(Boolean).join("|");
    if (!label) return;
    if (formFields.length < 32) {
      formFields.push(label.slice(0, 80));
    }
    const lower = label.toLowerCase();
    const matched = SUSPICIOUS_FIELD_PATTERNS.some((re) => re.test(lower));
    if (matched && suspiciousFormFields.length < 16) {
      suspiciousFormFields.push(label.slice(0, 80));
    }
  });

  // Build haystack for category matching. Lowercased for ASCII matches; CJK
  // patterns are still substring-matchable on the original text.
  const haystackText = [
    title,
    metaDescription,
    ogTitle,
    ogDescription,
    headings.join(" \n "),
    textSample,
  ].join(" \n ");
  const haystackHost = `${baseHost} ${tryGetPath(finalUrl)}`;

  const categories: ExtractedSite["categories"] = [];
  for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS) as Array<[
    SiteCategory,
    string[],
  ]>) {
    const matches: string[] = [];
    for (const pattern of patterns) {
      if (matches.length >= 8) break;
      const needle = pattern.toLowerCase();
      const inText = haystackText.toLowerCase().includes(needle);
      // For gambling we also look at hostname/path because polished sites
      // like twogamb.at hint their vertical in the domain itself.
      const inHost =
        category === "gambling" && haystackHost.includes(needle);
      if (inText || inHost) {
        matches.push(pattern);
      }
    }
    if (matches.length > 0) {
      categories.push({ category, matches });
    }
  }

  return {
    title,
    metaDescription,
    ogTitle,
    ogDescription,
    lang,
    textSample,
    headings,
    formFields,
    suspiciousFormFields,
    externalScriptHosts,
    externalLinkHosts,
    categories,
  };
}

function collectExternalHosts(
  $: cheerio.CheerioAPI,
  selector: string,
  attr: string,
  baseHost: string,
): string[] {
  const seen = new Set<string>();
  $(selector).each((_, el) => {
    if (seen.size >= 24) return;
    const raw = ($(el).attr(attr) ?? "").trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("javascript:")) return;
    try {
      const host = new URL(raw, `https://${baseHost || "x.invalid"}`).hostname.toLowerCase();
      if (host && host !== baseHost && !host.endsWith(`.${baseHost}`)) {
        seen.add(host);
      }
    } catch {
      /* ignore */
    }
  });
  return [...seen];
}

function tryGetPath(rawUrl: string): string {
  try {
    return new URL(rawUrl).pathname.toLowerCase();
  } catch {
    return "";
  }
}

export const CATEGORY_LABELS: Record<SiteCategory, string> = {
  gambling: "博彩/賭博",
  "crypto-investment": "加密貨幣投資招攬",
  "phishing-impersonation": "釣魚/冒名驗證",
  adult: "成人/色情",
  "high-pressure-cta": "高壓力 CTA",
};

export const CATEGORY_WEIGHTS: Record<SiteCategory, number> = {
  gambling: 28,
  "crypto-investment": 30,
  "phishing-impersonation": 34,
  adult: 14,
  "high-pressure-cta": 10,
};
