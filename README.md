# 台北市 Issue Tracker

繁體中文 | [English](README.en.md)

![台北市，你給我聽好了｜市民 1999 通報地圖](docs/og.jpg)

<!-- 本檔是 README.en.md（ASD-STE100 簡化技術英文）的繁體中文翻譯。修改時兩份一起改。 -->

這個網站把台北市呈現成一個 GitHub repo。市民的 1999 陳情是 issue。局處的修繕是 pull request。每月的派工摘要是 release。

這是個人製作的非官方示範網站，參考 1999 通報流程。本站不是臺北市政府或 1999 官方網站。本站陳情是模擬案件，不會轉交市府或 1999。AI 會分類通報，並建議負責局處。案件會立即出現在地圖上。網站標題是「台北市，你給我聽好了｜市民 1999 通報地圖（非官方示範）」。

- 線上網站：<https://taipei-issue-tracker.labanchen.workers.dev>
- 局處後台（示範，免驗證）：<https://taipei-issue-tracker.labanchen.workers.dev/?admin>
- 黑客松題目：[puma.taipei/hackathon](https://puma.taipei/hackathon)「你看見的市政 bug」

> 網站上的陳情、修繕單與 +1 是**模擬資料**，不是台北市政府的真實案件。地圖時間軸與每月派工報告使用 data.taipei 的真實 1999 派工資料。請參閱〈資料來源〉。

## 搜尋資料

Worker 產生的頁面有 Schema.org JSON-LD，包含 `WebSite`、`WebPage` 與 `WebApplication` 三個節點。描述會說明這是個人製作的非官方示範；公開案件與分派為模擬，不會送到臺北市政府或 1999。Canonical 與 Open Graph 網址都指向本站。

執行 `node worker/test/structured-data.mjs`，即可重新建置頁面並檢查 JSON-LD、節點關係、canonical 網址、頁面 metadata 與可見聲明。這項本機檢查不保證 Google 搜尋結果會顯示特殊功能。

## 畫面截圖

以下為 2026-10-24 線上網站的截圖（淺色模式，模擬資料）。

| | |
|---|---|
| ![行政區地圖](docs/screens/map.png)<br>**地圖**：12 個行政區與 1999 九大類圖層 | ![行政區與各里](docs/screens/district.png)<br>**行政區**：各里界與有未完成陳情的里 |
| ![里頁面](docs/screens/village.png)<br>**里頁面**：里長、議員與里內陳情 | ![通報表單](docs/screens/report.png)<br>**快速通報**：大方向、範本、語音、照片與位置 |
| ![陳情列表](docs/screens/issues.png)<br>**陳情列表**：貢獻圖、篩選與 +1 | ![案件詳情](docs/screens/issue-detail.png)<br>**案件詳情**：照片、位置與小地圖 |
| ![修繕單](docs/screens/pulls.png)<br>**Pull requests**：局處送出的修繕單 | ![里程碑](docs/screens/milestones.png)<br>**Milestones**：市政計畫與預算期 |
| ![成效](docs/screens/insights.png)<br>**成效**：各局處 SLA | ![週報](docs/screens/releases.png)<br>**Releases**：每週結案摘要 |

<img src="docs/screens/mobile-map.png" alt="手機版地圖" width="260"><br>**手機版**：地圖與底部導覽列

## 功能

**市民（手機優先）**

- **快速通報**：先選大方向：食、住、行、育、樂或醫療。這一步可以略過。然後描述問題，或套用 33 個範本之一。可以用中文語音輸入，最多可以附上 3 張照片。
- **聯絡資料**：姓名、手機與 Email 必填。市民畫面不顯示這些資料，但示範站的局處後台不需驗證，任何人都能讀到，所以請不要填寫真實個資。網站目前不會寄送 Email 或簡訊通知。如果陳情內容和某人或某個店家有關，可以勾選「實名檢舉」。
- **通報欄位**：Worker 只接受標題 1 到 200 字元、內容 1 到 2000 字元，且標籤為字串清單的新案件，其他一律以 `bad_item` 拒絕。
- **手機與鍵盤操作**：固定的新聞跑馬燈與底部導覽不會蓋住鍵盤焦點所在的控制項。手機字級放大時，頁面不會變寬。表單欄位有錯誤時，錯誤訊息顯示在該欄位下方。
- **操作後的鍵盤焦點**：送出補充後，或管理者變更案件後，焦點會留在同一個表單、控制項或案件標題。
- **送出前預覽**：AI 分類後，網站先顯示標題、負責局處、1999 分類、行政區、地點與分派理由。按下「確認送出」後，網站才建立案件。修改表單後必須重新預覽。送出失敗時，表單會保留草稿；重試會沿用同一個案件 ID。AI 分類無法使用時，標題取通報內容前 40 個字。
- **隱私權告知、使用條款與非官方聲明**：本站不是臺北市政府網站，不會把陳情轉給 1999 或市府局處。緊急事件請撥 110 或 119。送出陳情前，必須同意隱私權告知與使用條款。這兩份文件是 `taipei-issues.html` 裡的 `<dialog>`（`#privacy`、`#terms`）。營運者或聯絡信箱改變時，請在這裡修改。
- **相同或類似的陳情**：AI 或伺服器（30 分鐘內內容相同）可能找到重複的陳情。這時網站提供三個選擇：
  - 「補充到 #N」：網站把你的描述和照片加到那件案件，並幫它 +1。局處後台可在補充旁查看你的聯絡資料。
  - 「只幫 #N 按 +1」：不會保存聯絡資料。
  - 送出新案件。如果內容完全相同，這個選項會改成「修改內容」。

  補充或 +1 後，網站會在公開案件列表中開啟該案件。網站把每則補充存在 `addenda/<訪客 ID>`。
- **我的陳情與參與**：「我的陳情」分為「我送出」與「我參與」。其他市民的公開案件，只要你目前有按 +1 或曾提交補充，就會出現在「我參與」；取消 +1 且沒有補充紀錄時，案件會離開該清單。兩個清單都包含未完成與已修復案件，有更新的在前，其餘依最近異動排序。自己送出的案件被管理者隱藏時，頁面會說明；不公開案件的內容不會出現在這兩個清單。
- **有新進度提示**：案件的狀態、分派局處、修繕紀錄或補充在上次閱讀後改變時，會顯示「有新進度」；票數變動不會觸發。首次完整載入時會建立基準，既有案件不會全部標新。展開的案件詳情進入可視區後，提示才會清除。已讀狀態依訪客保留在這個瀏覽器，不會跨裝置，也不寄 Email；瀏覽器儲存不可用時，只在本次頁面保留。
- **白話進度卡**：市民案件詳情顯示示範進度卡，列出目前狀態、負責單位、最近一次處理動作與日期。市民補充分開顯示，不會重置處理日期。沒有後續處理紀錄時會直接說明，不推算完工日期。市民畫面以白話中文顯示尚未完成、修繕單已完成，以及超過 7 天沒有處理進度；局處後台保留原有用語。
- **補充與草稿**：你可以在自己的案件新增文字和最多 3 張照片，每件案件最多 10 則補充。撰寫補充時若案件轉為不公開，網站會把文字保留在列表上方。
- **定位**：使用 GPS、在小地圖拖曳大頭針，或在地圖上長按約一秒。在電腦上，對地圖按右鍵。確認地址後才開啟通報表單。
- **AI 分類與局處建議（taipei-bot）**：Claude 建議負責局處、1999 官方分類（9 大類、136 子類）與行政區。它也會找出重複的陳情、台北市以外的地點、內容不清楚的陳情與垃圾訊息。
- **個資遮蔽**：送出陳情或補充前，網站會遮蔽台灣電話、Email 與身分證字號。聯絡資料欄位不遮蔽。瀏覽器會把每張照片縮小並重新編碼，這樣會移除 EXIF 資料與拍攝位置。
- **地圖**：地圖依 1999 九大類各分一個圖層。新通報會立即出現（WebSocket）。地圖下方的 **Live** 顯示今天最新的陳情。陳情資料載入失敗時，地圖會顯示連線中斷與重新整理按鈕。陳情圖標與行政區都可用 Tab 聚焦。
- **行政區地圖**：網站一開啟就進入地圖。主地圖以平面色塊顯示 12 個行政區。點擊行政區會拉近到該區，按 **← 全市** 回到全市。界線檔載入失敗時，改顯示街道底圖。
- **里**：點進行政區後，地圖畫出該區各里，側欄列出有未完成陳情的里，件數多的在前。陳情依座標落在哪個里來歸屬。
- **里的詳細頁**：點一個里會顯示該里頁面。**聯絡窗口**列出里長與該選區的市議員，附 **撥打** 按鈕與黨徽。**重大事件**列出該里的陳情。**回報這個里的問題**會開啟通報表單，並帶入該里內的位置。資料來自 `data/li-contacts.json` 與 `data/councilors.json`。
- **陳情彈窗**：點陳情圖標會開啟彈窗。圖示表示陳情屬於食、住、行、育、樂、醫哪一類。地址連結會在 Google 地圖開啟該位置。**看詳情** 會開啟案件。手機上彈窗會留在地圖內。
- **行政區頁**：行政區側欄有 7 個按鈕：**全部**，以及食、住、行、育、樂、醫各一個圖示。按下圖示，地圖、清單、里別統計與里頁面只顯示該類陳情。「其他」類只在 **全部** 顯示。**熱門陳情**列出該區 +1 最多的 5 件未完成陳情。
- **加入（共同陳情）**：熱門陳情每一列都有 **加入** 按鈕，會以加入模式開啟通報表單。**補充到 #N** 不送 AI 分類，直接把文字與照片補充到那件案件，並幫它 +1。**只按 +1** 只會 +1。**改為新案件** 會把表單改回新通報。
- **陳情圖標**：每件陳情是一個地標圖示，顏色對應 1999 大類；+1 越多圖示越高，已修復的會變淡。全市地圖一開始所有圖層都不勾選，按 **全選**／**全不選** 一次開關全部圖層。點進行政區後，該區所有陳情都會顯示。
- **歷史派工時間軸**：時間軸顯示 2026 年 1 月到 9 月共 128,640 件真實 1999 派工。可以一次看一天，也可以依序播放。每個點位只到路段，不顯示門牌。
- **照片**：點照片會在燈箱中放大。案件詳情另有一張唯讀小地圖，按 **在地圖上開啟** 會切到主地圖的案件位置。照片無法加入時，錯誤會顯示在照片選擇區旁。
- **深色／淺色模式**：用頁首的按鈕切換。一開始網站跟隨系統設定，瀏覽器會記住你的選擇。
- **鍵盤與多分頁**：整個網站都能用鍵盤與螢幕閱讀器操作。按 `c` 開啟通報表單。即時更新與其他分頁不會清掉你的草稿或 +1。連續點兩下 +1 只算一票。從案件按「上一頁」會回到列表，搜尋仍在。網路中斷時會顯示橫幅。即時更新或篩選讓展開中的案件離開列表時，詳情會收起，並說明原因。
- **案件編號**：Worker 建立案件時會配發永久編號。市民與工作人員看到同一個編號。案件編號與 PR 編號不會重複。
- **案件分享連結**：每件案件都有依資料 ID 建立的穩定連結，會在正確的列表中開啟案件。瀏覽器不允許自動複製時，可以手動複製案件詳情中顯示的連結。
- **局處篩選件數**：局處下拉選單顯示各局處在目前分頁、搜尋與里程碑條件下的件數。
- **搜尋**：搜尋欄可用案件編號（`57`、`#57` 或 `＃57`）、標題、內容、標籤或行政區尋找案件。使用中文輸入法組字時，列表會保留目前結果。
- **相對時間**：只顯示完整經過的分鐘、小時或天數，例如 90 分鐘顯示 1 小時。
- **長字串**：比可用寬度更長的單字或網址會在任何字元換行，不會超出頁面。
- **瀏覽器身分**：Worker 網站會在這個瀏覽器保留訪客身分，並在每次載入頁面時確認。瀏覽器無法保留身分時，網站維持唯讀；允許網站儲存資料並重新整理後即可通報。
- **跑馬燈**：頁面底部顯示 Bing News 與 PTT Taipei 板的台北新聞，以及人工挑選的 Threads 貼文；每日排程會存一份新聞快照，兩來源都失敗時跑馬燈改用此快照。暫停按鈕可停止跑馬燈，瀏覽器會記住你的選擇。

**局處管理者**（示範模式，不需驗證：點頁面底部的 **局處後台（示範，免驗證）**，或在網址加上 `?admin`；點 **回到市民畫面** 或加上 `?citizen` 回到市民畫面。任何拿到網址的人都能使用全部管理功能，包含通報者姓名與電話，只能放模擬資料。）

- **後台**：後台顯示今日通報、未結案件、待審核、待分派與逾期案件。三個待辦佇列可以放行、隱藏、改派，或把案件設為「處理中」或「已修復」。每個佇列先顯示 20 筆，按 **顯示更多** 可看到其餘案件。
- **數字一致**：Open 分頁的數字與後台的「未結案件」相同，兩者都包含隱藏或待審的案件；隱藏案件不會進入待辦佇列。
- **手機與長字串**：手機上目前的後台分頁會保持在畫面內。長聯絡資料會在案件詳情內換行。
- **案件操作**：開修繕單（PR）、Merge 以結案、改派局處、設定里程碑，以及查看市民的聯絡資料。
- **修繕單回饋**：修繕單標題最多 80 字。建立或合併修繕單後，頁面會顯示提示。
- **Releases**：AI 草擬每週結案摘要。版本號採 v<年>.<週>（例如 v2026.43）。已隱藏的案件不會出現在公開摘要中，發布後才隱藏也一樣。另有 2026 年 1 月到 9 月的 1999 派工月報。
- **Insights**：網站顯示各局處的 SLA（平均修復天數）。局處超過門檻時，網站顯示「failing」。
- **展示工具**：儲存與重設展示快照。彩排後按一下就能還原資料。
- **重設模擬資料**（只在 Worker 網站）：把整個資料庫還原成 `worker/data.json` 的種子資料，會刪掉所有市民陳情、補充、+1、聯絡資料與展示快照。10 秒內按兩次才會執行。已上傳的照片仍留在 R2。

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
  ├─ /api/news ───────── Bing News RSS、PTT Taipei 板（快取 10 分鐘；兩來源都失敗時改用每日快照）
  ├─ cron 01:00 UTC ─── 每日：在 Hub 存一份新聞快照（保留 2 天）
  ├─ /api/photo ──────── R2 bucket `taipei-issue-photos`
  ├─ /api/contact ────── 市民姓名、手機與 Email（DO 私有資料表，後台可讀，示範站後台免驗證）
  ├─ /api/mine ───────── 僅案件作者：被管理者隱藏的陳情件數（需簽章訪客權杖）
  ├─ /api/reset ──────── 僅管理者：把資料庫還原成 worker/data.json
  └─ /api/visitor ────── 簽發訪客 ID（HMAC 簽章）
```

同一份 `taipei-issues.html` 也能當成 claude.ai artifact 執行。`worker/build.mjs` 會在頁面前面放一小段轉接程式，把 `window.claude` 接到上面的 Worker API。

**安全與限制**

- 訪客只能寫自己的陳情與 +1（`reports/<id>`、`votes/<id>`）。Worker 用簽章檢查身分。示範模式下，任何帶 `x-admin` 標頭的請求都是管理者，不檢查 token。
- 訪客取得的資料快照與即時更新只包含公開案件。已隱藏或待審核的案件不會出現在訪客的資料中。管理者會收到全部案件；管理者的即時連線以 `?admin` 開啟。 只有管理者看得到的展示快照也不會出現在訪客資料中。
- 示範模式的管理者不需 token，所以管理者的寫入、聯絡資料儲存與照片上傳，每個 IP 每分鐘最多 120 次，單一文件最大 256 KB。
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
| `check.mjs` | 前端邏輯檢查：個資遮蔽、資料清理、台北市界、範本、照片 key、食住行育樂醫分類 |
| `worker/` | Cloudflare Worker：`src/index.js`（路由）、`src/hub.js`（Durable Object）、`build.mjs`、`data.json`（種子資料）、`test/`（`test/browser.mjs` 執行瀏覽器測試） |
| `.github/workflows/ci.yml` | GitHub Actions CI：前端與結構化資料檢查、Worker API 測試與瀏覽器回歸測試 |
| `data/1999-categories.json` | 1999 官方案件分類（9 大類、136 子類） |
| `data/history-2026.json` | 2026 年 1 月到 9 月的 1999 派工（路段層級） |
| `data/history-roads.json` | 路段座標快取 |
| `data/districts.geojson`、`data/li.geojson` | 12 個行政區與 456 個里的界線（WGS84） |
| `data/li-contacts.json`、`data/councilors.json` | 各里里長與各選區市議員，只放辦公室電話。由 `scripts/fill-contacts.mjs` 從 `data/offices.json` 產生。 |
| `data/offices.json` | 市議員與 456 里辦公處資料。Hub 啟動時載入，不傳給前端。 |
| `scripts/` | 資料腳本，請參閱下表 |
| `deck/` | 簡報與產品截圖 |
| `docs/og.jpg` | 社群分享縮圖（1200 × 630），以 GPT Image 產生。`worker/build.mjs` 會把它複製到網站，並加上 `og:` 與 `twitter:` 標籤。 |
| `docs/screens/` | 本說明文件用的網站截圖 |
| `promo/` | 兩支用真實 1999 資料畫出的影片：`compose.html`（30 秒，9:16）與 `intro.html`（59 秒，16:9）。輸出放在 `promo/out/`（不放進 git）。 |
| `DEMO.md`、`SCRIPT.md` | 展示流程與口說文字稿 |
| `PLAN.md` | 各階段任務與驗收紀錄 |

| 腳本 | 用途 |
|---|---|
| `scripts/fetch-1999-history.mjs` | 下載 data.taipei 的 1999 派工 CSV，取出路段、查詢座標，並產生 `data/history-2026.json` |
| `scripts/build-li.mjs` | 下載 data.taipei 的臺北市里界圖（TWD97 shapefile），轉成 WGS84 並簡化，產生 `data/li.geojson` 與 `data/districts.geojson`。需要 `unzip`。 |
| `scripts/fetch-offices.mjs` | 抓臺北市議會「現任議員」與 12 區公所「里辦公處一覽表」，產生 `data/offices.json`（重跑即更新；檔內日期變了 Hub 才重載） |
| `scripts/fill-contacts.mjs` | 把 `data/offices.json` 的里長姓名、里辦公處電話與議員複製到 `data/li-contacts.json` 與 `data/councilors.json`。在 `fetch-offices.mjs` 之後執行。 |
| `scripts/history-releases.mjs` | 由歷史資料產生每月派工報告（`--write` 寫入線上資料庫） |
| `scripts/enrich-seed.mjs` | 幫示範案件加上 1999 分類與座標 |
| `scripts/codex-proxy.mjs` | 只用於本機開發：把 AI 分類請求轉給 Codex CLI |
| `scripts/demo-photos.mjs` | 把生成的示範照片轉成 JPEG、上傳到 R2，並加進示範資料。JPEG 超過 650 KB 時，腳本會降低品質重做。50 筆示範案件都有照片。 |
| `promo/render.mjs` | 產生影片：`node promo/render.mjs promo` 或 `node promo/render.mjs intro`。需要全域安裝的 Playwright（含 Chromium）、支援 libx264 的 ffmpeg 與繁體中文字型。其他選項見腳本開頭說明。 |

## 本機開發

需要 Node.js 22 以上版本與 Wrangler（`npm install -g wrangler`）。

建立 `worker/.dev.vars` 檔案。不要把這個檔案放進 git。

```
VISITOR_SECRET=<一段夠長的隨機字串>
ANTHROPIC_API_KEY=<選填；留空時 AI 分類設為「1999 待分派」>
AI_PROXY_URL=<選填；本機改用 Codex CLI 分類：http://127.0.0.1:8799>
```

本機要改用 Codex CLI 做 AI 分類（不需 Claude API key）時，先啟動代理，再設定 `AI_PROXY_URL=http://127.0.0.1:8799`。代理對每次請求執行一次 `codex exec`，預設模型是 `gpt-6-luna`，可用 `CODEX_MODEL` 更換。代理只在本機使用。

```bash
node scripts/codex-proxy.mjs
```

啟動本機 Worker，開啟 <http://localhost:8788>；管理者模式為 `http://localhost:8788/?admin`。

```bash
cd worker && npx wrangler dev --port 8788
```

### 測試

以下檢查不需要伺服器：

```bash
node check.mjs
for t in relative-time sync visitor votes; do node worker/test/$t.mjs; done
node worker/test/structured-data.mjs
```

Worker API 測試從 `BASE` 讀取 Worker 網址，清單在 `.github/workflows/ci.yml`。例如：

```bash
BASE=http://localhost:8788 node worker/test/smoke.mjs
```

瀏覽器測試需要 Playwright 與 Chromium。請安裝與 CI 相同的版本；在 Linux 上加 `--with-deps` 一併安裝系統函式庫。

```bash
npm install -g playwright@1.64.1
playwright install chromium
```

`worker/test/browser.mjs` 為每支測試在 8877 埠啟動一個空狀態的新本機 Worker。請先停掉佔用 8877 埠的 Worker，或設定 `BROWSER_TEST_PORT`。在指令後加測試檔名，可只跑那些測試。要用已安裝的 Chrome，請設定 `CHROME_EXECUTABLE_PATH`。

```bash
PLAYWRIGHT_MODULE="$(npm root -g)/playwright" node worker/test/browser.mjs
```

runner 暫時不跑 `map-long-press.mjs`，等它的歷史段落改寫：那段仍以時間軸 canvas 為目標，而時間軸現在改用圖釘。指定檔名仍可執行。

GitHub Actions 會在每個 pull request 與每次 push 到 `master` 時執行 CI（`.github/workflows/ci.yml`）。一個 job 執行上面的檢查，並對 8877 埠的本機 Worker 執行 Worker API 測試；另一個 job 以四個平行分片執行 `browser.mjs`（`--shard=<n>/4`）。

## 部署

```bash
cd worker && npx wrangler deploy
```

正式環境需要兩個 secret。用 `wrangler secret put <名稱>` 設定每一個：`VISITOR_SECRET`、`ANTHROPIC_API_KEY`。Worker 不再使用 `ADMIN_TOKEN`，可用 `wrangler secret delete ADMIN_TOKEN` 刪除。另外也需要 R2 bucket `taipei-issue-photos`。

注意：線上資料庫只在第一次啟動時載入 `worker/data.json`。之後如果修改種子資料，要用管理者權限寫入，或在局處後台按 **重設模擬資料**。請使用腳本的 `--write` 選項，或 `ADMIN` 與 `BASE` 環境變數。

## 資料來源

| 資料 | 來源 |
|---|---|
| 1999 派工（2026 年 1 月到 9 月） | [臺北市政府資料開放平台](https://data.taipei/dataset/detail?id=b796f87a-0ed8-4e57-89f6-225a4941b1ed)。原始資料只有立案日期，沒有結案狀態。 |
| 行政區與里界 | [臺北市里界圖](https://data.taipei/dataset/detail?id=6b17b31d-4e16-495e-95b1-9fd1f47c80d8)，臺北市政府民政局。行政區界由所屬各里合併而成。 |
| 1999 案件分類 | [臺北市 1999 市民當家熱線](https://1999.gov.taipei/) |
| 底圖 | 內政部國土測繪中心臺灣通用電子地圖 |
| 地址與座標 | © OpenStreetMap contributors（Nominatim） |
| 行政區界 | © OpenStreetMap contributors（行政區 relation，經 Nominatim 簡化至約 30 公尺） |
| 跑馬燈 | Bing News、PTT Taipei 板 |
| 示範照片 | GPT Image 生成，不是真實現場 |
| 政黨黨徽 | Wikimedia Commons（國民黨、民眾黨、新黨、社民黨：公有領域）與中文維基百科（民進黨：合理使用），僅用於標示議員所屬政黨 |

## 已知限制

- 管理者模式只在用 `?admin` 開啟的那個瀏覽器分頁有效。
- 不支援 Web Locks 的瀏覽器，首次同時開兩個分頁時仍可能產生不同訪客身分。「我的陳情」綁定這個瀏覽器保留的身分。
- Worker 網站以原子操作建立案件與追加補充；claude.ai artifact 保留原有資料庫更新方式，不具備這些伺服器保證。
- 兩位管理者同時修改同一件案件時，其中一方的修改可能被覆蓋。
- AI 分類與個資遮蔽在瀏覽器執行。Worker 會檢查提示的開頭與長度上限。
- 上傳了照片卻沒有送出陳情時，照片會留在 R2，系統不會自動刪除。
- 每個歷史點位只到路段。約 6% 的案件找不到路段，這些點位放在行政區中心附近。
