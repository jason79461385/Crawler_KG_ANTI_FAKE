# Scam Intel Console

一個以台灣常見詐騙情境為主的防詐 demo 專案，整合：

- `PTT` 公開看板爬取
- `Google News RSS` 詐騙案例補充來源
- 知識圖譜（KG）整理
- `LLM + RAG` 風格的訊息風險分析
- `vis.js` 圖譜可視化
- 假網站 / 可疑網站驗證

這個專案目前是「可執行的 demo / prototype」，目標是展示完整資料流與使用體驗，不是已正式上線的 production system。

## 專案目標

這個系統希望解決幾件事：

1. 持續蒐集近期詐騙案例
2. 整理出目前常見的詐騙腳本與話術
3. 讓使用者可以輸入對話，快速得到風險分析
4. 讓使用者直接查看系統抓到的文章與新聞來源
5. 協助使用者驗證可疑網站是否可能是假網站
6. 用知識圖譜方式視覺化實體關係

## 目前功能

- 即時同步資料來源
  - `PTT`：抓取公開看板並篩選詐騙相關文章
  - `Google News RSS`：以詐騙相關關鍵字補充近期新聞案例
- 最新詐騙腳本摘要
  - 依目前索引到的案例，自動整理常見詐騙類型與示例
- 文章 / 新聞清單
  - 顯示目前系統抓到的案例、時間、來源與連結
- 對話風險分析
  - 使用關鍵字、實體與相似案例做 RAG 風格比對
- KG 視覺化
  - 使用 `vis-network` 顯示節點與關聯
- 網站真偽驗證
  - 針對使用者輸入的網址做簡易風險評估

## 專案結構

```text
.
├── server
│   ├── data
│   │   └── demoPosts.ts
│   ├── lib
│   │   ├── postUtils.ts
│   │   └── scamEngine.ts
│   ├── sources
│   │   ├── googleNews.ts
│   │   └── ptt.ts
│   └── index.ts
├── src
│   ├── components
│   │   └── KnowledgeGraphPanel.tsx
│   ├── App.tsx
│   ├── main.tsx
│   ├── styles.css
│   └── types.ts
├── index.html
├── package.json
├── tsconfig.app.json
├── tsconfig.json
└── vite.config.ts
```

## 如何啟動

### 需求

- `Node.js 20+`
- `npm 10+`

### 安裝

```bash
npm install
```

### 開發模式

```bash
npm run dev
```

這會同時啟動：

- 前端：`Vite`
- 後端 API：`Express + tsx`

預設開發流程：

- 前端由 `Vite` 提供
- `/api/*` 會透過 `vite.config.ts` proxy 到 `http://localhost:8787`

### 只啟動後端

```bash
npm run server
```

### 打包

```bash
npm run build
```

## API 一覽

### `GET /api/health`

健康檢查。

### `GET /api/snapshot`

取得目前系統快照，包含：

- 已索引來源
- 文章數量
- KG 統計
- 最新詐騙腳本摘要

### `GET /api/feed`

取得目前系統抓到的文章 / 新聞列表。

回傳內容包含：

- `title`
- `snippet`
- `source`
- `board`
- `scamType`
- `url`
- `publishedAt`

### `POST /api/crawl`

觸發即時同步。

目前會：

1. 抓取 `PTT` 公開看板
2. 抓取 `Google News RSS`
3. 更新目前系統內的索引資料

### `POST /api/analyze`

輸入使用者訊息後，回傳：

- 風險分數
- 風險等級
- 命中關鍵字
- 命中實體
- 相似案例
- KG 節點與邊
- 防詐摘要與處置建議

範例 request：

```json
{
  "message": "有人在 LINE 上說可以帶我做虛擬貨幣保證獲利，還要我先匯款到指定帳戶"
}
```

### `POST /api/verify-site`

輸入一個網站網址，回傳網址風險判斷。

目前檢查的訊號包含：

- 是否使用 `HTTPS`
- 是否有 `punycode`
- 是否直接使用 IP
- 是否包含可疑字詞
- 是否使用高風險尾碼
- 網頁內容是否出現常見詐騙訊號

範例 request：

```json
{
  "url": "secure-wallet-bonus.xyz/login"
}
```

## 目前技術棧

### 前端

- `React 19`
- `TypeScript`
- `Vite`
- `Tailwind CSS 4`
- `lucide-react`
- `vis-network`（vis.js network 視覺化）

### 後端

- `Node.js`
- `Express 5`
- `TypeScript`
- `tsx`
- `cors`

### 爬蟲 / 解析

- `fetch`（Node 內建）
- `cheerio`
- `fast-xml-parser`

### 資料與分析

- 規則式關鍵字比對
- 規則式實體抽取
- 規則式詐騙類型推斷
- 簡化版知識圖譜建構
- RAG 風格相似案例檢索
- 規則式網站風險評估

### 開發工具

- `npm`
- `concurrently`
- `tsx`
- `TypeScript compiler`

## 完整技術棧總表

| 類別 | 技術 |
|---|---|
| Runtime | Node.js |
| Package Manager | npm |
| Language | TypeScript |
| Frontend Framework | React 19 |
| Frontend Build Tool | Vite 7 |
| Styling | Tailwind CSS 4 |
| Icons | lucide-react |
| Graph Visualization | vis-network |
| Backend Framework | Express 5 |
| API Dev Runtime | tsx |
| CORS | cors |
| HTML Parsing | cheerio |
| RSS/XML Parsing | fast-xml-parser |
| Concurrent Dev Scripts | concurrently |

## 目前資料來源策略

### 已實作

- `PTT`
  - 讀取公開看板頁面
  - 篩選詐騙相關文章
  - 進入文章頁擷取標題與內容

- `Google News RSS`
  - 以詐騙相關關鍵字抓近期新聞
  - 作為廣域案例補充來源

### 暫時未直接實作

- `Dcard`

原因：

- Dcard 實際上比較容易遇到動態內容、驗證、人機限制與穩定性問題
- 目前這版優先選擇較穩定、可公開取得的來源
- 因此採用 `PTT + Google News` 作為現階段組合

## 目前系統設計說明

### 1. 資料同步

`POST /api/crawl` 會觸發：

- `crawlPttPosts()`
- `crawlGoogleNewsPosts()`

如果其中一個來源失敗：

- 不會讓整個系統中斷
- 會保留 fallback 資料
- 前端會顯示 `Live / Fallback`

### 2. 文章正規化

所有來源資料都會先轉成統一格式：

- `id`
- `source`
- `board`
- `title`
- `content`
- `url`
- `publishedAt`
- `scamType`
- `entities`

### 3. 知識圖譜

目前圖譜是簡化版：

- `post` 當作節點
- `entity` 當作節點
- `mentions` 當作邊

節點與邊由後端組好後回傳給前端，再用 `vis-network` 繪製。

### 4. 對話分析

輸入一段使用者對話後：

1. 命中風險關鍵字
2. 命中已知實體
3. 比對相似案例
4. 產生風險分數
5. 回傳警示摘要與處置建議

### 5. 網站驗證

網站驗證目前屬於啟發式規則系統，不是正式資安掃描器。

目前會檢查：

- 網址格式
- 網域關鍵字
- 可疑尾碼
- 是否能連線
- 回應內容是否出現高風險訊號

## 已知限制

- 目前尚未使用資料庫，資料存在記憶體中
- server 重啟後，索引資料會回到預設 demo 狀態
- `PTT` 爬取仍是輕量策略，非大規模索引器
- `Google News` 只作為補充來源，不保證新聞連結長期穩定
- `網站驗證` 是 heuristic-based，不應視為正式網站真偽保證
- `LLM + RAG` 目前是規則與檢索模擬，尚未接真正的 LLM API
- `Dcard` 尚未接入真實 crawler

## 如果別人要接手實作，建議下一步

### 優先順序 1

- 加入 `SQLite` 或 `PostgreSQL`
- 將爬到的文章持久化
- 加上去重與增量同步

### 優先順序 2

- 改善 `PTT` 的多頁爬取策略
- 加入更多板面
- 為文章保留作者、時間、原始 URL、推文資訊

### 優先順序 3

- 真正接入 `LLM API`
- 將目前的規則式摘要改為真正的 LLM 生成
- 做 embedding / vector search

### 優先順序 4

- 強化網站驗證
- 加入 Whois、TLS 憑證、favicon 比對、品牌網域白名單

### 優先順序 5

- 為文章列表加入搜尋、過濾與分頁
- 為 KG 加入節點點擊互動
- 為詐騙腳本加入時間趨勢分析

## 建議交接方式

如果要把這個專案交給其他工程師或團隊，建議至少一起交付：

1. 這份 `README.md`
2. `.env` 規劃說明
3. 你期望的下一階段需求清單
4. 目前已確認的重要限制
5. 你希望優先完成的功能排序

## License

目前尚未指定，若要公開或交接給外部團隊，建議補上正式授權條款。
