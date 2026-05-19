import "dotenv/config";
import { spawn, spawnSync } from "node:child_process";
import { connect } from "node:net";

const BOLT_PORT = 7687;
const HEALTHCHECK_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 1500;

const COLOR = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};

function log(msg: string, color: keyof typeof COLOR = "reset") {
  console.log(`${COLOR[color]}${msg}${COLOR.reset}`);
}

function logErr(msg: string) {
  console.error(`${COLOR.red}${msg}${COLOR.reset}`);
}

async function main() {
  log(`${COLOR.bold}🐳  Neo4j (Docker Compose) 啟動檢查${COLOR.reset}`);

  // Step 1: docker CLI 在不在
  if (!hasCommand("docker")) {
    logErr(
      "❌ 找不到 docker 指令。請先安裝 Docker Desktop:https://www.docker.com/products/docker-desktop/",
    );
    process.exit(1);
  }

  // Step 2: docker daemon 在跑嗎
  const ping = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    encoding: "utf8",
  });
  if (ping.status !== 0) {
    logErr(
      "❌ Docker daemon 沒有在運行。請開啟 Docker Desktop(macOS 從 menu bar / Applications 啟動)後重試。",
    );
    logErr(`   錯誤訊息:${ping.stderr.trim().split("\n")[0]}`);
    process.exit(1);
  }
  log(`✓ Docker daemon 正常 (server v${ping.stdout.trim()})`, "green");

  // Step 3: bolt port 已被 host 進程占用?(代表別的 Neo4j / 服務)
  const portInUseBySomethingElse = await isPortOpen("127.0.0.1", BOLT_PORT);
  if (portInUseBySomethingElse) {
    const isOurContainer = isContainerRunning("scam-intel-neo4j");
    if (isOurContainer) {
      log("✓ scam-intel-neo4j 已經在跑,直接使用", "green");
      await waitUntilBoltReady();
      printBanner();
      return;
    }
    logErr(
      `❌ Port ${BOLT_PORT} 已被別的進程占用(可能是另一個 Neo4j、Memgraph、或本機應用)。`,
    );
    logErr(
      `   請先關掉占用該 port 的服務,或修改 docker-compose.yml + .env 換 port。`,
    );
    process.exit(1);
  }

  // Step 4: docker compose up -d
  log("→ 執行 docker compose up -d neo4j ...", "cyan");
  const up = spawnSync("docker", ["compose", "up", "-d", "neo4j"], {
    stdio: "inherit",
  });
  if (up.status !== 0) {
    logErr("❌ docker compose up 失敗(看上方輸出)");
    process.exit(up.status ?? 1);
  }

  // Step 5: 等 bolt port ready
  await waitUntilBoltReady();
  printBanner();
}

function hasCommand(cmd: string): boolean {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd]);
  return r.status === 0;
}

function isContainerRunning(name: string): boolean {
  const r = spawnSync(
    "docker",
    ["ps", "--filter", `name=${name}`, "--format", "{{.Names}}"],
    { encoding: "utf8" },
  );
  return r.status === 0 && r.stdout.includes(name);
}

function isPortOpen(host: string, port: number, timeoutMs = 700): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const finish = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      finish(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      finish(false);
    });
  });
}

async function waitUntilBoltReady() {
  const startedAt = Date.now();
  process.stdout.write(
    `${COLOR.cyan}→ 等待 Neo4j 完全啟動(bolt + HTTP)${COLOR.reset}`,
  );
  while (Date.now() - startedAt < HEALTHCHECK_TIMEOUT_MS) {
    // 兩個條件都要滿足才算真的 ready:
    //   1. bolt port 接得起來
    //   2. Neo4j HTTP 7474 回得了 200(代表 server 真的啟動完)
    if ((await isPortOpen("127.0.0.1", BOLT_PORT)) && (await isHttpAlive())) {
      process.stdout.write("\n");
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      log(`✓ Neo4j 在 ${elapsed}s 內就緒`, "green");
      return;
    }
    process.stdout.write(".");
    await sleep(POLL_INTERVAL_MS);
  }
  process.stdout.write("\n");
  logErr(
    `❌ Neo4j 未在 ${HEALTHCHECK_TIMEOUT_MS / 1000}s 內就緒。執行 npm run db:logs 查看容器 log。`,
  );
  process.exit(1);
}

async function isHttpAlive(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 1500);
    const r = await fetch("http://127.0.0.1:7474/", { signal: controller.signal });
    clearTimeout(t);
    return r.ok || r.status === 200;
  } catch {
    return false;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printBanner() {
  const user = process.env.NEO4J_USER ?? "neo4j";
  const pass = process.env.NEO4J_PASS ?? "password123";
  log("");
  log(`${COLOR.bold}🚀  Neo4j 已就緒${COLOR.reset}`);
  log(`   Bolt:    bolt://localhost:7687`, "dim");
  log(`   Browser: http://localhost:7474`, "dim");
  log(`   Auth:    ${user} / ${pass}`, "dim");
  log("");
}

main().catch((e) => {
  logErr(`❌ 未預期的錯誤:${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});

// keep eslint happy in case spawn was unused
void spawn;
