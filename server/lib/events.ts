import type { Response } from "express";

export type CrawlEvent = {
  type: "crawl";
  at: string;
  inserted: number;
  updated: number;
  totalPosts: number;
  bySource: Record<string, { inserted: number; updated: number; live: boolean }>;
};

export type AppEvent = CrawlEvent | { type: "hello"; at: string };

const clients = new Set<Response>();

export function registerSseClient(res: Response) {
  clients.add(res);
  res.on("close", () => {
    clients.delete(res);
  });
}

export function broadcast(event: AppEvent) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

export function sseHeartbeat() {
  for (const res of clients) {
    try {
      res.write(`: ping ${Date.now()}\n\n`);
    } catch {
      clients.delete(res);
    }
  }
}

export function getSseClientCount() {
  return clients.size;
}
