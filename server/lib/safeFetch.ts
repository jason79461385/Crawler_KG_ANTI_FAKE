import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const PRIVATE_RANGES: Array<(ip: string) => boolean> = [
  (ip) => ip === "0.0.0.0",
  (ip) => ip === "127.0.0.1" || ip.startsWith("127."),
  (ip) => ip.startsWith("10."),
  (ip) => /^192\.168\./.test(ip),
  (ip) => {
    const parts = ip.split(".").map(Number);
    return parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
  },
  (ip) => /^169\.254\./.test(ip),
  (ip) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip),
  (ip) => ip === "::1",
  (ip) => ip.toLowerCase().startsWith("fc") || ip.toLowerCase().startsWith("fd"),
  (ip) => ip.toLowerCase().startsWith("fe80"),
];

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
  "instance-data",
]);

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_BYTES = 256 * 1024; // 256KB
const DEFAULT_MAX_REDIRECTS = 3;

export class SsrfBlockedError extends Error {
  constructor(reason: string) {
    super(`SSRF blocked: ${reason}`);
    this.name = "SsrfBlockedError";
  }
}

export type SafeFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  userAgent?: string;
};

export type SafeFetchResult = {
  url: string;
  status: number;
  ok: boolean;
  text: string;
  truncated: boolean;
  finalUrl: string;
};

export async function assertSafeUrl(rawUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError("invalid URL");
  }

  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new SsrfBlockedError(`disallowed protocol ${parsed.protocol}`);
  }

  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new SsrfBlockedError(`hostname ${host} is blocked`);
  }

  if (host.endsWith(".local") || host.endsWith(".internal")) {
    throw new SsrfBlockedError(`hostname ${host} is blocked`);
  }

  if (isIP(host)) {
    if (isPrivateIp(host)) {
      throw new SsrfBlockedError(`private IP ${host} is blocked`);
    }
    return;
  }

  const records = await lookup(host, { all: true });
  for (const record of records) {
    if (isPrivateIp(record.address)) {
      throw new SsrfBlockedError(
        `hostname ${host} resolves to private IP ${record.address}`,
      );
    }
  }
}

export function isPrivateIp(ip: string): boolean {
  if (!isIP(ip)) {
    return false;
  }
  return PRIVATE_RANGES.some((check) => check(ip));
}

export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const userAgent =
    options.userAgent ??
    "Mozilla/5.0 (compatible; ScamIntelDemo/1.0; +https://localhost)";

  let currentUrl = rawUrl;
  let redirects = 0;

  while (true) {
    await assertSafeUrl(currentUrl);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": userAgent,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      if (!next) {
        return {
          url: rawUrl,
          status: response.status,
          ok: false,
          text: "",
          truncated: false,
          finalUrl: currentUrl,
        };
      }
      redirects += 1;
      if (redirects > maxRedirects) {
        throw new SsrfBlockedError("too many redirects");
      }
      currentUrl = new URL(next, currentUrl).toString();
      continue;
    }

    const reader = response.body?.getReader();
    let received = 0;
    let truncated = false;
    const chunks: Uint8Array[] = [];

    if (reader) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          received += value.byteLength;
          if (received > maxBytes) {
            truncated = true;
            try {
              await reader.cancel();
            } catch {
              /* ignore */
            }
            break;
          }
          chunks.push(value);
        }
      }
    }

    const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);

    return {
      url: rawUrl,
      status: response.status,
      ok: response.ok,
      text,
      truncated,
      finalUrl: currentUrl,
    };
  }
}
