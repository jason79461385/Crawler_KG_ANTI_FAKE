import neo4j from "neo4j-driver";
import type { DemoPost } from "../data/demoPosts";

type GraphNode = {
  id: string;
  label: string;
  type: string;
  weight: number;
  url?: string;
  source?: string;
  scamType?: string;
  publishedAt?: string;
};

type GraphEdge = {
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  relation: string;
};

const uri = process.env.NEO4J_URI;
const username = process.env.NEO4J_USER ?? process.env.NEO4J_USERNAME;
const password = process.env.NEO4J_PASS ?? process.env.NEO4J_PASSWORD;
const database = process.env.NEO4J_DATABASE || "neo4j";
const STALE_HOURS = Number(process.env.NEO4J_STALE_HOURS ?? "168"); // 7 days
const RETRY_BACKOFF_MS = 60_000;

// 避免本機沒 Neo4j 時第一次請求卡在 driver 預設 30 秒 timeout。
// connectionTimeout 控制 TCP 連線等待時間
// connectionAcquisitionTimeout 控制從 connection pool 取出連線的等待
const driver =
  uri && username && password
    ? neo4j.driver(uri, neo4j.auth.basic(username, password), {
        connectionTimeout: Number(process.env.NEO4J_CONNECT_TIMEOUT_MS ?? "2000"),
        connectionAcquisitionTimeout: 3000,
        maxTransactionRetryTime: 4000,
        logging: { level: "warn", logger: () => {} },
      })
    : null;

let neo4jAvailable = Boolean(driver);
let nextRetryAt = 0;
let neo4jStatusMessage = driver
  ? "Neo4j configured, waiting for connectivity check."
  : "Neo4j is not configured.";

export function isNeo4jEnabled() {
  if (!driver) return false;
  if (neo4jAvailable) return true;
  if (Date.now() >= nextRetryAt) {
    neo4jAvailable = true;
    return true;
  }
  return false;
}

export function getNeo4jStatus() {
  return {
    enabled: isNeo4jEnabled(),
    database,
    message: neo4jStatusMessage,
  };
}

export async function syncPostsToNeo4j(posts: DemoPost[]) {
  if (!driver) {
    return { synced: false, reason: "Neo4j is not configured." };
  }

  if (!isNeo4jEnabled()) {
    return { synced: false, reason: neo4jStatusMessage };
  }

  const session = driver.session({ database });
  const now = new Date().toISOString();

  try {
    await session.executeWrite(async (tx) => {
      for (const post of posts) {
        await tx.run(
          `
          MERGE (p:Post {id: $id})
          SET p.title = $title,
              p.source = $source,
              p.board = $board,
              p.content = $content,
              p.url = $url,
              p.publishedAt = $publishedAt,
              p.scamType = $scamType,
              p.lastSeenAt = $lastSeenAt
          `,
          {
            id: post.id,
            title: post.title,
            source: post.source,
            board: post.board,
            content: post.content,
            url: post.url ?? "",
            publishedAt: post.publishedAt ?? "",
            scamType: post.scamType,
            lastSeenAt: now,
          },
        );

        for (const entity of post.entities) {
          const entityId = `${entity.type}:${entity.value}`;
          await tx.run(
            `
            MERGE (e:Entity {id: $entityId})
            SET e.label = $value,
                e.type = $type,
                e.lastSeenAt = $lastSeenAt
            WITH e
            MATCH (p:Post {id: $postId})
            MERGE (p)-[r:MENTIONS]->(e)
            SET r.lastSeenAt = $lastSeenAt
            `,
            {
              entityId,
              value: entity.value,
              type: entity.type,
              postId: post.id,
              lastSeenAt: now,
            },
          );
        }
      }

      // Cleanup stale nodes (older than STALE_HOURS)
      await tx.run(
        `
        MATCH (p:Post)
        WHERE p.lastSeenAt < $cutoff
        DETACH DELETE p
        `,
        { cutoff: cutoffIso(STALE_HOURS) },
      );

      await tx.run(
        `
        MATCH (e:Entity)
        WHERE NOT (e)<-[:MENTIONS]-() AND e.lastSeenAt < $cutoff
        DELETE e
        `,
        { cutoff: cutoffIso(STALE_HOURS) },
      );
    });

    neo4jStatusMessage = `Connected to Neo4j database "${database}" (incremental MERGE).`;
    return { synced: true };
  } catch (error) {
    handleNeo4jFailure(error);
    return { synced: false, reason: neo4jStatusMessage };
  } finally {
    await session.close();
  }
}

export async function getGraphFromNeo4j(limit = 10) {
  if (!driver || !isNeo4jEnabled()) {
    return null;
  }

  const session = driver.session({
    database,
    defaultAccessMode: neo4j.session.READ,
  });

  try {
    const result = await session.executeRead((tx) =>
      tx.run(
        `
        MATCH (p:Post)-[r:MENTIONS]->(e:Entity)
        WITH p, e, r
        ORDER BY coalesce(p.publishedAt, p.lastSeenAt, '') DESC, p.id
        LIMIT $limit
        RETURN p, e, r
        `,
        { limit: neo4j.int(limit) },
      ),
    );

    const nodeMap = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];

    for (const record of result.records) {
      const post = record.get("p");
      const entity = record.get("e");

      nodeMap.set(post.properties.id, {
        id: `post:${post.properties.id}`,
        label: String(post.properties.title),
        type: String(post.properties.scamType),
        weight: 3,
        url: post.properties.url ? String(post.properties.url) : undefined,
        source: post.properties.source ? String(post.properties.source) : undefined,
        scamType: post.properties.scamType ? String(post.properties.scamType) : undefined,
        publishedAt: post.properties.publishedAt ? String(post.properties.publishedAt) : undefined,
      });
      nodeMap.set(entity.properties.id, {
        id: String(entity.properties.id),
        label: String(entity.properties.label),
        type: String(entity.properties.type),
        weight: 1,
      });

      edges.push({
        from: `post:${post.properties.id}`,
        to: String(entity.properties.id),
        fromLabel: String(post.properties.title),
        toLabel: String(entity.properties.label),
        relation: "mentions",
      });
    }

    neo4jStatusMessage = `Connected to Neo4j database "${database}".`;
    return {
      nodes: [...nodeMap.values()],
      edges,
    };
  } catch (error) {
    handleNeo4jFailure(error);
    return null;
  } finally {
    await session.close();
  }
}

export async function closeNeo4j() {
  if (driver) {
    await driver.close();
  }
}

// 開機時呼叫一次:在啟動階段把連線 timeout 吃掉,
// 之後第一次 /api/graph 不必再等 6 秒。
// 若連線成功會把 neo4jAvailable 維持 true;失敗則切到 fallback。
export async function probeNeo4jOnStartup() {
  if (!driver) return;
  const session = driver.session({ database });
  try {
    await session.executeRead((tx) => tx.run("RETURN 1 AS ok"));
    neo4jAvailable = true;
    nextRetryAt = 0;
    neo4jStatusMessage = `Connected to Neo4j database "${database}" (probe ok).`;
    console.log(`[neo4j] ${neo4jStatusMessage}`);
  } catch (error) {
    handleNeo4jFailure(error);
  } finally {
    await session.close();
  }
}

let warnedOnce = false;
function handleNeo4jFailure(error: unknown) {
  neo4jAvailable = false;
  nextRetryAt = Date.now() + RETRY_BACKOFF_MS;
  neo4jStatusMessage =
    error instanceof Error
      ? `Neo4j unavailable: ${error.message} (retry in ${Math.round(RETRY_BACKOFF_MS / 1000)}s)`
      : "Neo4j unavailable due to an unknown error.";
  if (!warnedOnce) {
    console.error(neo4jStatusMessage);
    console.error(
      `[neo4j] 提示:設定了 NEO4J_URI 卻連不到。執行 \`npm run db:up\` 啟動 Docker 版 Neo4j,或關掉 .env 內的 NEO4J_URI 改走純記憶體模式。`,
    );
    warnedOnce = true;
  }
}

function cutoffIso(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}
