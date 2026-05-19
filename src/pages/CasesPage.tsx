import { ChevronLeft, ChevronRight, SearchCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchFeed } from "../api/client";
import type { FeedResponse } from "../types";

const PAGE_SIZE = 12;

export function CasesPage() {
  const [data, setData] = useState<FeedResponse | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("");

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchFeed(page, PAGE_SIZE)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "載入失敗"))
      .finally(() => setLoading(false));
  }, [page]);

  const filtered = filter
    ? data?.posts.filter(
        (item) =>
          item.title.includes(filter) ||
          item.snippet.includes(filter) ||
          item.scamType.includes(filter) ||
          item.source.includes(filter),
      ) ?? []
    : data?.posts ?? [];

  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold tracking-[0.14em] text-cyan-200 uppercase">案例列表</p>
          <h1 className="mt-2 text-3xl font-bold">目前抓到的文章與新聞</h1>
          <p className="mt-1 text-sm text-slate-300/80">
            共 {data?.total ?? 0} 筆 · 第 {data?.page ?? 1} / {totalPages} 頁
          </p>
        </div>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="本頁過濾(標題 / 來源 / 類型)"
          className="w-full max-w-xs rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/40 focus:outline-none"
        />
      </header>

      {error ? (
        <div className="rounded-2xl border border-rose-300/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {loading
          ? Array.from({ length: 6 }).map((_, idx) => (
              <div key={idx} className="h-52 animate-pulse rounded-2xl border border-white/8 bg-white/5" />
            ))
          : filtered.map((item) => (
              <article key={item.id} className="flex flex-col rounded-2xl border border-white/8 bg-slate-950/30 p-4">
                <div className="flex flex-wrap items-center gap-2 text-[11px] tracking-[0.14em] text-cyan-200 uppercase">
                  <span>{item.source}</span>
                  <span>·</span>
                  <span>{item.board}</span>
                  <span className="ml-auto rounded-full bg-cyan-400/10 px-2 py-0.5">{item.scamType}</span>
                </div>
                <h2 className="mt-2 text-base font-semibold leading-snug text-white">{item.title}</h2>
                <p className="mt-2 flex-1 text-sm leading-7 text-slate-300/88">{item.snippet}</p>
                <div className="mt-3 flex items-center justify-between text-xs text-slate-400/85">
                  <span>{item.publishedAt ? new Date(item.publishedAt).toLocaleString("zh-TW") : "時間未提供"}</span>
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noreferrer" className="font-semibold text-cyan-200 hover:text-cyan-100">
                      查看來源
                    </a>
                  ) : null}
                </div>
              </article>
            ))}
      </div>

      {!loading && filtered.length === 0 ? (
        <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-10 text-center text-sm text-slate-300">
          <SearchCheck className="mx-auto mb-2 h-6 w-6 text-cyan-300" />
          本頁沒有符合條件的案例,可調整過濾或切換頁碼。
        </div>
      ) : null}

      <Pagination page={page} totalPages={totalPages} onChange={setPage} />
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (next: number) => void;
}) {
  if (totalPages <= 1) return null;

  const pages: number[] = [];
  const maxButtons = 5;
  const half = Math.floor(maxButtons / 2);
  let start = Math.max(1, page - half);
  const end = Math.min(totalPages, start + maxButtons - 1);
  if (end - start + 1 < maxButtons) {
    start = Math.max(1, end - maxButtons + 1);
  }
  for (let i = start; i <= end; i += 1) pages.push(i);

  return (
    <nav className="flex items-center justify-center gap-1.5">
      <button
        type="button"
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-40"
      >
        <ChevronLeft className="h-4 w-4" />
        上一頁
      </button>
      {pages.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          className={`min-w-[36px] rounded-full px-3 py-1.5 text-sm font-semibold transition ${
            p === page ? "bg-cyan-400 text-slate-950" : "border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
          }`}
        >
          {p}
        </button>
      ))}
      <button
        type="button"
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-40"
      >
        下一頁
        <ChevronRight className="h-4 w-4" />
      </button>
    </nav>
  );
}
