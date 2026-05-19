# Scam Intel Console

> 台灣防詐情資控制台 — 多來源即時爬蟲 × SQLite 持久化 × Neo4j 知識圖譜 × 規則 + Embedding + LLM 混合分析 × SSRF 防護網址驗證 × Markdown 對話助手。

完整可執行的 React 19 + Express 5 全端 prototype。所有外部整合(Neo4j / LLM / Embedding / 威脅情資)都是**可選**的 — 沒設定就走 fallback,不會炸。

> 📄 想看作品報告:打開根目錄的 `report.html`(單檔可開,瀏覽器雙擊即可)。
> 📋 想看技術細節:`report.md`。
> 🧪 想看測試結果:`TEST_REPORT.md`。
> 🤖 給 Claude Code 的開發指南:`CLAUDE.md`。

---

## 目錄

1. [系統需求](#1-系統需求)
2. [快速開始](#2-快速開始三步驟)
3. [環境變數設定](#3-環境變數設定)
4. [指令一覽](#4-指令一覽)
5. [系統架構](#5-系統架構)
6. [API 規格](#6-api-規格)
7. [前端頁面](#7-前端頁面)
8. [專案結構](#8-專案結構)
9. [常見問題](#9-常見問題-faq)
10. [疑難排解](#10-疑難排解)

---

## 1. 系統需求

### 必要 (Required)

| 工具 | 版本 | 安裝 |
|---|---|---|
| **Node.js** | 20+ | https://nodejs.org/ 或 `nvm install 20` |
| **npm** | 10+ | 隨 Node.js 一起安裝 |
| **Git** | 2.x | https://git-scm.com/ |

### 可選 (Optional — 建議至少裝 Docker)

| 工具 | 為什麼需要 | 沒裝會怎樣 |
|---|---|---|
| **Docker Desktop** | 啟動 Neo4j 知識圖譜資料庫 | KG 走純記憶體模式(只看當下 crawl 結果,不持久化圖譜) |
| **LLM API endpoint** | 真實 LLM 生成警示與對話 | 退回規則式 `buildAlert`,仍能用但較死板 |
| **Embedding API endpoint** | 語意相似案例檢索 | 評分公式跳過 cosine 那層,完全靠關鍵字 + 實體 |
| **Google Safe Browsing API key** | 強化 `/verify-site` | 仍會啟發式判斷,但少一層威脅情資 |

> 💡 **最低可玩配置:** 只裝 Node.js + npm 就能跑(會自動 fallback 到記憶體模式)。
> 💡 **推薦配置:** Node.js + Docker(Neo4j)→ 拿到完整 KG 持久化體驗。
> 💡 **完整體驗:** 上面全部 + LLM endpoint → 對話、警示都會走真實 LLM。

---

## 2. 快速開始(三步驟)

```bash
# 1. clone & install
git clone https://github.com/jason79461385/Crawler_KG_ANTI_FAKE.git
cd Crawler_KG_ANTI_FAKE
npm install

# 2. (可選) 複製環境變數範本
cp .env.example .env
# 編輯 .env 填入你的 Neo4j / LLM / Embedding 設定(全部可留空)

# 3. 啟動(會自動帶起 Neo4j Docker 容器)
npm run dev:full
```

啟動後:

- 前端: http://localhost:5173
- 後端 API: http://localhost:8787
- Neo4j Browser: http://localhost:7474 (帳密見 `.env`)

> ⚠️ 第一次 `npm install` 會 build `better-sqlite3` 的原生模組,需要本機有 C++ 編譯環境(macOS 內建 Xcode CLT;Linux 可能要 `apt install build-essential python3`;Windows 建議用 WSL2)。

### 沒有 Docker 也能跑

```bash
# 直接跑,跳過 Neo4j
npm run dev
```

系統會自動偵測 Neo4j 不可用,走 in-memory 圖譜模式 — 功能完全可用,只是 server 重啟後 KG 不會持久化。

---

## 3. 環境變數設定

複製 `.env.example` 為 `.env`,按需填寫。**所有變數都是可選的**。

### Neo4j(知識圖譜持久化)

```bash
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASS=password123          # 與 docker-compose.yml 一致
NEO4J_DATABASE=neo4j
NEO4J_STALE_HOURS=168           # 7 天未更新的節點會被清理
NEO4J_CONNECT_TIMEOUT_MS=2000   # 連線 timeout,避免 fallback 等太久
```

### LLM(對話與警示生成 — OpenAI 相容)

支援任何 OpenAI 相容 `chat/completions` 端點(Ollama / vLLM / OpenAI / Anthropic 代理 / 自架 LLM gateway)。

```bash
WORKER_API_URL=https://your-llm.example.com/v1
WORKER_MODEL_NAME=qwen3.5:9b
WORKER_API_KEY=sk-xxx
```

> 也支援 URL 內嵌 Basic Auth(`https://user:pass@host/...`),`buildApiRequest` 會自動處理。

### Embedding(語意相似案例檢索 — OpenAI 相容)

```bash
EMBEDDING_API_URL=https://your-emb.example.com/v1
EMBEDDING_MODEL_NAME=multilingual-e5-large
EMBEDDING_API_KEY=sk-xxx
```

### 威脅情資

```bash
GOOGLE_SAFE_BROWSING_KEY=AIzaSy...                                # 免費額度 10K/day
PHISHTANK_FEED_URL=https://data.phishtank.com/data/<key>/online-valid.json
OPENPHISH_FEED_URL=https://openphish.com/feed.txt                 # 預設值
PHISH_REFRESH_HOURS=12                                            # feed 多久重抓一次
```

---

## 4. 指令一覽

### 開發

| 指令 | 用途 |
|---|---|
| `npm run dev:full` | **完整啟動** — 先 `db:up` 帶起 Neo4j,再同時跑前後端 |
| `npm run dev` | 同時跑前後端(不管 Neo4j) |
| `npm run dev:server` | 只跑後端(`tsx` 直接執行 TS,無編譯) |
| `npm run dev:client` | 只跑前端(Vite) |
| `npm run server` | 同 `dev:server` |

### 容器管理

| 指令 | 用途 |
|---|---|
| `npm run db:up` | 智慧啟動 Neo4j — 自動偵測 Docker daemon、port 衝突、容器是否已起 |
| `npm run db:down` | 停止 Neo4j 容器 |
| `npm run db:logs` | 跟看 Neo4j 容器 log |
| `npm run db:reset` | **危險** — 完全重置 Neo4j 資料夾 |

### 建置

| 指令 | 用途 |
|---|---|
| `npm run build` | `tsc -b` 型別檢查後 `vite build` 產生 production bundle |
| `npm run preview` | 預覽 production build |

### 型別檢查(沒設成 npm script,自己跑)

```bash
npx tsc --noEmit -p tsconfig.app.json     # 前端
npx tsc --noEmit -p tsconfig.server.json  # 後端
```

---

## 5. 系統架構

```
┌─────────────────────────────────────────────────────────────────┐
│  瀏覽器  React 19 + Vite 7 + Tailwind 4                          │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┐        │
│  │Dashboard │  Cases   │  Verify  │  Graph   │  Report  │ + 浮動 │
│  └──────────┴──────────┴──────────┴──────────┴──────────┘        │
└─────────────────────────────┬───────────────────────────────────┘
                              │ /api/* (Vite proxy → :8787)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Express 5   server/index.ts                                    │
│  health · snapshot · feed · graph · crawl · analyze             │
│  · verify-site · chat · report · reports · purge-noise          │
└──────────┬────────────────┬────────────────┬────────────────────┘
           │                │                │
           ▼                ▼                ▼
┌──────────────────┐ ┌──────────────┐ ┌──────────────────────┐
│  scamEngine.ts   │ │  safeFetch   │ │  threatIntel.ts      │
│  orchestrator    │ │  SSRF 防護   │ │  Phish feeds + GSB   │
└──┬────────┬──────┘ └──────────────┘ └──────────────────────┘
   │        │
   ▼        ▼
┌────────┐ ┌──────────────────────────────┐
│ SQLite │ │  Neo4j 5.26 (Docker Compose) │
│ (WAL)  │ │  MERGE + lastSeenAt          │
└────────┘ └──────────────────────────────┘
   ▲
   │  外部來源(任一失敗都 graceful fallback)
   ├── PTT 5 個看板 (cheerio)
   ├── Google News RSS (fast-xml-parser)
   ├── 165 全民防騙網 (CIB_DWS_API)
   ├── OpenPhish / PhishTank feeds
   └── LLM + Embedding (OpenAI 相容)
```

### 風險評分公式

```
score = min(96,
  10
  + matchedKeywords.length * 8
  + matchedEntities.length * 10
  + scoredEvidence.length * 14
)

# 單篇 evidence 分數
evidenceScore =
  overlapEntities * 24
  + keywordHits * 14
  + cosineSimilarity * 42   # 僅當 Embedding 已設定

level: score >= 70 → high
       score >= 40 → medium
       otherwise   → low
```

---

## 6. API 規格

後端固定 listen 在 `:8787`,前端 Vite 會 proxy `/api/*`。

| Method | 路徑 | 用途 |
|---|---|---|
| GET  | `/api/health` | 健檢 + 各子系統狀態(Neo4j / threatIntel / SQLite) |
| GET  | `/api/snapshot` | 多來源狀態 + DB stats + scamType 摘要 |
| GET  | `/api/feed?page=&pageSize=` | 分頁案例清單 |
| GET  | `/api/graph` | KG 節點與邊(優先 Neo4j → fallback in-memory),帶 ETag |
| POST | `/api/crawl` | 觸發即時同步 |
| POST | `/api/analyze` | 對話風險分析(規則 + 實體 + embedding + LLM) |
| POST | `/api/verify-site` | 網址啟發式風險評估 + SSRF 防護 |
| POST | `/api/chat` | 浮動 ChatWidget 後端,LLM 強制輸出 Markdown |
| POST | `/api/report` | 使用者回報 + 自動分析,寫入 SQLite |
| GET  | `/api/reports` | 近期使用者回報清單 |
| POST | `/api/purge-noise` | 手動清掉被內容過濾器標記的噪聲 post |

### 範例

```bash
# 健檢
curl http://localhost:8787/api/health

# 對話分析
curl -X POST http://localhost:8787/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"message":"LINE 上有老師說可以保證獲利,要我先匯款"}'

# 網址驗證(SSRF 防護生效)
curl -X POST http://localhost:8787/api/verify-site \
  -H "Content-Type: application/json" \
  -d '{"url":"http://127.0.0.1:8787/admin"}'
# → ssrfBlocked: true
```

---

## 7. 前端頁面

| 路由 | 頁面 | 功能 |
|---|---|---|
| `/` | Dashboard | 主儀表板 — 多來源狀態、scamType 摘要、對話分析 |
| `/cases` | 案例列表 | 分頁瀏覽(12 筆/頁),本頁過濾、來源 chip |
| `/verify` | 網站驗證 | URL 輸入 + 6 個 signal chip,SSRF 阻擋會顯示原因 |
| `/graph` | 知識圖譜 | vis-network + 類別熱過濾、search、全螢幕、physics toggle |
| `/report` | 使用者回報 | 表單送出後即時分析,並列出近期 20 筆回報 |

外加右下角**浮動圓形 Chat Widget** — 任何頁面都能開,對話歷史寫入 `localStorage`,LLM 回覆以 Markdown 渲染。

---

## 8. 專案結構

```
.
├── .env.example                # 環境變數範本(複製為 .env)
├── docker-compose.yml          # Neo4j 5.26 community + healthcheck
├── scripts/db-up.ts            # 智慧啟動 Neo4j 的腳本
├── report.html                 # 作品報告(瀏覽器雙擊即可開)
├── report.md                   # 技術細節報告
├── TEST_REPORT.md              # 測試結果報告
├── CLAUDE.md                   # 給 Claude Code 的專案 context
│
├── server/
│   ├── index.ts                # Express app(10 個 API)+ 啟動爬蟲
│   ├── data/demoPosts.ts       # Fallback 樣本資料
│   ├── lib/
│   │   ├── scamEngine.ts       # 核心 orchestrator + 評分 + 圖譜
│   │   ├── db.ts               # SQLite (better-sqlite3, WAL)
│   │   ├── neo4j.ts            # MERGE 增量同步 + retry backoff
│   │   ├── llm.ts              # OpenAI 相容 LLM / Embedding client
│   │   ├── safeFetch.ts        # SSRF 防護封裝
│   │   ├── threatIntel.ts      # PhishTank / OpenPhish / SafeBrowsing
│   │   ├── contentFilter.ts    # BLOCK/ALLOW 雙清單(過濾政治新聞)
│   │   └── postUtils.ts        # 關鍵字 / 實體規則
│   └── sources/
│       ├── ptt.ts              # PTT 5 板爬蟲
│       ├── googleNews.ts       # Google News RSS
│       └── dashboard165.ts     # 165 真實 API
│
├── src/
│   ├── main.tsx                # React Router 進入點
│   ├── api/client.ts           # Fetch 封裝
│   ├── context/
│   │   └── SnapshotContext.tsx # 三層快取(snapshot + graph prefetch)
│   ├── components/
│   │   ├── Layout.tsx          # 5 頁 NavLink + ChatWidget
│   │   ├── KnowledgeGraphPanel.tsx  # vis-network + 熱過濾
│   │   ├── ChatWidget.tsx      # 浮動圓形入口
│   │   └── Markdown.tsx        # react-markdown 封裝
│   └── pages/
│       ├── DashboardPage.tsx
│       ├── CasesPage.tsx
│       ├── VerifyPage.tsx
│       ├── GraphPage.tsx
│       └── ReportPage.tsx
│
├── data/                       # 執行期生成(.gitignore)
│   ├── scam-intel.db           # SQLite
│   └── neo4j/                  # Neo4j volume
└── package.json
```

---

## 9. 常見問題 (FAQ)

### Q1. 不裝 Docker / Neo4j 真的可以跑嗎?

可以。`npm run dev` 直接跑,系統會自動偵測 Neo4j 不可用,KG 走 in-memory 模式。SQLite 仍會持久化文章與使用者回報,只是 KG 拓樸不會跨重啟保留。

### Q2. 不設 LLM 會怎樣?

`/api/analyze` 和 `/api/chat` 都會自動退回規則式 `buildAlert` — 仍會給出風險分數、命中關鍵字、相似案例與建議文字,只是文字較模板化。

### Q3. `better-sqlite3` 安裝失敗?

需要本機有 C++ 編譯環境:
- **macOS**: 跑 `xcode-select --install`
- **Linux**: `sudo apt install build-essential python3`
- **Windows**: 強烈建議改用 WSL2,或裝 `windows-build-tools`

### Q4. 165 全民防騙網沒抓到資料?

165 是 Angular SPA,本專案逆向找到真實 API `CIB_DWS_API/api/CaseSummary/GetCaseSummaryList`。如果 API 改版或被擋,系統會 graceful fallback,不影響其他來源。

### Q5. 啟動後 KG 第一次載入很慢?

冷啟動 Neo4j 連線會花幾秒。已透過 `probeNeo4jOnStartup()` 在啟動階段預先建立連線,並設定 server 端 in-memory cache + ETag + 前端 `SnapshotProvider` prefetch,正常情況下首次 `/graph` 應 < 200ms。

### Q6. 我想增加新的 scamType 或關鍵字?

目前 hardcode 在 `server/lib/postUtils.ts`。修改後重啟 server 即可(`tsx` 會 hot reload)。長期建議搬到 JSON config(見 `report.md` 的 P1 項目)。

### Q7. 如何完整重置?

```bash
npm run db:reset                                # 清掉 Neo4j 資料
rm -f data/scam-intel.db data/scam-intel.db-*   # 清掉 SQLite
```

---

## 10. 疑難排解

### Docker daemon 沒在跑

```
❌ Docker daemon 沒有在運行
```

開啟 Docker Desktop(macOS 從 menu bar / Applications 啟動),等待 daemon 上線後重跑 `npm run dev:full`。

### Port 7687 被佔用

```
❌ Port 7687 已被別的進程占用
```

代表本機已有別的 Neo4j / 服務佔用 bolt port。解法:
1. 找出佔用者:`lsof -i :7687`(macOS/Linux)
2. 關掉它,或修改 `docker-compose.yml` 改 port mapping(同步改 `.env` 的 `NEO4J_URI`)

### Port 8787 / 5173 被佔用

```bash
lsof -i :8787 -i :5173
kill <pid>
```

### SSRF 把我自己的內網 API 擋掉了

這是設計上故意的。如果你**確定**要打內網(例如測試環境),可以暫時改 `server/lib/safeFetch.ts` 的 `assertSafeUrl` 加入白名單 — 但 **production 千萬不要關**,SSRF 是真實攻擊面。

### LLM 回應太慢

`/api/analyze` 與 `/api/chat` 都會打 LLM。Ollama 本地模型可能要數十秒。可以:
- 換更小的模型(`qwen3.5:1.5b` 之類)
- 清掉 `.env` 的 `WORKER_API_URL` 退回規則模式
- 後續可加 prompt caching(見 `report.md`)

### 看看後端 log

後端用 `tsx` 直接跑,所有 `console.log` / `console.error` 都會印在啟動的 terminal。Neo4j 連線狀態、爬蟲結果、評分過程都會顯示。

---

## License

本專案目前未指定授權條款。若要對外公開或商用,建議補上正式 LICENSE 檔。

---

## 相關文件

- `report.html` — 作品報告(美化版,瀏覽器開)
- `report.md` — 技術細節 + 設計決策 + 優化方向
- `TEST_REPORT.md` — 測試與驗證紀錄
- `CLAUDE.md` — Claude Code 開發 context
