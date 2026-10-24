# 台北市 Issue Tracker

繁體中文 | [English](README.en.md)

<!-- 本檔是 README.en.md（ASD-STE100 簡化技術英文）的繁體中文翻譯。修改時兩份一起改。 -->

這個網站把台北市呈現成一個 GitHub repo。市民的 1999 陳情是 issue。局處的修繕是 pull request。每月的派工摘要是 release。

這是手機優先的 1999 快速通報網站。市民送出陳情。AI 分類陳情，並分派給負責的局處。陳情會立即出現在地圖上。

- 線上網站：<https://taipei-issue-tracker.labanchen.workers.dev>
- 黑客松題目：[puma.taipei/hackathon](https://puma.taipei/hackathon)「你看見的市政 bug」

> 網站上的陳情、修繕單與 +1 是**模擬資料**，不是台北市政府的真實案件。地圖時間軸與每月派工報告使用 data.taipei 的真實 1999 派工資料。請參閱〈資料來源〉。

## 功能

**市民（手機優先）**

- **快速通報**：先選大方向：食、住、行、育、樂或醫療。這一步可以略過。然後描述問題。每個大方向有 3 到 7 個範本（共 33 個）。如果套用範本，但冒號後面沒有填內容，網站會擋下這筆陳情。可以用中文語音輸入，瀏覽器支援時才會顯示語音按鈕。最多可以附上 3 張照片。
- **聯絡資料**：姓名與手機必填。Worker 會把案件與私有聯絡資料一起保存；重複案被拒絕或新案建立失敗時，不會留下該次嘗試的聯絡資料。重試會保留首次成功儲存的聯絡資料。資料以案件作者身分保存，從管理者分頁送出的通報也一樣。只有管理者能讀，網站不會公開。如果陳情內容和某人或某個店家有關（例如違規停車、噪音或違建），可以勾選「實名檢舉」。
- **送出前預覽**：AI 分類完成後，網站先顯示標題、負責局處、1999 分類、行政區、地點與分派理由。自行選擇位置後，預覽會顯示該位置的座標，無論是否有地址。按下「確認送出」後，網站才建立案件。修改表單後必須重新預覽。送出失敗時，未修改內容的重試會沿用同一個案件 ID。
- **隱私權告知、使用條款與非官方聲明**：通報表單與頁尾說明本站不是臺北市政府網站。網站不會把陳情轉給 1999 或市府局處。緊急事件請撥 110 或 119。送出陳情前，必須同意隱私權告知與使用條款。隱私權告知說明誰蒐集資料、目的、哪些資料公開、第三方（Anthropic、Cloudflare、OpenStreetMap Nominatim、國土測繪中心）、保存期間，以及個資法第 3 條的權利。這兩份文件是 `taipei-issues.html` 裡的 `<dialog>`（`#privacy`、`#terms`）。營運者或聯絡信箱改變時，請在這裡修改。
- **相同或類似的陳情**：AI 可能判斷出重複的陳情。伺服器也可能找到 30 分鐘內內容相同的陳情。這時網站提供三個選擇：
  - 「補充到 #N」：網站把你的描述和照片加到那件案件，並幫它 +1。重試時，Worker 會沿用同一個補充 ID 與已上傳的照片 key，只建立一則補充，也會保留其他既有補充。
  - 「只幫 #N 按 +1」。
  - 送出新案件。如果內容完全相同，這個選項會改成「修改內容」。

  網站把每則補充存在 `addenda/<訪客 ID>`，並顯示為「其他市民補充」。
- **我的陳情與補充**：「我的陳情」列出你送出的案件。你可以在自己的案件新增文字和最多 3 張照片；請等照片上傳完成再送出補充。上傳失敗時，文字與已上傳的照片會留在表單。每件案件最多 10 則補充。Worker 網站會用一次寫入追加每則補充，同時送出的補充也會分別保留。
- **定位**：使用 GPS、在小地圖拖曳大頭針，或在地圖上長按。在電腦上，對地圖按右鍵。長按後，網站先顯示地址與座標，確認後才開啟通報表單。較早發出的 GPS 結果晚到時，不會取代你手動選取或清除的位置。
- **AI 分派（taipei-bot）**：Claude 判斷負責局處、1999 官方分類（9 大類、136 子類）與行政區。它也會找出重複的陳情、台北市以外的地點、內容不清楚的陳情與垃圾訊息。
- **個資遮蔽**：送出陳情或補充前，網站會遮蔽台灣電話（包含常見斜線分隔，以及 `+886`、`00886` 手機國碼格式）、Email 與身分證字號；聯絡資料欄位仍以私有資料保存。瀏覽器會把每張照片縮小並重新編碼，這樣會移除 EXIF 資料與拍攝位置。
- **地圖**：地圖依 1999 九大類各分一個圖層。新通報會立即出現（WebSocket）。地圖下方有兩個按鈕：**Live**（今天最新的陳情）與 **回報**。紫色虛線標出 12 個行政區的區界。
- **歷史派工時間軸**：時間軸顯示 2026 年 1 月到 9 月共 128,640 件真實 1999 派工。可以一次看一天，也可以依序播放。地圖載入中選擇歷史模式後，地圖就緒時會自動開啟；也可以取消選擇，或在載入失敗後重試。每個點位只到路段，不顯示門牌。
- **照片**：案件詳情與地圖彈窗會顯示照片。點照片會在燈箱中放大。案件詳情另有一張小地圖標出位置。
- **深色／淺色模式**：用頁首的按鈕切換。一開始網站跟隨系統設定。瀏覽器會記住你的選擇。地圖顏色也會跟著改變。
- **鍵盤與多分頁**：展開或收合案件詳情時會保留鍵盤焦點。即時更新會保留補充表單的文字與游標。每次 +1 只更新該案件，不會抹掉另一分頁對其他案件的投票。送出通報後，鍵盤焦點會移到新案件。照片選擇器會顯示焦點框。螢幕閱讀器可讀取預覽中的分類結果。姓名與手機欄位標示為必填；填錯的欄位會標示錯誤，直到修正為止。標籤文字在淺色與深色主題都有足夠對比。
- **案件分享連結**：每件案件都有依資料 ID 建立的穩定連結，不會隨顯示編號改變。頁面會等伺服器確認案件與分派資料後，清除篩選並開啟正確的未完成或已修復列表。複製的連結不含網址參數。如果瀏覽器不允許自動複製，可以選取案件詳情中顯示的連結並手動複製。
- **瀏覽器身分**：Worker 網站會在這個瀏覽器保留訪客身分。如果瀏覽器無法保留身分，仍可瀏覽案件，但不能送出通報；允許網站儲存資料並重新整理後即可通報。支援 Web Locks 的瀏覽器會讓同時開啟的分頁共用同一個身分。
- **跑馬燈**：頁面底部顯示 Bing News 與 PTT Taipei 板的台北新聞，不顯示交易或徵求類貼文。另外也顯示人工挑選的 Threads 貼文。每則前面標日期，例如 10/24。

**局處管理者**（在網址加上 `?admin=<token>`。開啟頁面後，網站會把 token 從網址列移除。）

- **後台**：後台顯示今日通報、未結案件、待審核、待分派與逾期案件。三個待辦佇列可以放行、隱藏、改派，或把案件設為「處理中」或「已修復」。
- **案件操作**：開修繕單（PR）、Merge 以結案、改派局處、設定里程碑，以及查看市民的聯絡資料。
- **Releases**：AI 草擬每週結案摘要。另有 2026 年 1 月到 9 月的 1999 派工月報。
- **Insights**：網站顯示各局處的 SLA（平均修復天數）。局處超過門檻時，網站顯示「failing」。
- **展示工具**：儲存與重設展示快照。彩排後按一下就能還原資料。

## 架構

```
瀏覽器（taipei-issues.html）
  │  window.claude 介面：db / user / sample / geocode / news / history / photo / contact
  ▼
Cloudflare Worker（worker/src/index.js）
  ├─ 靜態頁面（worker/public/，由 build.mjs 產生）
  ├─ /api/db、/api/ws ── Hub Durable Object（SQLite）：共享資料庫與即時更新
  ├─ /api/sample ─────── Claude API（分類用 Haiku，release 用 Sonnet）
  ├─ /api/geocode ────── OpenStreetMap Nominatim（地址轉座標與座標轉地址，快取 7 天）
  ├─ /api/news ───────── Bing News RSS、PTT Taipei 板（快取 10 分鐘）
  ├─ /api/photo ──────── R2 bucket `taipei-issue-photos`
  ├─ /api/contact ────── 市民姓名與手機（DO 私有資料表，只有管理者能讀）
  └─ /api/visitor ────── 簽發訪客 ID（HMAC 簽章）
```

同一份 `taipei-issues.html` 也能當成 claude.ai artifact 執行。`worker/build.mjs` 會在頁面前面放一小段轉接程式，把 `window.claude` 接到上面的 Worker API。

**安全與限制**

- 訪客只能寫自己的陳情與 +1（`reports/<id>`、`votes/<id>`）。Worker 用簽章檢查身分，並以常數時間比對管理者 token。
- 防止大量洗版。伺服器檢查每一筆新陳情：
  - 每次請求只能新增一筆陳情。
  - 建立時間必須是當下時間，不接受較早的時間。
  - 每位訪客每 10 分鐘最多 3 筆、每天最多 10 筆。
  - 同一個 IP 每 10 分鐘最多 60 筆，讓活動現場共用 Wi-Fi 的多人也能使用。
  - 內容和 30 分鐘內的其他陳情相同時，伺服器會擋下。比對時不看空白與標點。網站會提示改按 +1。
  - 這些限制不適用於管理者。
- 限流：AI 每個 IP 每分鐘 10 次。寫入每位訪客每分鐘 20 次。照片每位訪客每分鐘 10 張。新訪客 ID 每個 IP 每分鐘 150 個。
- 照片：伺服器只接受 700 KB 以下的標準 baseline JPEG，並再次移除中繼資料。每張照片的回應都使用 `image/jpeg`、`nosniff` 與 CSP `default-src 'none'`。
- 所有外部請求都有逾時與重試上限。

## 目錄

| 路徑 | 內容 |
|---|---|
| `taipei-issues.html` | 整個前端（單一檔案） |
| `check.mjs` | 前端邏輯檢查：個資遮蔽、資料清理、台北市界、範本、照片 key |
| `worker/` | Cloudflare Worker：`src/index.js`（路由）、`src/hub.js`（Durable Object）、`build.mjs`、`data.json`（種子資料）、`test/` |
| `data/1999-categories.json` | 1999 官方案件分類（9 大類、136 子類） |
| `data/history-2026.json` | 2026 年 1 月到 9 月的 1999 派工（路段層級） |
| `data/history-roads.json` | 路段座標快取 |
| `scripts/` | 資料腳本，請參閱下表 |
| `deck/` | 簡報與產品截圖 |
| `DEMO.md`、`SCRIPT.md` | 展示流程與口說文字稿 |
| `PLAN.md` | 各階段任務與驗收紀錄 |

| 腳本 | 用途 |
|---|---|
| `scripts/fetch-1999-history.mjs` | 下載 data.taipei 的 1999 派工 CSV，取出路段、查詢座標，並產生 `data/history-2026.json` |
| `scripts/history-releases.mjs` | 由歷史資料產生每月派工報告（`--write` 寫入線上資料庫） |
| `scripts/enrich-seed.mjs` | 幫示範案件加上 1999 分類與座標 |
| `scripts/codex-proxy.mjs` | 只用於本機開發：把 AI 分類請求轉給 Codex CLI |
| `scripts/demo-photos.mjs` | 把生成的示範照片轉成 JPEG、上傳到 R2，並加進示範資料 |

## 本機開發

需要 Node.js 22 以上版本與 Wrangler。

```bash
cd worker
npm install -g wrangler   # 若尚未安裝
```

建立 `worker/.dev.vars` 檔案。不要把這個檔案放進 git。

```
VISITOR_SECRET=<一段夠長的隨機字串>
ADMIN_TOKEN=<本機管理者 token>
ANTHROPIC_API_KEY=<選填；留空時 AI 分類設為「1999 待分派」>
AI_PROXY_URL=<選填；本機改用 Codex CLI 分類：http://127.0.0.1:8799>
```

**本機用 Codex CLI 做 AI 分類**（不需要 Claude API key）：

1. 啟動代理。
2. 在 `.dev.vars` 設定 `AI_PROXY_URL=http://127.0.0.1:8799`。

代理對每次請求執行一次 `codex exec`。預設模型是 `gpt-6-luna`，使用低推理強度與唯讀沙箱。要換模型，請設定 `CODEX_MODEL`。每次分類約需 10 秒。代理只在本機使用，線上網站仍使用 Claude API。

```bash
node scripts/codex-proxy.mjs
```

啟動伺服器並執行測試：

```bash
cd worker && npx wrangler dev --port 8788
```

```bash
node check.mjs
```

```bash
node worker/test/votes.mjs
node worker/test/visitor.mjs
```

瀏覽器回歸測試需要 Playwright 與運作中的本機 Worker。請在測試環境安裝 Playwright，也可以用 `PLAYWRIGHT_MODULE` 指定套件路徑、`CHROME_EXECUTABLE_PATH` 指定已安裝的 Chrome 執行檔。電話遮罩測試預設使用 8788 埠；其他本機網址可用 `PHONE_MASK_BASE` 設定。設定 `PHONE_MASK_EVIDENCE_DIR` 可儲存瀏覽器截圖。

```bash
node worker/test/report-flow.mjs
BASE=http://localhost:8807 node worker/test/coordinate-preview.mjs
node worker/test/addendum-flow.mjs
node worker/test/phone-mask.mjs
node worker/test/note-photos.cjs
node worker/test/share-links.mjs
BASE=http://localhost:8808 node worker/test/location-request-race.mjs
```

歷史地圖載入測試使用合成派工資料，檢查 Leaflet 延遲載入、取消操作與失敗重試：

```bash
HISTORY_MAP_LOADING_BASE=http://localhost:8788 node worker/test/history-map-loading.mjs
```

定位測試使用合成訪客身分，在瀏覽器中延遲 GPS 與地址查詢結果，並攔截資料庫寫入。

```bash
cd worker && BASE=http://localhost:8788 node test/smoke.mjs
```

```bash
BASE=http://localhost:8788 ADMIN_TOKEN=<local-test-token> node worker/test/report-contact.mjs
```

```bash
cd worker && node test/sync.mjs
```

本機網址：<http://localhost:8788>。管理者模式：`http://localhost:8788/?admin=<ADMIN_TOKEN>`。

## 部署

```bash
cd worker && npx wrangler deploy
```

正式環境需要三個 secret。用 `wrangler secret put <名稱>` 設定每一個：`VISITOR_SECRET`、`ADMIN_TOKEN`、`ANTHROPIC_API_KEY`。另外也需要 R2 bucket `taipei-issue-photos`。

注意：線上資料庫只在第一次啟動時載入 `worker/data.json`。之後如果修改種子資料，要用管理者權限寫入。請使用腳本的 `--write` 選項，或 `ADMIN` 與 `BASE` 環境變數。

## 資料來源

| 資料 | 來源 |
|---|---|
| 1999 派工（2026 年 1 月到 9 月） | [臺北市政府資料開放平台](https://data.taipei/dataset/detail?id=b796f87a-0ed8-4e57-89f6-225a4941b1ed)。原始資料只有立案日期，沒有結案狀態。 |
| 1999 案件分類 | [臺北市 1999 市民當家熱線](https://1999.gov.taipei/) |
| 底圖 | 內政部國土測繪中心臺灣通用電子地圖 |
| 地址與座標 | © OpenStreetMap contributors（Nominatim） |
| 行政區界 | © OpenStreetMap contributors（行政區 relation，經 Nominatim 簡化至約 30 公尺） |
| 跑馬燈 | Bing News、PTT Taipei 板 |
| 示範照片 | GPT Image 生成，不是真實現場 |

## 已知限制

- 管理者權限只在用 token 開啟的那個瀏覽器分頁有效。
- 不支援 Web Locks 的瀏覽器，首次同時開兩個分頁時仍可能產生不同訪客身分。「我的陳情」綁定這個瀏覽器保留的身分。
- Worker 網站以原子操作建立案件與追加補充；claude.ai artifact 保留原有資料庫更新方式，不具備這些伺服器保證。
- 很多人同時送出陳情時，案件編號可能重複。兩位管理者同時修改同一件案件時，其中一方的修改可能被覆蓋。
- AI 分類與個資遮蔽在瀏覽器執行。Worker 會檢查提示的開頭與長度上限。
- 上傳了照片卻沒有送出陳情時，照片會留在 R2，系統不會自動刪除。
- 每個歷史點位只到路段。約 6% 的案件找不到路段，這些點位放在行政區中心附近。
