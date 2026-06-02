import { lookup } from "node:dns/promises";
import { isIP, isIPv6 } from "node:net";
import type { LookupAddress, LookupOptions } from "node:dns";
import { Agent, fetch as undiciFetch, type Dispatcher } from "undici";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_BYTES = 256 * 1024; // 256KB
const DEFAULT_MAX_REDIRECTS = 3;

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
  "instance-data",
]);

// ---------------------------------------------------------------------------
// IPv4 CIDR blocklist
// ---------------------------------------------------------------------------

type Cidr4 = { base: number; mask: number; label: string };

function makeCidr4(cidr: string, label: string): Cidr4 {
  const [ip, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const base = ipv4ToUint32(ip);
  if (base === null) {
    throw new Error(`invalid CIDR base ${cidr}`);
  }
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { base: (base & mask) >>> 0, mask, label };
}

const IPV4_BLOCKED_RANGES: Cidr4[] = [
  makeCidr4("0.0.0.0/8", "this-network"),
  makeCidr4("10.0.0.0/8", "private"),
  makeCidr4("100.64.0.0/10", "cgnat"),
  makeCidr4("127.0.0.0/8", "loopback"),
  makeCidr4("169.254.0.0/16", "link-local"),
  makeCidr4("172.16.0.0/12", "private"),
  makeCidr4("192.0.0.0/24", "ietf"),
  makeCidr4("192.0.2.0/24", "test-net-1"),
  makeCidr4("192.168.0.0/16", "private"),
  makeCidr4("198.18.0.0/15", "benchmark"),
  makeCidr4("198.51.100.0/24", "test-net-2"),
  makeCidr4("203.0.113.0/24", "test-net-3"),
  makeCidr4("224.0.0.0/4", "multicast"),
  makeCidr4("240.0.0.0/4", "reserved"),
];

// ---------------------------------------------------------------------------
// IPv6 CIDR blocklist
// ---------------------------------------------------------------------------

type Cidr6 = { base: bigint; mask: bigint; bits: number; label: string };

function makeCidr6(cidr: string, label: string): Cidr6 {
  const [ip, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const base = parseIPv6ToBigInt(ip);
  if (base === null) {
    throw new Error(`invalid IPv6 CIDR base ${cidr}`);
  }
  const mask =
    bits === 0
      ? 0n
      : ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits);
  return { base: base & mask, mask, bits, label };
}

const IPV6_BLOCKED_RANGES: Cidr6[] = [
  makeCidr6("::/128", "unspecified"),
  makeCidr6("::1/128", "loopback"),
  // ::ffff:0:0/96 (IPv4-mapped) is handled by extractEmbeddedIPv4 + IPv4 ranges.
  makeCidr6("64:ff9b::/96", "nat64"),
  makeCidr6("100::/64", "discard"),
  makeCidr6("2001::/32", "teredo"),
  makeCidr6("2001:db8::/32", "documentation"),
  makeCidr6("fc00::/7", "ula"),
  makeCidr6("fe80::/10", "link-local"),
  makeCidr6("ff00::/8", "multicast"),
];

const IPV4_MAPPED_PREFIX = parseIPv6ToBigIntRaw("::ffff:0:0");
const IPV4_MAPPED_MASK =
  ((1n << 96n) - 1n) << 32n; // top 96 bits

// ---------------------------------------------------------------------------
// IPv4 literal parsing (classic / glibc-style)
// ---------------------------------------------------------------------------

/**
 * Parse a single IPv4 component into a non-negative integer.
 * - Hex: 0x..., 0X...
 * - Octal: leading 0 (e.g. "0177"); "0" alone is decimal 0.
 * - Decimal: otherwise.
 * Returns null on empty or invalid input.
 */
function parseIPv4Part(part: string): number | null {
  if (part.length === 0) return null;
  let value: number;
  if (/^0[xX][0-9a-fA-F]+$/.test(part)) {
    value = parseInt(part.slice(2), 16);
  } else if (/^0[0-7]+$/.test(part)) {
    value = parseInt(part.slice(1), 8);
  } else if (/^(0|[1-9][0-9]*)$/.test(part)) {
    // Decimal: either "0" alone, or a non-zero leading digit followed by
    // more digits. Reject ambiguous forms like "08" (not a valid octal,
    // and treating as decimal would silently disagree with classic
    // libc resolvers that interpret leading-zero as octal).
    value = parseInt(part, 10);
  } else {
    return null;
  }
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

/**
 * Parse an IPv4 literal in any classic form and return canonical "a.b.c.d".
 *
 * Accepts: "127.0.0.1", "0177.0.0.1", "0x7f.0.0.1", "127.0.1", "127.1",
 *          "2130706433", "0x7f000001", "017700000001".
 *
 * Rules:
 *  - 4 parts: each must fit in 8 bits.
 *  - 3 parts: last part fits in 16 bits, others in 8 bits.
 *  - 2 parts: last part fits in 24 bits, first in 8 bits.
 *  - 1 part:  must fit in 32 bits.
 *  - Empty parts or non-numeric components return null.
 *  - More than 4 parts returns null.
 */
export function parseClassicIPv4(input: string): string | null {
  if (typeof input !== "string" || input.length === 0) return null;
  // Strict: no whitespace or trailing dots.
  if (/\s/.test(input)) return null;
  if (input.endsWith(".")) return null;

  const parts = input.split(".");
  if (parts.length < 1 || parts.length > 4) return null;

  const nums: number[] = [];
  for (const p of parts) {
    const n = parseIPv4Part(p);
    if (n === null) return null;
    nums.push(n);
  }

  let value: bigint;
  switch (nums.length) {
    case 4: {
      if (nums.some((n) => n > 0xff)) return null;
      value =
        (BigInt(nums[0]) << 24n) |
        (BigInt(nums[1]) << 16n) |
        (BigInt(nums[2]) << 8n) |
        BigInt(nums[3]);
      break;
    }
    case 3: {
      if (nums[0] > 0xff || nums[1] > 0xff) return null;
      if (nums[2] > 0xffff) return null;
      value =
        (BigInt(nums[0]) << 24n) |
        (BigInt(nums[1]) << 16n) |
        BigInt(nums[2]);
      break;
    }
    case 2: {
      if (nums[0] > 0xff) return null;
      if (nums[1] > 0xffffff) return null;
      value = (BigInt(nums[0]) << 24n) | BigInt(nums[1]);
      break;
    }
    case 1: {
      if (nums[0] > 0xffffffff) return null;
      value = BigInt(nums[0]);
      break;
    }
    default:
      return null;
  }

  if (value > 0xffffffffn || value < 0n) return null;

  const a = Number((value >> 24n) & 0xffn);
  const b = Number((value >> 16n) & 0xffn);
  const c = Number((value >> 8n) & 0xffn);
  const d = Number(value & 0xffn);
  return `${a}.${b}.${c}.${d}`;
}

function ipv4ToUint32(ip: string): number | null {
  // Strict dotted-quad only (used internally for known-good CIDRs).
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const p of parts) {
    if (!/^[0-9]+$/.test(p)) return null;
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 0xff) return null;
    value = ((value << 8) | n) >>> 0;
  }
  return value >>> 0;
}

function canonicalDottedToUint32(ip: string): number | null {
  return ipv4ToUint32(ip);
}

// ---------------------------------------------------------------------------
// IPv6 parsing
// ---------------------------------------------------------------------------

function parseIPv6ToBigIntRaw(input: string): bigint {
  // Caller has already validated via isIPv6 or controls the literal.
  const v = parseIPv6ToBigInt(input);
  if (v === null) throw new Error(`bad IPv6 literal: ${input}`);
  return v;
}

/**
 * Parse an IPv6 literal (with optional "::" elision and optional trailing
 * dotted-quad IPv4) into a 128-bit BigInt. Returns null if the input is not
 * a valid IPv6 string per Node's net.isIPv6.
 */
export function parseIPv6ToBigInt(input: string): bigint | null {
  if (typeof input !== "string" || input.length === 0) return null;
  // Strip zone id (e.g. "fe80::1%eth0").
  const zoneIdx = input.indexOf("%");
  const cleaned = zoneIdx >= 0 ? input.slice(0, zoneIdx) : input;
  if (!isIPv6(cleaned)) return null;

  // Handle embedded IPv4 form (e.g. "::ffff:1.2.3.4"). Rewrite the trailing
  // dotted-quad into two hex groups, so the rest of the parser only has to
  // deal with pure hex groups separated by ':'.
  let head = cleaned;
  const dotIdx = cleaned.indexOf(".");
  if (dotIdx >= 0) {
    const lastColonBeforeDot = cleaned.lastIndexOf(":", dotIdx);
    if (lastColonBeforeDot < 0) return null;
    const v4Str = cleaned.slice(lastColonBeforeDot + 1);
    const v4 = parseClassicIPv4(v4Str);
    if (v4 === null) return null;
    const u32 = canonicalDottedToUint32(v4);
    if (u32 === null) return null;
    const hi = ((u32 >>> 16) & 0xffff).toString(16);
    const lo = (u32 & 0xffff).toString(16);
    head = `${cleaned.slice(0, lastColonBeforeDot + 1)}${hi}:${lo}`;
  }

  // Split around "::".
  const doubleColonIdx = head.indexOf("::");
  let leftParts: string[] = [];
  let rightParts: string[] = [];
  if (doubleColonIdx >= 0) {
    const leftStr = head.slice(0, doubleColonIdx);
    const rightStr = head.slice(doubleColonIdx + 2);
    leftParts = leftStr.length > 0 ? leftStr.split(":") : [];
    rightParts = rightStr.length > 0 ? rightStr.split(":") : [];
  } else {
    leftParts = head.split(":");
  }

  const totalGroups = leftParts.length + rightParts.length;
  if (totalGroups > 8) return null;
  const zeroFill = 8 - totalGroups;
  const groups: string[] = [
    ...leftParts,
    ...Array(doubleColonIdx >= 0 ? zeroFill : 0).fill("0"),
    ...rightParts,
  ];
  if (groups.length !== 8) return null;

  let value = 0n;
  for (const g of groups) {
    if (g.length === 0 || g.length > 4) return null;
    if (!/^[0-9a-fA-F]+$/.test(g)) return null;
    const part = BigInt(parseInt(g, 16));
    value = (value << 16n) | part;
  }
  return value;
}

/**
 * If the given 128-bit value sits inside ::ffff:0:0/96 (IPv4-mapped),
 * return the embedded IPv4 as a dotted-quad string. Otherwise null.
 */
export function extractEmbeddedIPv4(value: bigint): string | null {
  if ((value & IPV4_MAPPED_MASK) !== IPV4_MAPPED_PREFIX) return null;
  const u32 = Number(value & 0xffffffffn);
  const a = (u32 >>> 24) & 0xff;
  const b = (u32 >>> 16) & 0xff;
  const c = (u32 >>> 8) & 0xff;
  const d = u32 & 0xff;
  return `${a}.${b}.${c}.${d}`;
}

// ---------------------------------------------------------------------------
// Range checks
// ---------------------------------------------------------------------------

function isPrivateIPv4Uint32(value: number): boolean {
  const u = value >>> 0;
  for (const range of IPV4_BLOCKED_RANGES) {
    if ((u & range.mask) >>> 0 === range.base) return true;
  }
  return false;
}

function isPrivateIPv4(ip: string): boolean {
  const u = canonicalDottedToUint32(ip);
  if (u === null) return false;
  return isPrivateIPv4Uint32(u);
}

function isPrivateIPv6BigInt(value: bigint): boolean {
  // First, handle IPv4-mapped (::ffff:0:0/96) by recursing through IPv4 ranges.
  const mapped = extractEmbeddedIPv4(value);
  if (mapped !== null) {
    return isPrivateIPv4(mapped);
  }
  for (const range of IPV6_BLOCKED_RANGES) {
    if ((value & range.mask) === range.base) return true;
  }
  return false;
}

/**
 * True if the given IP literal (v4 or v6, any classic form) sits inside
 * a blocked range. Returns false for inputs that are not valid IP literals.
 */
export function isPrivateIp(ip: string): boolean {
  if (typeof ip !== "string" || ip.length === 0) return false;

  // Try IPv4 classic forms first.
  const canonical = parseClassicIPv4(ip);
  if (canonical !== null) {
    return isPrivateIPv4(canonical);
  }

  // Fall back to IPv6.
  if (isIPv6(ip) || isIPv6(stripZoneId(ip))) {
    const v = parseIPv6ToBigInt(ip);
    if (v === null) return false;
    return isPrivateIPv6BigInt(v);
  }

  return false;
}

function stripZoneId(ip: string): string {
  const idx = ip.indexOf("%");
  return idx >= 0 ? ip.slice(0, idx) : ip;
}

// ---------------------------------------------------------------------------
// Errors / types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Undici pinned lookup / agent
// ---------------------------------------------------------------------------

type NodeLookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

type PinnedLookup = (
  hostname: string,
  optionsOrCallback: LookupOptions | NodeLookupCallback,
  maybeCallback?: NodeLookupCallback,
) => void;

/**
 * Build a Node-style `lookup` callback that always resolves to the given IP.
 * Supports both `lookup(hostname, callback)` and
 * `lookup(hostname, options, callback)` shapes. When the caller passes
 * `{ all: true }` (as undici does) we respond with an array.
 */
export function makePinnedLookup(ip: string): PinnedLookup {
  const family: 4 | 6 = ip.includes(":") ? 6 : 4;
  return function pinnedLookup(
    _hostname: string,
    optionsOrCallback: LookupOptions | NodeLookupCallback,
    maybeCallback?: NodeLookupCallback,
  ) {
    let options: LookupOptions = {};
    let cb: NodeLookupCallback | undefined;
    if (typeof optionsOrCallback === "function") {
      cb = optionsOrCallback;
    } else {
      options = optionsOrCallback ?? {};
      cb = maybeCallback;
    }
    if (typeof cb !== "function") return;

    if (options.all) {
      cb(null, [{ address: ip, family } as LookupAddress]);
    } else {
      cb(null, ip, family);
    }
  };
}

/**
 * Build an undici Dispatcher that forces every TCP connection to dial `ip`,
 * while leaving SNI / cert validation tied to the URL hostname.
 */
export function makePinnedAgent(ip: string): Agent {
  const lookup = makePinnedLookup(ip);
  // undici's `connect.lookup` is typed as Node's net.LookupFunction, which is
  // structurally the same shape as our PinnedLookup. Cast through unknown to
  // bridge the two declaration sources.
  return new Agent({
    connect: { lookup: lookup as unknown as never },
  });
}

// ---------------------------------------------------------------------------
// URL safety
// ---------------------------------------------------------------------------

type ResolvedHost = {
  hostname: string;
  pinnedIp: string;
};

/**
 * Throws SsrfBlockedError if `rawUrl` is unsafe. Otherwise returns the
 * resolved hostname plus an IP to pin the connection to. The pinned IP is
 * guaranteed to be one of the addresses that passed the blocklist check.
 */
async function resolveSafeUrl(rawUrl: string): Promise<ResolvedHost> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError("invalid URL");
  }

  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new SsrfBlockedError(`disallowed protocol ${parsed.protocol}`);
  }

  // URL hostnames for IPv6 are wrapped in brackets ("[::1]"); strip them.
  const rawHost = parsed.hostname;
  const host = rawHost
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .toLowerCase();

  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new SsrfBlockedError(`hostname ${host} is blocked`);
  }
  if (host.endsWith(".local") || host.endsWith(".internal")) {
    throw new SsrfBlockedError(`hostname ${host} is blocked`);
  }

  // IPv4 literal (any classic form)?
  const canonicalV4 = parseClassicIPv4(host);
  if (canonicalV4 !== null) {
    if (isPrivateIPv4(canonicalV4)) {
      throw new SsrfBlockedError(`private IP ${host} is blocked`);
    }
    return { hostname: host, pinnedIp: canonicalV4 };
  }

  // IPv6 literal?
  if (isIPv6(host)) {
    const v = parseIPv6ToBigInt(host);
    if (v === null) {
      throw new SsrfBlockedError(`invalid IPv6 literal ${host}`);
    }
    if (isPrivateIPv6BigInt(v)) {
      throw new SsrfBlockedError(`private IP ${host} is blocked`);
    }
    return { hostname: host, pinnedIp: host };
  }

  // Otherwise it's a hostname: resolve every record, block if any is private,
  // and pin to the first.
  let records: LookupAddress[];
  try {
    records = await lookup(host, { all: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new SsrfBlockedError(`DNS lookup failed for ${host}: ${reason}`);
  }
  if (records.length === 0) {
    throw new SsrfBlockedError(`DNS lookup returned no records for ${host}`);
  }

  for (const record of records) {
    if (isPrivateIp(record.address)) {
      throw new SsrfBlockedError(
        `hostname ${host} resolves to private IP ${record.address}`,
      );
    }
  }

  return { hostname: host, pinnedIp: records[0].address };
}

/**
 * Backward-compatible assertion helper. Throws SsrfBlockedError if the URL
 * targets a disallowed protocol, hostname, or IP range.
 */
export async function assertSafeUrl(rawUrl: string): Promise<void> {
  await resolveSafeUrl(rawUrl);
}

// ---------------------------------------------------------------------------
// safeFetch
// ---------------------------------------------------------------------------

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
    const { pinnedIp } = await resolveSafeUrl(currentUrl);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const pinnedAgent = makePinnedAgent(pinnedIp);

    let response: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      response = await undiciFetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        dispatcher: pinnedAgent as unknown as Dispatcher,
        headers: {
          "User-Agent": userAgent,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
    } finally {
      clearTimeout(timer);
    }

    try {
      if (response.status >= 300 && response.status < 400) {
        const next = response.headers.get("location");
        if (!next) {
          // No Location header — treat as terminal response with no body.
          try {
            await response.body?.cancel();
          } catch {
            /* ignore */
          }
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
          try {
            await response.body?.cancel();
          } catch {
            /* ignore */
          }
          throw new SsrfBlockedError("too many redirects");
        }
        try {
          await response.body?.cancel();
        } catch {
          /* ignore */
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
        ok: response.status >= 200 && response.status < 300,
        text,
        truncated,
        finalUrl: currentUrl,
      };
    } finally {
      // Tear down the per-hop connection pool so we don't leak sockets.
      try {
        await pinnedAgent.close();
      } catch {
        /* ignore */
      }
    }
  }
}
