import { countPhishUrls, lookupPhishUrl, upsertPhishUrls } from "./db";

const SAFE_BROWSING_KEY = process.env.GOOGLE_SAFE_BROWSING_KEY;
const PHISHTANK_URL =
  process.env.PHISHTANK_FEED_URL ??
  "https://data.phishtank.com/data/online-valid.json";
const OPENPHISH_URL =
  process.env.OPENPHISH_FEED_URL ?? "https://openphish.com/feed.txt";
const PHISH_REFRESH_HOURS = Number(process.env.PHISH_REFRESH_HOURS ?? "12");

let lastFeedRefresh = 0;

export type SafeBrowsingThreat = {
  threatType: string;
  platformType: string;
};

export async function checkGoogleSafeBrowsing(
  url: string,
): Promise<SafeBrowsingThreat[]> {
  if (!SAFE_BROWSING_KEY) {
    return [];
  }
  const endpoint = `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${SAFE_BROWSING_KEY}`;
  const body = {
    client: { clientId: "scam-intel-console", clientVersion: "1.0" },
    threatInfo: {
      threatTypes: [
        "MALWARE",
        "SOCIAL_ENGINEERING",
        "UNWANTED_SOFTWARE",
        "POTENTIALLY_HARMFUL_APPLICATION",
      ],
      platformTypes: ["ANY_PLATFORM"],
      threatEntryTypes: ["URL"],
      threatEntries: [{ url }],
    },
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    return [];
  }

  const data = (await response.json()) as {
    matches?: Array<{ threatType: string; platformType: string }>;
  };

  return (data.matches ?? []).map((match) => ({
    threatType: match.threatType,
    platformType: match.platformType,
  }));
}

export function isSafeBrowsingConfigured() {
  return Boolean(SAFE_BROWSING_KEY);
}

export type PhishMatch = {
  source: string;
  url: string;
};

export function lookupPhishingUrl(url: string): PhishMatch | null {
  return lookupPhishUrl(url);
}

export function getThreatIntelStatus() {
  return {
    safeBrowsingEnabled: isSafeBrowsingConfigured(),
    phishUrlCount: countPhishUrls(),
    lastFeedRefresh: lastFeedRefresh
      ? new Date(lastFeedRefresh).toISOString()
      : null,
  };
}

export async function refreshPhishFeeds(force = false) {
  const now = Date.now();
  const stale = now - lastFeedRefresh > PHISH_REFRESH_HOURS * 60 * 60 * 1000;
  if (!force && !stale) {
    return { skipped: true };
  }

  const collected: Array<{ url: string; source: string }> = [];

  await Promise.allSettled([
    fetchOpenPhish().then((urls) => {
      collected.push(...urls);
    }),
    fetchPhishTank().then((urls) => {
      collected.push(...urls);
    }),
  ]);

  if (collected.length > 0) {
    upsertPhishUrls(collected);
    lastFeedRefresh = now;
  }

  return { skipped: false, count: collected.length };
}

async function fetchOpenPhish(): Promise<Array<{ url: string; source: string }>> {
  try {
    const response = await fetch(OPENPHISH_URL, {
      headers: { "User-Agent": "ScamIntelDemo/1.0" },
    });
    if (!response.ok) return [];
    const text = await response.text();
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 5000)
      .map((url) => ({ url, source: "openphish" }));
  } catch {
    return [];
  }
}

async function fetchPhishTank(): Promise<Array<{ url: string; source: string }>> {
  try {
    const response = await fetch(PHISHTANK_URL, {
      headers: { "User-Agent": "ScamIntelDemo/1.0" },
    });
    if (!response.ok) return [];
    const data = (await response.json()) as Array<{ url?: string }>;
    return data
      .map((row) => row.url)
      .filter((url): url is string => Boolean(url))
      .slice(0, 5000)
      .map((url) => ({ url, source: "phishtank" }));
  } catch {
    return [];
  }
}
