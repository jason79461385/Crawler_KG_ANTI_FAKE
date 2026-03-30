import neo4j from "neo4j-driver";
import type { DemoPost } from "../data/demoPosts";

type GraphNode = {
  id: string;
  label: string;
  type: string;
  weight: number;
};

type GraphEdge = {
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  relation: string;
};

const uri = process.env.NEO4J_URI;
const username = process.env.NEO4J_USERNAME;
const password = process.env.NEO4J_PASSWORD;
const database = process.env.NEO4J_DATABASE || "neo4j";

const driver =
  uri && username && password
    ? neo4j.driver(uri, neo4j.auth.basic(username, password))
    : null;

export function isNeo4jEnabled() {
  return Boolean(driver);
}

export function getNeo4jStatus() {
  return {
    enabled: isNeo4jEnabled(),
    database,
  };
}

export async function syncPostsToNeo4j(posts: DemoPost[]) {
  if (!driver) {
    return { synced: false, reason: "Neo4j is not configured." };
  }

  const session = driver.session({ database });

  try {
    await session.executeWrite(async (tx) => {
      await tx.run("MATCH (n) DETACH DELETE n");

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
              p.scamType = $scamType
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
          },
        );

        for (const entity of post.entities) {
          const entityId = `${entity.type}:${entity.value}`;
          await tx.run(
            `
            MERGE (e:Entity {id: $entityId})
            SET e.label = $value,
                e.type = $type
            WITH e
            MATCH (p:Post {id: $postId})
            MERGE (p)-[:MENTIONS]->(e)
            `,
            {
              entityId,
              value: entity.value,
              type: entity.type,
              postId: post.id,
            },
          );
        }
      }
    });

    return { synced: true };
  } finally {
    await session.close();
  }
}

export async function getGraphFromNeo4j(limit = 10) {
  if (!driver) {
    return null;
  }

  const session = driver.session({ database, defaultAccessMode: neo4j.session.READ });

  try {
    const result = await session.executeRead((tx) =>
      tx.run(
        `
        MATCH (p:Post)-[r:MENTIONS]->(e:Entity)
        WITH p, e, r
        ORDER BY coalesce(p.publishedAt, '') DESC, p.id
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

    return {
      nodes: [...nodeMap.values()],
      edges,
    };
  } finally {
    await session.close();
  }
}

export async function closeNeo4j() {
  if (driver) {
    await driver.close();
  }
}
