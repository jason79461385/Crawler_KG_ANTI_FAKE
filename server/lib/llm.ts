type EmbeddingResult = {
  embedding: number[];
};

const workerApiUrl = process.env.WORKER_API_URL;
const workerModelName = process.env.WORKER_MODEL_NAME;
const workerApiKey = process.env.WORKER_API_KEY;

const embeddingApiUrl = process.env.EMBEDDING_API_URL;
const embeddingModelName = process.env.EMBEDDING_MODEL_NAME;
const embeddingApiKey = process.env.EMBEDDING_API_KEY;

export function isLlmConfigured() {
  return Boolean(workerApiUrl && workerModelName);
}

export function isEmbeddingConfigured() {
  return Boolean(embeddingApiUrl && embeddingModelName);
}

export async function createEmbedding(input: string): Promise<EmbeddingResult | null> {
  if (!isEmbeddingConfigured()) {
    return null;
  }

  const { url, headers } = buildApiRequest(
    embeddingApiUrl!,
    "embeddings",
    embeddingApiKey,
  );
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({
      model: embeddingModelName,
      input,
    }),
  });

  if (!response.ok) {
    throw new Error(`Embedding API failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    data?: Array<{ embedding: number[] }>;
  };

  return data.data?.[0] ? { embedding: data.data[0].embedding } : null;
}

export async function generateAlertWithLlm(input: {
  message: string;
  matchedKeywords: string[];
  matchedEntities: string[];
  evidence: Array<{
    title: string;
    source: string;
    scamType: string;
    snippet: string;
  }>;
  riskLabel: string;
}) {
  if (!isLlmConfigured()) {
    return null;
  }

  const systemPrompt =
    "你是一個台灣防詐助理。請根據提供的用戶訊息、關鍵字、實體與相似案例，生成簡短、具體、可操作的中文警示摘要與三點處置建議。輸出 JSON，格式為 {\"summary\": string, \"actions\": string[]}。";

  const userPrompt = JSON.stringify(input, null, 2);

  const { url, headers } = buildApiRequest(
    workerApiUrl!,
    "chat/completions",
    workerApiKey,
  );
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({
      model: workerModelName,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM API failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    return null;
  }

  const parsed = JSON.parse(content) as {
    summary?: string;
    actions?: string[];
  };

  return {
    summary: parsed.summary ?? "",
    actions: Array.isArray(parsed.actions) ? parsed.actions : [],
  };
}

export function cosineSimilarity(left: number[], right: number[]) {
  if (left.length !== right.length || left.length === 0) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function buildApiRequest(baseUrl: string, path: string, bearerToken?: string) {
  const parsed = new URL(baseUrl);
  const basicAuth =
    parsed.username || parsed.password
      ? `Basic ${Buffer.from(`${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`).toString("base64")}`
      : undefined;

  parsed.username = "";
  parsed.password = "";

  const normalizedBase = parsed.toString().endsWith("/")
    ? parsed.toString()
    : `${parsed.toString()}/`;
  const target = new URL(path, normalizedBase).toString();
  const headers: Record<string, string> = {};

  if (basicAuth) {
    headers.Authorization = basicAuth;
  } else if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }

  return {
    url: target,
    headers,
  };
}
