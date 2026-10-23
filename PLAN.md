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
