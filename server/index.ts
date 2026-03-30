import cors from "cors";
import express from "express";
import {
  analyzeMessage,
  crawlLiveSources,
  getFeed,
  getGraph,
  getSnapshot,
  verifySiteUrl,
} from "./lib/scamEngine";

const app = express();
const port = 8787;

app.use(cors());
app.use(express.json());

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.get("/api/snapshot", (_request, response) => {
  response.json(getSnapshot());
});

app.get("/api/feed", (_request, response) => {
  response.json(getFeed());
});

app.get("/api/graph", async (_request, response) => {
  response.json(await getGraph());
});

app.post("/api/crawl", async (_request, response) => {
  await crawlLiveSources();
  response.json(getSnapshot());
});

app.post("/api/analyze", (request, response) => {
  const message =
    typeof request.body?.message === "string" ? request.body.message : "";

  if (!message.trim()) {
    response.status(400).json({ error: "message is required" });
    return;
  }

  response.json(analyzeMessage(message));
});

app.post("/api/verify-site", async (request, response) => {
  const url = typeof request.body?.url === "string" ? request.body.url : "";

  if (!url.trim()) {
    response.status(400).json({ error: "url is required" });
    return;
  }

  try {
    response.json(await verifySiteUrl(url));
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "site verification failed",
    });
  }
});

app.listen(port, () => {
  console.log(`Scam demo API listening on http://localhost:${port}`);
});
