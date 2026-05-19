# Scam Intel Console — 專案技術報告

> 撰寫日期:2026-05-14
> 版本:v0.0.0(prototype)

---

## 一、專案總覽

**Scam Intel Console** 是一個聚焦於台灣常見詐騙情境的防詐 demo 系統。整合即時爬蟲、知識圖譜、規則式分析、可選的 LLM/Embedding 與網址驗證,提供使用者一個從「資料來源 → 案例索引 → 對話風險分析 → KG 視覺化」的完整流程展示。

目前定位是 **可執行的 prototype**,不是 production system。

### 技術棧速覽

| 層 | 技術 |
|---|---|
| Runtime | Node.js 20+ / npm 10+ |
| Language | TypeScript(ESM,後端用 `tsx` 直接執行,不編譯) |
| Frontend | React 19 + Vite 7 + Tailwind CSS 4 + vis-network + lucide-react |
| Backend | Express 5 + cors + dotenv |
| 爬蟲解析 | `cheerio`(HTML)、`fast-xml-parser`(RSS) |
| 圖譜儲存 | Neo4j(可選) / 記憶體 fallback |
| LLM / Embedding | OpenAI 相容 API(可選) |
| 開發工具 | `concurrently`、`tsx`、TypeScript compiler |

---

## 二、系統架構

### 整體資料流

```
┌─────────────┐    ┌─────────────────────────────────────────┐
│   使用者     │───►│  React 前端(App.tsx + KG Panel)       │
└─────────────┘    └──────────────────┬──────────────────────┘
                                      │ /api/* (Vite proxy)
                                      ▼
                   ┌─────────────────────────────────────────┐
                   │  Express API (server/index.ts:8787)     │
                   └──────────────────┬──────────────────────┘
                                      │
                                      ▼
                   ┌─────────────────────────────────────────┐
                   │  scamEngine.ts (orchestrator)           │
                   │   ├─ crawlState(記憶體)                │
                   │   ├─ embeddingCache(記憶體)            │
                   │   └─ keywords / entity rules            │
                   └────┬────────┬─────────┬──────────┬──────┘
                        │        │         │          │
              ┌─────────▼──┐ ┌───▼────┐ ┌──▼─────┐ ┌─▼──────┐
              │ PTT crawl  │ │ GNews  │ │ Neo4j  │ │ LLM /  │
              │ (cheerio)  │ │ (RSS)  │ │ (opt)  │ │ Embed  │
              └────────────┘ └────────┘ └────────┘ └────────┘
```

### 核心模組

| 檔案 | 角色 |
|---|---|
| `server/index.ts` | Express app,六個 API endpoint;啟動時觸發初始爬蟲 |
| `server/lib/scamEngine.ts` | 核心 orchestrator,所有狀態與分析邏輯都在這 |
| `server/lib/postUtils.ts` | 關鍵字清單、實體抽取、scamType 推斷(全規則式) |
| `server/lib/llm.ts` | OpenAI 相容的 LLM / Embedding client(可選) |
| `server/lib/neo4j.ts` | Neo4j driver,圖譜寫入與讀取(可選) |
| `server/sources/ptt.ts` | PTT 5 個看板的網頁爬蟲 |
| `server/sources/googleNews.ts` | Google News RSS 抓取 |
| `server/data/demoPosts.ts` | Fallback 樣本資料 |
| `src/App.tsx` | 單頁 UI |
| `src/components/KnowledgeGraphPanel.tsx` | vis-network 圖譜視覺化 |

### API 一覽

| Method | Path | 用途 |
|---|---|---|
| GET | `/api/health` | 健檢 |
| GET | `/api/snapshot` | 系統狀態(來源、文章數、KG 統計、scamType 摘要) |
| GET | `/api/feed` | 最新 18 篇案例(按 publishedAt 排序) |
| GET | `/api/graph` | KG 節點與邊(優先 Neo4j,fallback 記憶體) |
| POST | `/api/crawl` | 觸發即時同步 |
| POST | `/api/analyze` | 對話風險分析(關鍵字 + 實體 + embedding + 可選 LLM) |
| POST | `/api/verify-site` | 網址啟發式風險評估 |

### 風險評分公式(`analyzeMessage`)

```
score = min(96,
  10
  + matchedKeywords.length * 8
  + matchedEntities.length * 10
  + scoredEvidence.length * 14
)

# 單篇 evidence 的分數
evidenceScore =
  overlapEntities * 24
  + keywordHits * 14
  + cosineSimilarity * 42   # 僅當 embedding 有設定

level: >=70 high / >=40 medium / 其他 low
```

> ⚠️ 這幾個常數(`24 / 14 / 42 / 8 / 10 / 14`、`70 / 40`、`96 / 98`)是手動 tune 出來的,改一個要連帶看其他。

---

## 三、目前優點

1. **降級設計完整**:Neo4j、LLM、Embedding 三個外部整合都用 `is*Configured()` 守門,缺一不可運作但不會炸,fallback 路徑清楚。
2. **資料正規化乾淨**:所有來源都過 `normalizePost`,前端拿到的是統一的 `DemoPost` 形狀。
3. **混合式評分合理**:規則式 + 語意 embedding + LLM 生成,各司其職且各自可獨立關閉。
4. **錯誤隔離**:`safeRun` 把每個 source 包起來,單一爬蟲掛掉不會拖垮整個 crawl。

---

## 四、待優化項目(按優先順序)

### P0 — 影響可用性與資料正確性

#### 1. 持久化:目前完全靠記憶體
- **問題**:`crawlState` 重啟即失。Neo4j 雖能存圖譜,但 `analyzeMessage` 永遠讀 `crawlState` 的原始文章 → Neo4j 等於只有展示用途。
- **建議**:導入 SQLite(零維運成本)或 PostgreSQL,把 `DemoPost` 持久化,並讓 `analyzeMessage` 可從 DB 讀取候選文章。
- **附帶好處**:可做去重、增量同步、歷史趨勢分析。

#### 2. Neo4j 同步策略過於暴力
- `syncPostsToNeo4j` 每次都 `MATCH (n) DETACH DELETE n` 全砍重建(`server/lib/neo4j.ts:59`)。資料一多會非常慢,而且會破壞任何在 Neo4j 上手動加的關係。
- **建議**:改為 `MERGE` + 標記 `lastSeenAt`,週期性清理過期節點。

#### 3. Neo4j fail 後不會重試
- 一次連線失敗 `neo4jAvailable` 就永久變 false,要重啟 server。
- **建議**:加入指數退避的重試,或在每次 `getGraph` / `syncPostsToNeo4j` 時重新檢查連線。

### P1 — 影響擴展性

#### 4. 爬蟲規模太小
- PTT 只抓 5 個板 × 每板前 4 篇 = 最多 20 篇。
- Google News 只取前 8 筆 RSS item。
- **建議**:
  - PTT 加入時間視窗(過去 N 天)而非固定篇數
  - 把 board 清單與關鍵字 regex 抽出到 config
  - 加入排程器(`node-cron` 或 systemd timer)定期增量同步
  - 加入 polite delay / 限流避免被擋

#### 5. 規則式 entity / scamType 寫死在程式碼
- `postUtils.ts` 的 keywords / entityPatterns 全部 hardcode。新增一個詐騙類型要改 code。
- **建議**:抽到 JSON / YAML config,或存到 DB 做後台維護。

#### 6. LLM 用法可優化
- 每次 `analyzeMessage` 都打一次 LLM,沒有 cache、沒有 prompt caching、沒有 batch。
- **建議**:
  - 對相同訊息加 LRU cache
  - 採用 Anthropic prompt caching(把系統 prompt + evidence 設為 cache breakpoint)
  - 考慮直接用 Claude API(目前用 OpenAI 相容介面,但 Claude 4.x 的 prompt caching 與 JSON mode 都支援)

### P2 — 程式碼品質

#### 7. 沒有測試,沒有 lint
- `package.json` 完全沒有 `test` 或 `lint` script。
- **建議**:至少加 `vitest` 跑核心 `analyzeMessage` / `verifySiteUrl` / `inferScamType` 的單元測試,加 `eslint` + `prettier`。

#### 8. 風險評分常數魔數遍佈
- `24 / 14 / 42 / 8 / 10 / 14 / 70 / 40 / 96 / 98` 散在各處。
- **建議**:抽成 `RISK_WEIGHTS` 常數物件,集中管理並寫註解說明每個權重的意義。

#### 9. 前端只有單一 `App.tsx`
- 全部 UI 邏輯都堆在一起。
- **建議**:拆分為 `Feed`、`AnalyzePanel`、`SiteVerifyPanel`、`SnapshotHeader` 等獨立元件,並把 `fetch` 抽成 `api/` client 模組。

#### 10. 安全性
- `verifySiteUrl` 直接 `fetch` 使用者輸入的 URL → 後端會去打對方網站,**有 SSRF 風險**(可被用來探測內網)。
- **建議**:
  - 阻擋 private IP / `localhost` / `metadata.google.internal` 等
  - 設定 timeout(目前沒有)
  - 限制 response size 與 redirect 次數

### P3 — UX / 觀測

#### 11. 前端沒有 loading / error 狀態的細緻處理(需確認)
#### 12. 沒有結構化 logging
- 目前都是 `console.error`,production 上難以追蹤。
- **建議**:導入 `pino` 或 `winston`,把 crawl / analyze / LLM 呼叫的 latency、失敗率記下來。

---

## 五、詐騙腳本來源:該怎麼獲取?

目前只有 PTT + Google News,涵蓋面不足。以下按「資料品質」與「取得難度」分類建議。

### A. 官方 / 半官方來源(高可信、低風險)

| 來源 | 內容 | 取得方式 | 備註 |
|---|---|---|---|
| **165 全民防騙網**(165dashboard.tw) | 高發詐騙手法、案件統計、公告 | 網頁爬蟲 / 部分有開放資料 | **首選**。內政部刑事局官方,腳本完整且按月更新 |
| **政府資料開放平台**(data.gov.tw) | 「詐騙」相關資料集(如電信詐騙案件統計) | API / CSV 下載 | 偏統計面,缺話術細節但可做趨勢圖 |
| **NCC 簡訊實聯制詐騙公告** | 發送量大的詐騙簡訊樣本 | 公告頁面爬蟲 | 補充簡訊類腳本 |
| **金管會 / 銀行公會公告** | 假投資、解除分期最新手法 | 公告 RSS / 爬蟲 | 對「假投資」類別特別有用 |
| **165 LINE 官方帳號 / Facebook** | 即時案例分享 | Facebook Graph API(需 token)/ 手動同步 | 即時性高 |

### B. 社群論壇(高即時性、需處理雜訊)

| 來源 | 內容 | 取得方式 | 備註 |
|---|---|---|---|
| **PTT**(已實作) | 受害者第一手敘述 | 網頁爬蟲 | 建議擴充板:`Boy-Girl`、`Stock`、`CVS`、`HatePolitics`、`Marriage` |
| **Dcard** | 年輕族群受害案例(求職、交友詐騙特別多) | 需處理動態載入與限流 | README 已點出難度,可考慮用 Playwright/Puppeteer headless |
| **Mobile01 / Bahamut 巴哈** | 成年男性 / 玩家受害案例(遊戲幣、虛寶) | 網頁爬蟲 | 補充遊戲相關詐騙 |
| **Threads / X(Twitter)** | 即時受害分享 | 官方 API(有費用)/ 限流嚴格 | 最即時但取得難度高 |

### C. 媒體新聞(廣度大、深度淺)

| 來源 | 內容 | 取得方式 |
|---|---|---|
| **Google News RSS**(已實作) | 各家媒體聚合 | RSS |
| **個別媒體 RSS**(自由、聯合、ETtoday、TVBS) | 詐騙專欄 | RSS / 爬蟲 |
| **公視 PNN / 報導者** | 深度報導 | RSS |

### D. 國際與威脅情資(進階)

| 來源 | 內容 | 用途 |
|---|---|---|
| **Whoscall 趨勢報告** | 跨國詐騙電話 / 簡訊統計 | 補充電話詐騙 |
| **PhishTank**(phishtank.org) | 全球釣魚網址 DB | 強化 `verify-site` |
| **OpenPhish** | 即時釣魚 URL feed | 同上 |
| **VirusTotal API** | 網址 / 檔案威脅判斷 | 強化 `verify-site` |
| **Google Safe Browsing API** | 危險網址清單 | 強化 `verify-site`(免費額度足夠 demo) |
| **TWNIC / TWCERT 公告** | 台灣本地 CERT 資訊 | 補充技術型攻擊資訊 |

### E. 使用者回饋資料(長期最有價值)

- 在系統內建一個「回報這則訊息」按鈕,讓使用者貢獻實際遭遇
- 經審核後納入訓練 / 索引資料
- **這是長期累積差異化資料的關鍵**

### 推薦的下一步資料策略

1. **第一步(本週可做)**
   - 串 **165 全民防騙網**(網頁爬蟲)→ 取得官方詐騙手法清單作為 ground truth
   - 串 **Google Safe Browsing API**(免費)→ 強化 `verify-site`

2. **第二步(本月可做)**
   - 擴充 PTT 板數與時間視窗
   - 加入 Mobile01 / Bahamut 補充非 PTT 族群
   - 把所有來源結果寫入 SQLite,加去重(URL hash + 標題 fuzzy match)

3. **第三步(下季可做)**
   - 串 PhishTank / OpenPhish 強化網址驗證
   - 加入使用者回報機制
   - 用 Embedding 做案例自動分群,輔助維護 scamType 分類

---

## 六、建議優先級總表

| 優先 | 項目 | 預估工時 |
|---|---|---|
| P0 | SQLite 持久化 + 去重 | 1-2 天 |
| P0 | `verify-site` SSRF 防護 + timeout | 0.5 天 |
| P0 | Neo4j 改 MERGE 增量同步 | 0.5 天 |
| P1 | 串 165 全民防騙網 | 1 天 |
| P1 | 串 Google Safe Browsing | 0.5 天 |
| P1 | 加入 vitest 與核心測試 | 1 天 |
| P1 | 規則 / 關鍵字外部化為 config | 0.5 天 |
| P2 | 前端元件拆分 | 1 天 |
| P2 | 結構化 logging | 0.5 天 |
| P2 | 風險權重常數集中化 | 0.5 天 |
| P3 | 使用者回報機制 | 2 天 |
| P3 | 排程器與增量同步 | 1 天 |

---

## 七、結論

這個專案在 prototype 階段把「完整資料流」demo 出來了,降級設計與模組切分都不錯。要走向 production,**最關鍵的兩步是**:

1. **持久化**(目前完全在記憶體,連 Neo4j 都只是圖譜投影)
2. **拓展權威資料來源**(尤其是 165 全民防騙網,這是台灣防詐領域的 ground truth)

後續若要把規則式分析升級為真正的 LLM/RAG,建議先把資料層打穩,再做語意層 —— 否則 LLM 抓到的 evidence 會永遠停留在那 20 多筆樣本。
