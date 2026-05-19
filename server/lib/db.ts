import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { DemoPost } from "../data/demoPosts";

const DB_PATH = resolve(process.cwd(), "data", "scam-intel.db");

if (!existsSync(dirname(DB_PATH))) {
  mkdirSync(dirname(DB_PATH), { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    board TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    url TEXT,
    published_at TEXT,
    scam_type TEXT NOT NULL,
    entities_json TEXT NOT NULL,
    url_hash TEXT,
    title_hash TEXT,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    live INTEGER NOT NULL DEFAULT 1
  );

  CREATE INDEX IF NOT EXISTS idx_posts_source ON posts(source);
  CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(published_at DESC);
  CREATE INDEX IF NOT EXISTS idx_posts_url_hash ON posts(url_hash);
  CREATE INDEX IF NOT EXISTS idx_posts_title_hash ON posts(title_hash);

  CREATE TABLE IF NOT EXISTS source_status (
    name TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    live INTEGER NOT NULL DEFAULT 0,
    last_updated TEXT NOT NULL,
    errors_json TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS user_reports (
    id TEXT PRIMARY KEY,
    message TEXT NOT NULL,
    reporter_hint TEXT,
    suspected_url TEXT,
    suspected_channel TEXT,
    risk_level TEXT,
    risk_score INTEGER,
    matched_keywords_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
  );

  CREATE INDEX IF NOT EXISTS idx_reports_created ON user_reports(created_at DESC);

  CREATE TABLE IF NOT EXISTS phish_urls (
    url_hash TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    source TEXT NOT NULL,
    fetched_at TEXT NOT NULL
  );
`);

export type StoredPost = DemoPost & {
  firstSeenAt: string;
  lastSeenAt: string;
  live: boolean;
};

const insertPostStmt = db.prepare(`
  INSERT INTO posts (
    id, source, board, title, content, url, published_at,
    scam_type, entities_json, url_hash, title_hash,
    first_seen_at, last_seen_at, live
  ) VALUES (
    @id, @source, @board, @title, @content, @url, @publishedAt,
    @scamType, @entitiesJson, @urlHash, @titleHash,
    @firstSeenAt, @lastSeenAt, @live
  )
  ON CONFLICT(id) DO UPDATE SET
    source = excluded.source,
    board = excluded.board,
    title = excluded.title,
    content = excluded.content,
    url = excluded.url,
    published_at = excluded.published_at,
    scam_type = excluded.scam_type,
    entities_json = excluded.entities_json,
    url_hash = excluded.url_hash,
    title_hash = excluded.title_hash,
    last_seen_at = excluded.last_seen_at,
    live = excluded.live;
`);

const findByUrlHashStmt = db.prepare(`SELECT id FROM posts WHERE url_hash = ? LIMIT 1`);
const findByTitleHashStmt = db.prepare(`SELECT id FROM posts WHERE title_hash = ? LIMIT 1`);
const allPostsStmt = db.prepare(`SELECT * FROM posts ORDER BY COALESCE(published_at, first_seen_at) DESC`);
const recentPostsStmt = db.prepare(`SELECT * FROM posts ORDER BY COALESCE(published_at, first_seen_at) DESC LIMIT ?`);
const countPostsStmt = db.prepare(`SELECT COUNT(*) as count FROM posts`);
const countBySourceStmt = db.prepare(`SELECT source, COUNT(*) as count FROM posts GROUP BY source`);

export function upsertPost(post: DemoPost, live = true): "inserted" | "updated" | "deduped" {
  const urlHash = post.url ? hashString(normalizeUrl(post.url)) : null;
  const titleHash = hashString(post.title.replace(/\s+/g, "").toLowerCase());
  const now = new Date().toISOString();

  if (urlHash) {
    const existing = findByUrlHashStmt.get(urlHash) as { id: string } | undefined;
    if (existing && existing.id !== post.id) {
      insertPostStmt.run({
        ...toRow(post, urlHash, titleHash, now, live),
        id: existing.id,
        firstSeenAt: now,
      });
      return "deduped";
    }
  }

  if (!urlHash) {
    const existing = findByTitleHashStmt.get(titleHash) as { id: string } | undefined;
    if (existing && existing.id !== post.id) {
      insertPostStmt.run({
        ...toRow(post, urlHash, titleHash, now, live),
        id: existing.id,
        firstSeenAt: now,
      });
      return "deduped";
    }
  }

  const isNew = !db.prepare(`SELECT 1 FROM posts WHERE id = ?`).get(post.id);
  insertPostStmt.run(toRow(post, urlHash, titleHash, now, live));
  return isNew ? "inserted" : "updated";
}

function toRow(
  post: DemoPost,
  urlHash: string | null,
  titleHash: string,
  now: string,
  live: boolean,
) {
  return {
    id: post.id,
    source: post.source,
    board: post.board,
    title: post.title,
    content: post.content,
    url: post.url ?? null,
    publishedAt: post.publishedAt ?? null,
    scamType: post.scamType,
    entitiesJson: JSON.stringify(post.entities),
    urlHash,
    titleHash,
    firstSeenAt: now,
    lastSeenAt: now,
    live: live ? 1 : 0,
  };
}

export function getAllPosts(): StoredPost[] {
  return (allPostsStmt.all() as RawPostRow[]).map(rowToPost);
}

const deletePostStmt = db.prepare(`DELETE FROM posts WHERE id = ?`);

export function deletePostsByIds(ids: string[]): number {
  if (ids.length === 0) return 0;
  const tx = db.transaction((items: string[]) => {
    let count = 0;
    for (const id of items) {
      const result = deletePostStmt.run(id);
      count += result.changes;
    }
    return count;
  });
  return tx(ids);
}

export function getRecentPosts(limit = 50): StoredPost[] {
  return (recentPostsStmt.all(limit) as RawPostRow[]).map(rowToPost);
}

export function countPosts(): number {
  const row = countPostsStmt.get() as { count: number };
  return row.count;
}

export function countPostsBySource(): Record<string, number> {
  const rows = countBySourceStmt.all() as Array<{ source: string; count: number }>;
  return Object.fromEntries(rows.map((row) => [row.source, row.count]));
}

type RawPostRow = {
  id: string;
  source: DemoPost["source"];
  board: string;
  title: string;
  content: string;
  url: string | null;
  published_at: string | null;
  scam_type: string;
  entities_json: string;
  first_seen_at: string;
  last_seen_at: string;
  live: number;
};

function rowToPost(row: RawPostRow): StoredPost {
  return {
    id: row.id,
    source: row.source,
    board: row.board,
    title: row.title,
    content: row.content,
    url: row.url ?? undefined,
    publishedAt: row.published_at ?? undefined,
    scamType: row.scam_type,
    entities: JSON.parse(row.entities_json),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    live: row.live === 1,
  };
}

const upsertSourceStmt = db.prepare(`
  INSERT INTO source_status (name, description, live, last_updated, errors_json)
  VALUES (@name, @description, @live, @lastUpdated, @errorsJson)
  ON CONFLICT(name) DO UPDATE SET
    description = excluded.description,
    live = excluded.live,
    last_updated = excluded.last_updated,
    errors_json = excluded.errors_json;
`);

const allSourcesStmt = db.prepare(`SELECT * FROM source_status ORDER BY name`);

export type SourceStatusRecord = {
  name: string;
  description: string;
  live: boolean;
  lastUpdated: string;
  errors: string[];
};

export function upsertSourceStatus(input: SourceStatusRecord) {
  upsertSourceStmt.run({
    name: input.name,
    description: input.description,
    live: input.live ? 1 : 0,
    lastUpdated: input.lastUpdated,
    errorsJson: JSON.stringify(input.errors),
  });
}

export function getAllSourceStatus(): SourceStatusRecord[] {
  const rows = allSourcesStmt.all() as Array<{
    name: string;
    description: string;
    live: number;
    last_updated: string;
    errors_json: string;
  }>;
  return rows.map((row) => ({
    name: row.name,
    description: row.description,
    live: row.live === 1,
    lastUpdated: row.last_updated,
    errors: JSON.parse(row.errors_json),
  }));
}

const insertReportStmt = db.prepare(`
  INSERT INTO user_reports (
    id, message, reporter_hint, suspected_url, suspected_channel,
    risk_level, risk_score, matched_keywords_json, created_at, status
  ) VALUES (
    @id, @message, @reporterHint, @suspectedUrl, @suspectedChannel,
    @riskLevel, @riskScore, @matchedKeywordsJson, @createdAt, @status
  );
`);

const recentReportsStmt = db.prepare(`SELECT * FROM user_reports ORDER BY created_at DESC LIMIT ?`);

export type UserReport = {
  id: string;
  message: string;
  reporterHint?: string;
  suspectedUrl?: string;
  suspectedChannel?: string;
  riskLevel?: string;
  riskScore?: number;
  matchedKeywords: string[];
  createdAt: string;
  status: "pending" | "reviewed" | "ignored";
};

export function insertReport(report: UserReport) {
  insertReportStmt.run({
    id: report.id,
    message: report.message,
    reporterHint: report.reporterHint ?? null,
    suspectedUrl: report.suspectedUrl ?? null,
    suspectedChannel: report.suspectedChannel ?? null,
    riskLevel: report.riskLevel ?? null,
    riskScore: report.riskScore ?? null,
    matchedKeywordsJson: JSON.stringify(report.matchedKeywords),
    createdAt: report.createdAt,
    status: report.status,
  });
}

export function getRecentReports(limit = 50): UserReport[] {
  const rows = recentReportsStmt.all(limit) as Array<{
    id: string;
    message: string;
    reporter_hint: string | null;
    suspected_url: string | null;
    suspected_channel: string | null;
    risk_level: string | null;
    risk_score: number | null;
    matched_keywords_json: string;
    created_at: string;
    status: UserReport["status"];
  }>;
  return rows.map((row) => ({
    id: row.id,
    message: row.message,
    reporterHint: row.reporter_hint ?? undefined,
    suspectedUrl: row.suspected_url ?? undefined,
    suspectedChannel: row.suspected_channel ?? undefined,
    riskLevel: row.risk_level ?? undefined,
    riskScore: row.risk_score ?? undefined,
    matchedKeywords: JSON.parse(row.matched_keywords_json),
    createdAt: row.created_at,
    status: row.status,
  }));
}

const upsertPhishStmt = db.prepare(`
  INSERT INTO phish_urls (url_hash, url, source, fetched_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(url_hash) DO UPDATE SET
    source = excluded.source,
    fetched_at = excluded.fetched_at;
`);

const findPhishStmt = db.prepare(`SELECT url, source FROM phish_urls WHERE url_hash = ? LIMIT 1`);
const countPhishStmt = db.prepare(`SELECT COUNT(*) as count FROM phish_urls`);

export function upsertPhishUrls(urls: Array<{ url: string; source: string }>) {
  const now = new Date().toISOString();
  const tx = db.transaction((items: Array<{ url: string; source: string }>) => {
    for (const item of items) {
      upsertPhishStmt.run(hashString(normalizeUrl(item.url)), item.url, item.source, now);
    }
  });
  tx(urls);
}

export function lookupPhishUrl(url: string): { url: string; source: string } | null {
  const result = findPhishStmt.get(hashString(normalizeUrl(url))) as
    | { url: string; source: string }
    | undefined;
  return result ?? null;
}

export function countPhishUrls(): number {
  const row = countPhishStmt.get() as { count: number };
  return row.count;
}

export function normalizeUrl(input: string): string {
  try {
    const trimmed = input.trim();
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(normalized);
    url.hash = "";
    url.search = "";
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return input.trim().toLowerCase();
  }
}

function hashString(input: string): string {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) | 0;
  }
  return `h${(hash >>> 0).toString(16)}_${input.length}`;
}

export function getDb() {
  return db;
}
