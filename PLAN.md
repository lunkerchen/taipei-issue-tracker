# PLAN：Artifact 平台上的上線強化

目標：仍以 Claude Artifact 為平台（概念展示），把頁面補到經得起現場工程師觀眾亂按、開 devtools 亂寫資料的程度。
頁面：`taipei-issues.html` → https://claude.ai/artifact/Lr8CsAAA2ExTWQsm3ELakD
平台規格：`/private/tmp/claude-501/bundled-skills/2.1.295/4d19d08d3890ff48d84cc88b97b65ed8/artifact-capabilities/0.2.75/{db,sample,user}.d.ts`

## 新資料模型與存取規則

```json
{"db":{"rules":[
  {"path":"","read":"view","write":"admin"},
  {"path":"votes","read":"view","write":"owner"},
  {"path":"votes/{self}","write":"interact"},
  {"path":"reports","read":"view","write":"owner"},
  {"path":"reports/{self}","write":"interact"}
]},"user":{},"sample":{}}
```

- `reports/<userId>`：市民自己的陳情。`{ items: { <issueId>: { n, title, body, district, dept, tags, triage:{by,reason}, flagged, createdAt, author } } }`。只有本人（和擁有者）能寫。示範資料放在 `reports/demo-seed`。
- `triage/<issueId>`：局處狀態，只有 admin 能寫。`{ status, dept?, milestone?, hidden?, events:[...] }`。沒有這份文件的案件 = status open、事件由 report 推導。
- `votes/<userId>`：不變。`milestones`、`releases`、`stats/history`：只有 admin 能寫（root 規則）。
- 舊的 `issues` collection 遷移後刪除。

## 任務

| 狀態 | id | 負責 | 可改範圍 | 驗收條件 |
|---|---|---|---|---|
| [x] | T1 | implementer | `taipei-issues.html`、`check.mjs`、scratchpad 裡的 harness | 見下方 T1 驗收 |
| [x] | T2 | 主控 | Artifact DB（ArtifactData） | 12 筆 issues 依原 doc id 與 `n` 遷到 `reports/demo-seed` + `triage/*`；舊 `issues` 刪除 |
| [x] | T3 | reviewer | 唯讀 | T1 驗收逐條判定 |
| [x] | T4 | gpt-6.1-sol | 唯讀 | 同 T3，附 PLAN.md 與 diff |
| [x] | T5 | 主控 | 發布、DEMO.md | 發布時重述完整 capabilities；`as_level:view` 讀得到 reports/triage；`as_level:interact` 寫 triage 被拒、寫 milestones 被拒 |

### T1 驗收

1. 讀取改成 `reports`（每份文件的 `items` 攤平）+ `triage/<id>` 合併；doc id 與 `n` 保留，DEMO.md 的 #1、#8、#13 仍對得上。
2. 市民送出陳情：寫入自己的 `reports/<自己的 id>`（首次 `set`，之後 `update({items:{[id]:…}})`）。不再寫 `issues`。
3. 局處操作（狀態、修繕單、合併、改派、里程碑、隱藏）只寫 `triage/<id>`；`act()` 先 `acquire({holder: me, ttlMs: 10000})` 該文件，拿到後 `get()` 最新內容再寫（不存在就 `set`），`acquired:false` 時提示「別人正在處理這件，請稍後再試」。
4. 能不能寫改為：登入（有 `user.id()`）就顯示 +1 與 New issue；第一次寫入被拒（`invalid_argument` 等）時改成唯讀並提示「你目前只能檢視」。不再用 `can("data.write")` 判斷市民權限（root 已鎖成 admin，它會回 false）。
5. 每個 `sample` / `sample.json` 呼叫：`AbortController` 逾時（分類 30 秒、release 60 秒），只對暫時性錯誤重試 1 次（`not_granted`、`invalid_json` 與逾時不重試），失敗走既有 fallback。
6. 送出前遮蔽個資：手機（`09xx-xxx-xxx` 各種分隔、`+886`）、市話、身分證字號（`[A-Z][12]\d{8}`）、Email，換成 `［已遮蔽］`；有遮蔽時在表單提示件數。門牌地址不遮（定位問題需要）。
7. 分類 prompt 加 `"spam": true|false`（廣告、謾罵、與市政無關）；`spam` 時 report 寫 `flagged:true`。非 admin 看不到 `triage.hidden===true` 或「`flagged` 且 admin 沒放行（`triage.hidden!==false`）」的案件；admin 看得到並標示「已隱藏」/「待審」，有「隱藏」/「放行」按鈕。
8. 所有寫入失敗都有提示（頁面底部 `role="status"` 的 toast），被停用的按鈕會恢復。
9. Release prompt 帶入實際版本號（避免出現「v本週」這種標題）。
10. `check.mjs`：`node check.mjs` 從 HTML 抽出 `maskPII` 與 `isoWeek` 跑斷言，全過時印 OK。
11. harness（假的 `window.claude`，含 acquire、get、set、update、拒絕寫入的情境）跑過：Issues／Code／Pull requests／Milestones／Insights／Releases 六個分頁有內容、無 console 錯誤；400px 寬沒有水平捲動。
12. `node --check` 抽出的 script 通過。

## 已知上限（不處理）

- 案件編號仍由瀏覽器取 max+1，同一秒兩人送出可能撞號。
- 分類與遮蔽在市民瀏覽器執行，會開 devtools 的人可以略過；局處可用「隱藏」處理。
- 不在擁有者組織內的人只有 `view`，不能 +1 或陳情（平台限制）。

## 驗收紀錄（2026-10-23）

- T3 reviewer：第 3 輪通過。
- T4 gpt-6.1-sol：第 3 輪判未通過（triage 快取快照會讓隱藏案件重現；NFKC 拆開代理對）。3 輪用完，由主控修正並以重現腳本確認，未再送 GPT。
- 主控另修：送出成功卻誤報「送出失敗」的競態。
- T2：`reports/demo-seed` 與 6 份 `triage` 寫入後發布 v6，舊 `issues` 12 份已刪；刪除前的備份在 `backup/issues-20261023/`。
- T5：`as_level:view` 讀得到 reports 與 triage；`as_level:interact` 寫 triage、milestones、別人的 reports 都被拒。

---

# PLAN 2：黑客松定案「1999 快速通報」— 共享即時地圖 + 新聞跑馬燈（2026-10-23）

目標：觀眾掃 QR 開 Worker 版（https://taipei-issue-tracker.labanchen.workers.dev），不用登入就能通報；大螢幕的「地圖」分頁依 1999 九大類分圖層，即時跳出新通報；頁面底部跑馬燈顯示台北新聞與社群熱點。

## 介面約定（三個任務共用，不得各自更改）

1. **頁面 ↔ 執行環境**：頁面只透過 `claude.use(name)` 取得能力。`db`、`user`、`sample` 介面維持現狀（見 `taipei-issues.html` 與 `worker/build.mjs`）。新增兩個：
   - `claude.use("geocode")` → `async (q: string) => ({ lat, lng } | null)`；artifact 環境回 `null`（沒有這能力）。
   - `claude.use("news")` → `async () => [{ title, url, source, time }]`；artifact 環境回 `null`，跑馬燈隱藏。
2. **陳情 item 新欄位**（`reports/<user>.items.<id>`）：`lat`、`lng`（number，台北市範圍 lat 24.95–25.22、lng 121.45–121.67）、`loc`（`"gps"|"pin"|"geocode"|"district"`）、`address`（string ≤100，AI 抽出的地址）、`category`（既有，`TYPEA-AC####`）。
3. **地圖分層**：圖層 = `categories` 集合的 9 個大類（`SUBS[item.category].main`）；沒有 category 的放「未分類」圖層。
4. **Worker HTTP API**（皆 JSON，皆有逾時與重試上限）：
   - `GET /api/db` → 全部集合快照 `{ <collection>: { <docId>: data } }`。
   - `POST /api/db` `{ op:"set"|"update"|"delete", path:"col/doc", data? }`，header `x-visitor: <id>.<sig>`、admin 另帶 `x-admin: <token>`。
   - `GET /api/ws`（WebSocket）→ 每次寫入後廣播 `{ path, data|null }`。
   - `POST /api/visitor` → `{ id: "<id>.<sig>" }`（HMAC-SHA256，secret `VISITOR_SECRET`）。
   - `GET /api/geocode?q=` → `{ lat, lng } | { lat:null }`。
   - `GET /api/news` → `{ items:[{title,url,source,time}] }`。

## 任務

| 狀態 | id | 負責 | 可改範圍 | 驗收條件 |
|---|---|---|---|---|
| [x] | T6 | implementer | `worker/src/**`、`worker/wrangler.jsonc`、`worker/build.mjs`、`worker/test/**` | 見 T6 驗收 |
| [x] | T7 | implementer | `worker/data.json`、`scripts/enrich-seed.mjs` | 見 T7 驗收 |
| [x] | T8 | implementer | `taipei-issues.html`、`check.mjs` | 見 T8 驗收 |
| [ ] | T9 | reviewer | 唯讀 | T6–T8 驗收逐條判定 |
| [ ] | T10 | gpt-6.1-sol | 唯讀 | 同 T9，附 PLAN.md 與 diff |
| [ ] | T11 | 主控 | 部署、DEMO.md | 線上兩個瀏覽器分頁：A 通報，B 的地圖 3 秒內出現新點 |

### T6 驗收（Worker 共享資料庫、即時、地理編碼、新聞）

1. 一個 Durable Object（SQLite storage）存所有集合；DO 為空時以 `worker/data.json` 為初始資料（build 時一併打包）。
2. 權限在 Worker 端判定：visitor 只能寫 `reports/<自己 id>`、`votes/<自己 id>`；帶正確 `x-admin`（secret `ADMIN_TOKEN`，常數時間比較）才能寫其他路徑。visitor id 用 HMAC 簽章，偽造或缺少 → 403。
3. 防濫用：寫入依已驗證的 visitor id 限每分鐘 20 次（rate limit binding，key = visitor id；admin 不限）；`POST /api/visitor` 每 IP 每分鐘 150 個新 id（現場共用 Wi-Fi，主控調高）（另一個 binding）；單一文件 ≤ 32KB；`reports/<id>` 的 items ≤ 20 筆；path 只允許 `[\w:-]{1,80}/[\w:-]{1,80}`。
4. WebSocket 廣播：寫入成功後 1 秒內推給所有連線；用 DO hibernation API。
5. `build.mjs` 的 shim 改成：啟動時 `POST /api/visitor`（存 localStorage，讀寫包 try/catch），`GET /api/db` 載入，`/api/ws` 收更新並觸發 onSnapshot；斷線 2 秒後重連並重新 `GET /api/db`。`?admin=<token>` 時帶 `x-admin`，`canEdit()` 回 true。`acquire()` 回 `{acquired:true}`（ponytail 註明上限）。
6. `/api/geocode`：Nominatim（`countrycodes=tw`、`viewbox` 台北市、`bounded=1`、User-Agent 帶專案名與 email `labanchen@gmail.com`），逾時 8 秒、重試 1 次，結果用 Cache API 快取 7 天；全域節流 1 req/s（DO 內排隊或拒絕）。
7. `/api/news`：Bing News RSS（`https://www.bing.com/news/search?q=臺北&format=rss`；Google News 會以 503 擋 Cloudflare 出口 IP，2026-10-24 改用 Bing）+ PTT Taipei 板（`https://www.ptt.cc/bbs/Taipei/index.html` 標題）合併，各取最新 15 則；逾時 8 秒、重試 1 次；快取 10 分鐘；任一來源失敗仍回另一個；標題做 HTML 實體解碼、長度 ≤ 120。
8. 本機 `wrangler dev` 實測：兩個 WebSocket 客戶端，A 寫入 B 收得到；偽造 visitor → 403；visitor 寫 `triage/x` → 403；admin 寫成功。附上測試腳本 `worker/test/smoke.mjs`（node 跑，對 dev server），印 OK。

### T7 驗收（示範資料補分類與座標）

1. `scripts/enrich-seed.mjs`：對 `worker/data.json` 的 `reports.demo-seed.items` 每筆補 `category`（從 `data/1999-categories.json` 的 136 個子分類中，依標題、內文、tags 選最符合的；用對照表寫死在腳本裡，不呼叫 AI）、`address`、`lat`、`lng`、`loc:"geocode"`。
2. 座標：用 Nominatim 查 `address`（1 req/s、User-Agent 同 T6、逾時 10 秒、重試 1 次），查不到用行政區中心並加 ±0.003 隨機偏移，`loc:"district"`。結果全部落在台北市範圍內。
3. 每個 1999 大類至少有 2 筆示範案件（不夠時可新增示範案件，編號接在現有最大 `n` 之後，避開 #1、#8、#13 的既有內容）。
4. 腳本冪等：重跑結果不變（已有座標的不再查）。印出每類件數。

### T8 驗收（地圖分頁、定位、跑馬燈）

1. 新增 `Map` 分頁（nav 加在 Issues 後面），Leaflet 1.9.4（cdnjs，精確版本 + SRI 不需要），底圖用內政部國土測繪中心「臺灣通用電子地圖」EMAP（免 key；CARTO 已改為需 API key），暗色主題以 CSS filter 反轉，附 attribution。
2. 圖層：9 個大類 + 「未分類」，每類固定顏色、可用圖層控制勾選；標記用 `circleMarker`，已修復半透明；點擊跳出標題、狀態、局處、1999 子分類、+1 數、「看詳情」連到 Issues 分頁展開該案。
3. 即時：資料快照更新時增量更新標記（不整張重建）；新出現的案件標記閃爍 3 秒並在地圖角落提示「新通報：<標題>」。
4. 大螢幕模式：`#map` 開啟時地圖滿版高度（`calc(100vh - header)`），右側列出各圖層件數。
5. 新增陳情表單：「使用我的位置」按鈕（`navigator.geolocation`，逾時 8 秒）與小地圖點選（點擊放大頭針，可拖曳）；都沒有時，分類 prompt 多回 `"address"`，再 `claude.use("geocode")`；仍沒有就用行政區中心（12 區常數），`loc` 依來源填。
6. 跑馬燈：頁面最底部固定一條，`claude.use("news")` 有值才顯示；CSS 動畫捲動，hover 暫停，`prefers-reduced-motion` 時改成靜態輪播；每則為新分頁連結（`rel="noopener"`）；每 10 分鐘重抓。
7. `cleanItem` 驗證新欄位（數字範圍、`loc` 列舉、`address` 長度），不合格就丟棄該欄位而非整筆。
8. `node check.mjs` 通過；新增對 `cleanItem` 座標驗證的斷言。
9. 400px 寬無水平捲動；無 console 錯誤；artifact 環境（geocode/news 為 null）頁面照常運作。

## 已知上限（不處理）

- visitor id 只防偽造不防大量申請；一人可開無痕取得多個 id 多投 +1。
- 單一 Durable Object，展示規模足夠；上千人同時連線要分片。
- `acquire()` 在 Worker 版不鎖；兩位 admin 同時操作同一案件可能互蓋。

### PLAN 2 驗收紀錄（2026-10-24）
- reviewer：FAIL → 修正（新聞連結截斷、訪客上限 150 定案、admin token 移出網址、build hook）。
- gpt-6.1-sol：第 1 輪 FAIL（5 項）、第 2 輪 FAIL（序號下限、loadErr、geocode 間隔）、第 3 輪 PASS。
- 追加：表單「食住行育樂醫療」大方向提示；新增教育局、文化局、體育局；定位失敗時以路名／地標縮短重查。
- 已部署 https://taipei-issue-tracker.labanchen.workers.dev ，線上雙分頁即時更新與 AI 分類實測通過，測試資料已刪除。


## PLAN 3：使用情境測試修正（2026-10-24）

- [x] P3-1｜Opus｜taipei-issues.html, check.mjs, worker/data.json｜台北邊界改多邊形（OSM 1293250 簡化），板橋/三重/永和判為台北外；AI 回 outside_taipei 時先提示、可仍要送出；華江橋示範點移到萬華側｜已完成
- [x] P3-2｜Opus｜taipei-issues.html｜切換分頁寫入 #hash 歷史，手機返回鍵回上一頁｜已完成
- [x] P3-3｜Opus｜taipei-issues.html｜送出後捲到自己的新案件並標示 4 秒｜已完成
- [x] P3-4｜Opus｜taipei-issues.html｜手機地圖高度依可視高度（svh）計算，Live／回報在 375×667 首屏可見｜已完成
- [x] P3-5｜Opus｜taipei-issues.html｜空白送出顯示「請描述你遇到的問題」｜已完成
- [x] P3-6｜Opus｜worker/build.mjs｜即時連線中斷 3 秒後顯示橫幅，恢復後消失｜已完成
- [x] P3-7｜Opus｜taipei-issues.html, worker/build.mjs｜429 顯示「操作太頻繁」，連不上顯示「內容已保留」｜已完成
- [x] P3-8｜Opus｜taipei-issues.html｜GPS 誤差 >200 m 自動開小地圖請市民修正｜已完成
- [x] P3-9｜Opus｜taipei-issues.html｜AI 回 too_vague 時請市民補充地點與狀況（不再當垃圾訊息），可仍要送出｜已完成

## PLAN 4：地圖歷史時間軸（2026-10-24）

- [x] P4-1｜Opus｜scripts/fetch-1999-history.mjs, data/history-*.json｜下載 data.taipei 1999 派工資料 115 年 1–9 月（Big5／UTF-8 自動判斷），去重、排除非台北，24 個派工項目全部對應到 1999 九大類；路名層級地理編碼（Nominatim ≥1.1 s 間隔，查不到用行政區中心）；輸出不含門牌、樓層；每天 1/1–9/30 都有資料、筆數相符｜已完成
- [x] P4-2｜Opus｜worker/build.mjs｜歷史資料以靜態檔提供，shim 加 claude.use("history")；artifact 環境為 null 時頁面隱藏時間軸｜已完成
- [x] P4-3｜Opus｜taipei-issues.html｜地圖「歷史」模式：日期滑桿（1/1–9/30）、前一天／後一天、播放；當天案件以 canvas 畫在路段位置（加抖動），沿用九大類圖層勾選與計數；彈窗只顯示派工項目、行政區、路名、時間；註明資料來源；手機 375px 無水平捲動｜已完成
- [ ] P4-4｜reviewer → gpt-6.1-sol｜唯讀｜依上列驗收｜待辦

## PLAN 5：陳情照片上傳（2026-10-24）

- [x] P5-1｜Opus 主控｜worker/**｜R2 bucket `taipei-issue-photos`；`POST /api/photo` 只收簽章訪客或管理者、每訪客每分鐘 10 張、≤ 700KB、只收 JPEG／WebP（檢查檔頭）；`GET /api/photo/<key>` 只接受合法 key，回固定 content-type、nosniff、長快取｜
- [x] P5-2｜Opus 主控｜taipei-issues.html｜表單可加最多 3 張照片並預覽、可移除；瀏覽器端縮到長邊 1600、轉 JPEG（去除 EXIF 與 GPS）；送出時先上傳再建立案件，上傳失敗不建立案件、表單保留；cleanItem 只接受自己目錄、admin/（管理者上傳）或 demo/（種子）的 key；詳情與地圖彈窗顯示照片；artifact 環境不顯示上傳｜
- [ ] P5-3｜Opus 主控｜scripts/、worker/data.json｜40 件示範案件各一張 GPT Image 生成的 4:3 現場照（無文字、無可辨識人臉與車牌），上傳 R2 `demo/`，種子資料與線上資料庫加上 photos｜
- [x] P5-4｜reviewer + gpt-6.1-sol｜唯讀｜依以上條件驗收；`node check.mjs`、worker smoke test 通過｜
  - 驗收紀錄：reviewer 通過；gpt-6.1-sol 三輪。第 3 輪剩 APP0 縮圖可夾帶 EXIF（主控已改為一律換成標準 JFIF 標頭）與「熵資料未解碼、可存無法顯示的 JPEG」（接受，無隱私風險）。修正後未再送 GPT。
