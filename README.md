# 台北市 Issue Tracker

把台北市當成一個 GitHub repo：市民的 1999 陳情是 issue，局處的修繕是 pull request，每月的派工成果是 release。手機優先的 1999 快速通報網站，陳情送出後由 AI 分類、分派給負責局處，並即時出現在地圖上。

- 線上網站：<https://taipei-issue-tracker.labanchen.workers.dev>
- 黑客松題目：[puma.taipei/hackathon](https://puma.taipei/hackathon)「你看見的市政 bug」

> 網站上的陳情、修繕單與 +1 是**模擬資料**，不是台北市政府的真實案件。地圖時間軸與每月派工報告使用 data.taipei 的真實 1999 派工資料（見〈資料來源〉）。

## 功能

**市民（手機為主）**

- **快速通報**：先選大方向（食、住、行、育、樂、醫療，可略過），描述問題，可套用範本、附上最多 3 張照片。
- **定位**：使用 GPS、在小地圖拖曳大頭針，或直接在地圖上長按（電腦版按右鍵）。長按會先顯示地址與座標，確認後才開表單。
- **AI 分派（taipei-bot）**：Claude 判斷負責局處、1999 官方分類（9 大類、136 子類）與行政區；偵測重複陳情（建議改按 +1）、非台北市地點、內容太模糊或垃圾訊息。
- **個資遮蔽**：電話、Email、身分證字號在送出前自動遮蔽；照片在瀏覽器縮小並重新編碼，移除 EXIF 與拍攝位置。
- **地圖**：依 1999 九大類分圖層，新通報即時出現（WebSocket）。地圖下方有 **Live**（今天最新陳情）與 **回報** 兩個按鈕。
- **歷史派工時間軸**：2026 年 1–9 月、共 128,640 件真實 1999 派工，可逐日查看或播放。點位只到路段，不含門牌。
- **跑馬燈**：頁面底部顯示 Bing News 與 PTT Taipei 板的台北新聞。

**局處管理者**（網址加 `?admin=<token>` 進入，token 進入後會從網址列移除）

- **後台**：今日通報、未結、待審核、待分派、逾期等指標；三個待辦佇列可直接放行、隱藏、改派、標記處理中或已修復。
- **案件操作**：開修繕單（PR）、Merge 結案、改派局處、設定里程碑。
- **Releases**：AI 草擬每週結案說明；另有 2026 年 1–9 月的 1999 派工月報。
- **Insights**：各局處 SLA（平均修復天數），超過門檻顯示 failing。
- **展示工具**：儲存與重設展示快照，彩排後一鍵還原。

## 架構

```
瀏覽器（taipei-issues.html）
  │  window.claude 介面：db / user / sample / geocode / news / history / photo
  ▼
Cloudflare Worker（worker/src/index.js）
  ├─ 靜態頁面（worker/public/，由 build.mjs 產生）
  ├─ /api/db、/api/ws ── Hub Durable Object（SQLite）：共享資料庫與即時推播
  ├─ /api/sample ─────── Claude API（分類用 Haiku，release 用 Sonnet）
  ├─ /api/geocode ────── OpenStreetMap Nominatim（正查與反查，快取 7 天）
  ├─ /api/news ───────── Bing News RSS、PTT Taipei 板（快取 10 分鐘）
  ├─ /api/photo ──────── R2 bucket `taipei-issue-photos`
  └─ /api/visitor ────── 簽發訪客 ID（HMAC 簽章）
```

`taipei-issues.html` 同一份頁面也能在 claude.ai artifact 執行；`worker/build.mjs` 會在頁面前面插入一段替身程式，把 `window.claude` 接到上面的 Worker API。

**安全與限制**

- 訪客只能寫自己的陳情與 +1（`reports/<id>`、`votes/<id>`），身分由 Worker 簽章驗證；管理者 token 以常數時間比對。
- 限流：AI 每 IP 每分鐘 10 次、寫入每位訪客每分鐘 20 次、照片每位訪客每分鐘 10 張、新訪客 ID 每 IP 每分鐘 150 個。
- 照片：只收結構標準的 baseline JPEG，上限 700KB，伺服器再移除中繼資料；讀取時固定 `image/jpeg`、`nosniff`、CSP `default-src 'none'`。
- 所有外部請求都有逾時與重試上限。

## 目錄

| 路徑 | 內容 |
|---|---|
| `taipei-issues.html` | 整個前端（單一檔案） |
| `check.mjs` | 前端邏輯檢查：個資遮蔽、資料清理、台北市界、範本判斷、照片 key |
| `worker/` | Cloudflare Worker：`src/index.js`（路由）、`src/hub.js`（Durable Object）、`build.mjs`、`data.json`（種子資料）、`test/` |
| `data/1999-categories.json` | 1999 官方案件分類（9 大類、136 子類） |
| `data/history-2026.json` | 2026 年 1–9 月 1999 派工（路段層級） |
| `data/history-roads.json` | 路名座標快取 |
| `scripts/` | 資料腳本，見下表 |
| `deck/` | 簡報與產品截圖 |
| `DEMO.md`、`SCRIPT.md` | 上台展示流程與口說文字稿 |
| `PLAN.md` | 各階段任務與驗收紀錄 |

| 腳本 | 用途 |
|---|---|
| `scripts/fetch-1999-history.mjs` | 下載 data.taipei 1999 派工 CSV，取路段、查座標，產生 `data/history-2026.json` |
| `scripts/history-releases.mjs` | 由歷史資料產生每月派工報告（`--write` 寫入線上資料庫） |
| `scripts/enrich-seed.mjs` | 幫示範案件補 1999 分類與座標 |
| `scripts/demo-photos.mjs` | 把生成的示範照片轉成 JPEG、上傳 R2，並加進示範資料 |

## 本機開發

需要 Node.js 22 以上與 Wrangler。

```bash
cd worker
npm install -g wrangler   # 若尚未安裝
```

建立 `worker/.dev.vars`（不進 git）：

```
VISITOR_SECRET=<任意長字串>
ADMIN_TOKEN=<本機管理者 token>
ANTHROPIC_API_KEY=<選填，沒有時 AI 分類改為「1999 待分派」>
```

啟動並測試：

```bash
cd worker && npx wrangler dev --port 8788
```

```bash
node check.mjs
```

```bash
cd worker && BASE=http://localhost:8788 node test/smoke.mjs
```

```bash
cd worker && node test/sync.mjs
```

本機網址：<http://localhost:8788>，管理者模式：`http://localhost:8788/?admin=<ADMIN_TOKEN>`。

## 部署

```bash
cd worker && npx wrangler deploy
```

正式環境需要三個 secret（用 `wrangler secret put <名稱>` 設定）：`VISITOR_SECRET`、`ADMIN_TOKEN`、`ANTHROPIC_API_KEY`。另需 R2 bucket `taipei-issue-photos`。

注意：線上資料庫只在第一次啟動時從 `worker/data.json` 載入。之後修改種子資料，要用管理者權限另外寫入（腳本的 `--write` 或 `ADMIN`／`BASE` 環境變數）。

## 資料來源

| 資料 | 來源 |
|---|---|
| 1999 派工（2026 年 1–9 月） | [臺北市政府資料開放平台](https://data.taipei/dataset/detail?id=b796f87a-0ed8-4e57-89f6-225a4941b1ed)；原始資料只有立案日期，沒有結案狀態 |
| 1999 案件分類 | [臺北市 1999 市民當家熱線](https://1999.gov.taipei/) |
| 底圖 | 內政部國土測繪中心臺灣通用電子地圖 |
| 地址與座標 | © OpenStreetMap contributors（Nominatim） |
| 跑馬燈 | Bing News、PTT Taipei 板 |
| 示範照片 | GPT Image 生成，非真實現場 |

## 已知限制

- 管理者權限只在開啟的那個瀏覽器分頁有效。
- 案件編號在高併發下可能重複；兩位管理者同時編輯同一案件可能互相覆蓋。
- AI 分類與遮蔽在瀏覽器執行，提示內容由 Worker 檢查前綴與長度上限。
- 上傳後未送出的照片會留在 R2，沒有自動清理。
- 歷史派工點位只到路段；約 6% 查不到路段的案件放在行政區中心附近。
