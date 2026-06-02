// Exhaustive test suite for server/lib/safeFetch.ts
//
// Run with:  node --import tsx test-ssrf-defense.mjs
//
// Standalone — only Node built-ins + the safeFetch module.

import assert from "node:assert/strict";
import {
  parseClassicIPv4,
  parseIPv6ToBigInt,
  extractEmbeddedIPv4,
  isPrivateIp,
  assertSafeUrl,
  SsrfBlockedError,
  makePinnedLookup,
  safeFetch,
} from "./server/lib/safeFetch.ts";

// ---------------------------------------------------------------------------
// Tiny test runner
// ---------------------------------------------------------------------------

let total = 0;
let passed = 0;
const failures = [];
const skipped = [];

async function test(name, fn) {
  total += 1;
  try {
    await fn();
    passed += 1;
  } catch (err) {
    failures.push({ name, err });
    const msg = err && err.message ? err.message : String(err);
    console.log(`  FAIL  ${name}`);
    console.log(`        ${msg}`);
  }
}

function skip(name, reason) {
  total += 1;
  skipped.push({ name, reason });
  console.log(`  SKIP  ${name} — ${reason}`);
}

function section(title) {
  console.log("");
  console.log(`===== ${title} =====`);
}

// Detect "connection-style" errors as opposed to SsrfBlockedError.
function isNetworkError(err) {
  if (err instanceof SsrfBlockedError) return false;
  if (!err) return false;
  const code = err.code || (err.cause && err.cause.code);
  const msg = (err.message || "") + " " + ((err.cause && err.cause.message) || "");
  if (code) {
    if (
      [
        "ENOTFOUND",
        "EAI_AGAIN",
        "ECONNREFUSED",
        "ECONNRESET",
        "ETIMEDOUT",
        "EHOSTUNREACH",
        "ENETUNREACH",
        "UND_ERR_CONNECT_TIMEOUT",
        "UND_ERR_SOCKET",
      ].includes(code)
    ) {
      return true;
    }
  }
  if (
    /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|connect|getaddrinfo|other side closed|aborted/i.test(
      msg,
    )
  ) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// §1 — parseClassicIPv4 normalisation
// ---------------------------------------------------------------------------

section("§1 parseClassicIPv4 normalisation");

const v4Cases = [
  ["127.0.0.1", "127.0.0.1"],
  ["0.0.0.0", "0.0.0.0"],
  ["255.255.255.255", "255.255.255.255"],
  ["2130706433", "127.0.0.1"],
  ["0x7f000001", "127.0.0.1"],
  ["017700000001", "127.0.0.1"],
  ["0177.0.0.1", "127.0.0.1"],
  ["0x7f.0.0.1", "127.0.0.1"],
  ["127.1", "127.0.0.1"],
  ["127.0.1", "127.0.0.1"],
  ["0", "0.0.0.0"],
  ["8.8.8.8", "8.8.8.8"],
  ["169.254.169.254", "169.254.169.254"],
  ["256.0.0.1", null],
  ["1.2.3.4.5", null],
  ["1.5000000000", null],
  ["not.an.ip", null],
  ["", null],
  [".0.0.1", null],
  ["127..0.1", null],
  ["08.0.0.1", null],
];

for (const [input, expected] of v4Cases) {
  await test(`parseClassicIPv4(${JSON.stringify(input)}) -> ${JSON.stringify(expected)}`, () => {
    assert.strictEqual(parseClassicIPv4(input), expected);
  });
}

// ---------------------------------------------------------------------------
// §2 — IPv6 / mapped extraction
// ---------------------------------------------------------------------------

section("§2 IPv6 / mapped extraction");

const v6Cases = [
  ["::ffff:127.0.0.1", "127.0.0.1"],
  ["::ffff:7f00:1", "127.0.0.1"],
  ["::ffff:169.254.169.254", "169.254.169.254"],
  ["::ffff:a9fe:a9fe", "169.254.169.254"],
  ["fe80::1", null],
  ["::1", null],
  ["2001:db8::1", null],
];

for (const [input, expected] of v6Cases) {
  await test(`extractEmbeddedIPv4(parseIPv6ToBigInt(${JSON.stringify(input)})) -> ${JSON.stringify(expected)}`, () => {
    const big = parseIPv6ToBigInt(input);
    assert.notStrictEqual(big, null, `parseIPv6ToBigInt returned null for ${input}`);
    assert.strictEqual(extractEmbeddedIPv4(big), expected);
  });
}

// ---------------------------------------------------------------------------
// §3 — isPrivateIp comprehensive
// ---------------------------------------------------------------------------

section("§3 isPrivateIp comprehensive");

const privateInputs = [
  "127.0.0.1",
  "127.255.255.255",
  "10.0.0.1",
  "10.255.255.255",
  "0.0.0.0",
  "0.1.2.3",
  "169.254.169.254",
  "172.16.0.1",
  "172.31.255.255",
  "192.168.0.1",
  "100.64.0.1",
  "100.127.255.255",
  "192.0.0.5",
  "192.0.2.10",
  "198.18.0.1",
  "198.51.100.5",
  "203.0.113.5",
  "224.0.0.1",
  "240.0.0.1",
  "255.255.255.255",
  "::1",
  "::",
  "::ffff:127.0.0.1",
  "::ffff:169.254.169.254",
  "64:ff9b::a9fe:a9fe",
  "fe80::1",
  "fc00::1",
  "fdab::1",
  "2001::1",
  "2001:db8::1",
  "ff02::1",
  "100::1",
];

const publicInputs = [
  "8.8.8.8",
  "1.1.1.1",
  "172.32.0.1",
  "172.15.255.254",
  "100.128.0.1",
  "100.63.255.255",
  "223.255.255.255",
  "::ffff:8.8.8.8",
  "2001:4860:4860::8888",
];

for (const ip of privateInputs) {
  await test(`isPrivateIp(${JSON.stringify(ip)}) === true`, () => {
    assert.strictEqual(isPrivateIp(ip), true);
  });
}

for (const ip of publicInputs) {
  await test(`isPrivateIp(${JSON.stringify(ip)}) === false`, () => {
    assert.strictEqual(isPrivateIp(ip), false);
  });
}

// ---------------------------------------------------------------------------
// §4 — assertSafeUrl (no real DNS for IP literals)
// ---------------------------------------------------------------------------

section("§4 assertSafeUrl");

const blockedUrls = [
  "http://localhost/",
  "http://127.0.0.1/",
  "http://[::1]/",
  "http://[::ffff:127.0.0.1]/",
  "http://[::ffff:169.254.169.254]/",
  "http://2130706433/",
  "http://0x7f000001/",
  "http://017700000001/",
  "http://127.1/",
  "http://0/",
  "http://[64:ff9b::a9fe:a9fe]/",
  "file:///etc/passwd",
  "gopher://127.0.0.1/",
  "dict://127.0.0.1:11211/",
  "ftp://127.0.0.1/",
  "http://10.0.0.5:8080/",
  "http://169.254.169.254/latest/meta-data",
  "http://192.168.1.1/",
];

for (const url of blockedUrls) {
  await test(`assertSafeUrl(${JSON.stringify(url)}) throws SsrfBlockedError`, async () => {
    await assert.rejects(
      () => assertSafeUrl(url),
      (err) => {
        assert.ok(err instanceof SsrfBlockedError, `expected SsrfBlockedError, got ${err && err.constructor && err.constructor.name}: ${err && err.message}`);
        return true;
      },
    );
  });
}

const allowedUrls = ["http://8.8.8.8/", "http://1.1.1.1/"];

for (const url of allowedUrls) {
  total += 1;
  const name = `assertSafeUrl(${JSON.stringify(url)}) does not throw`;
  try {
    await assertSafeUrl(url);
    passed += 1;
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      failures.push({ name, err });
      console.log(`  FAIL  ${name}`);
      console.log(`        unexpectedly blocked: ${err.message}`);
    } else if (isNetworkError(err)) {
      // No-network path for an IP literal shouldn't really hit this branch,
      // since assertSafeUrl doesn't dial — but treat any non-SSRF error as skip.
      total -= 1;
      skip(name, `skipped (network: ${err.code || err.message})`);
    } else {
      failures.push({ name, err });
      console.log(`  FAIL  ${name}`);
      console.log(`        ${err.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// §5 — makePinnedLookup signature
// ---------------------------------------------------------------------------

section("§5 makePinnedLookup signature");

await test("makePinnedLookup('8.8.8.8') returns a function", () => {
  const fn = makePinnedLookup("8.8.8.8");
  assert.strictEqual(typeof fn, "function");
});

await test("makePinnedLookup IPv4: (host, cb) -> cb(null, '8.8.8.8', 4)", () => {
  const fn = makePinnedLookup("8.8.8.8");
  let called = false;
  fn("example.com", (err, address, family) => {
    called = true;
    assert.strictEqual(err, null);
    assert.strictEqual(address, "8.8.8.8");
    assert.strictEqual(family, 4);
  });
  assert.ok(called, "callback was not invoked");
});

await test("makePinnedLookup IPv4: (host, {}, cb) -> cb(null, '8.8.8.8', 4)", () => {
  const fn = makePinnedLookup("8.8.8.8");
  let called = false;
  fn("example.com", {}, (err, address, family) => {
    called = true;
    assert.strictEqual(err, null);
    assert.strictEqual(address, "8.8.8.8");
    assert.strictEqual(family, 4);
  });
  assert.ok(called, "callback was not invoked");
});

await test("makePinnedLookup IPv4: (host, { all: false }, cb) -> cb(null, '8.8.8.8', 4)", () => {
  const fn = makePinnedLookup("8.8.8.8");
  let called = false;
  fn("example.com", { all: false }, (err, address, family) => {
    called = true;
    assert.strictEqual(err, null);
    assert.strictEqual(address, "8.8.8.8");
    assert.strictEqual(family, 4);
  });
  assert.ok(called, "callback was not invoked");
});

await test("makePinnedLookup IPv6 '2001:4860:4860::8888' -> family 6", () => {
  const fn = makePinnedLookup("2001:4860:4860::8888");
  let called = false;
  // Probe both shapes: callback-only, and { all: true } (undici's preference).
  fn("example.com", (err, address, family) => {
    called = true;
    assert.strictEqual(err, null);
    assert.strictEqual(address, "2001:4860:4860::8888");
    assert.strictEqual(family, 6);
  });
  assert.ok(called, "single-result callback was not invoked");

  let allCalled = false;
  fn("example.com", { all: true }, (err, addresses) => {
    allCalled = true;
    assert.strictEqual(err, null);
    assert.ok(Array.isArray(addresses), "expected array when { all: true }");
    assert.strictEqual(addresses.length, 1);
    assert.strictEqual(addresses[0].address, "2001:4860:4860::8888");
    assert.strictEqual(addresses[0].family, 6);
  });
  assert.ok(allCalled, "{ all: true } callback was not invoked");
});

// ---------------------------------------------------------------------------
// §6 — LIVE integration (skip if offline)
// ---------------------------------------------------------------------------

section("§6 LIVE integration");

{
  const name = "safeFetch('http://example.com/') succeeds with Example Domain body";
  total += 1;
  try {
    const result = await safeFetch("http://example.com/", { timeoutMs: 8000 });
    if (!result.ok) {
      // Some networks return a captive-portal redirect or 5xx; treat as skip
      // unless it's clearly a blocked-by-SSRF path.
      skipped.push({ name, reason: `non-ok status ${result.status}` });
      total -= 1;
      console.log(`  SKIP  ${name} — non-ok status ${result.status}`);
    } else {
      assert.strictEqual(result.ok, true);
      assert.ok(
        /Example Domain|illustrative examples|<title>/i.test(result.text),
        `body did not contain expected marker; got ${result.text.slice(0, 200)}`,
      );
      passed += 1;
    }
  } catch (err) {
    if (isNetworkError(err)) {
      total -= 1;
      skip(name, `skipped (network: ${err.code || err.message})`);
    } else {
      failures.push({ name, err });
      console.log(`  FAIL  ${name}`);
      console.log(`        ${err.message}`);
    }
  }
}

await test("safeFetch('http://127.0.0.1/') rejects with SsrfBlockedError", async () => {
  await assert.rejects(
    () => safeFetch("http://127.0.0.1/", { timeoutMs: 3000 }),
    (err) => {
      assert.ok(
        err instanceof SsrfBlockedError,
        `expected SsrfBlockedError, got ${err && err.constructor && err.constructor.name}: ${err && err.message}`,
      );
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log("");
if (failures.length === 0) {
  if (skipped.length > 0) {
    console.log(`===== ${passed} / ${total} tests passed (${skipped.length} skipped) =====`);
    for (const s of skipped) {
      console.log(`  - ${s.name} — ${s.reason}`);
    }
  } else {
    console.log(`===== ${passed} / ${total} tests passed =====`);
  }
  console.log(`all ${total} tests passed`);
  process.exit(0);
} else {
  console.log(`===== ${passed} / ${total} tests passed — ${failures.length} failed =====`);
  for (const f of failures) {
    console.log(`  - ${f.name}`);
    const msg = f.err && f.err.message ? f.err.message : String(f.err);
    console.log(`      ${msg}`);
  }
  if (skipped.length > 0) {
    console.log(`  (${skipped.length} skipped)`);
    for (const s of skipped) {
      console.log(`    - ${s.name} — ${s.reason}`);
    }
  }
  process.exit(1);
}
