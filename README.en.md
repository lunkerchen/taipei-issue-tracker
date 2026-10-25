# Taipei Issue Tracker

[繁體中文](README.md) | English

![台北市，你給我聽好了｜市民 1999 通報地圖](docs/og.jpg)

<!-- Written in ASD-STE100 Simplified Technical English. README.md is the Traditional Chinese translation of this file. -->

This website shows Taipei City as a GitHub repository. A 1999 citizen report is an issue. A repair by a city department is a pull request. Each monthly dispatch summary is a release.

This is a 1999 quick-report website for mobile phones. A citizen sends a report. AI sorts the report and sends it to the correct department. The report shows on the map immediately. The website title is 「台北市，你給我聽好了｜市民 1999 通報地圖」.

- Live website: <https://taipei-issue-tracker.labanchen.workers.dev>
- Admin console (demo, no verification): <https://taipei-issue-tracker.labanchen.workers.dev/?admin>
- Hackathon topic: [puma.taipei/hackathon](https://puma.taipei/hackathon), "the city bug that you see"

> The reports, repair orders and +1 votes on the website are **simulated data**. They are not real cases of the Taipei City Government. The map timeline and the monthly dispatch reports use real 1999 dispatch data from data.taipei. Refer to "Data sources".

## Screenshots

These screenshots show the live website on 2026-10-24 (light mode, simulated data).

| | |
|---|---|
| ![District map](docs/screens/map.png)<br>**Map**: the 12 districts and the 1999 category layers | ![District and villages](docs/screens/district.png)<br>**District**: the villages and the villages with unfinished reports |
| ![Village page](docs/screens/village.png)<br>**Village page**: the village chief, the councillors and the reports | ![Report form](docs/screens/report.png)<br>**Quick report**: general areas, templates, voice, photos and location |
| ![Issue list](docs/screens/issues.png)<br>**Issues**: the contribution graph, filters and +1 votes | ![Issue details](docs/screens/issue-detail.png)<br>**Case details**: photos, location and a small map |
| ![Pull requests](docs/screens/pulls.png)<br>**Pull requests**: repair orders from departments | ![Milestones](docs/screens/milestones.png)<br>**Milestones**: city plans and budgets |
| ![Insights](docs/screens/insights.png)<br>**Insights**: the SLA for each department | ![Releases](docs/screens/releases.png)<br>**Releases**: the weekly summaries of closed cases |

<img src="docs/screens/mobile-map.png" alt="Map on a mobile phone" width="260"><br>**Mobile phone**: the map and the bottom navigation bar

## Functions

**Citizens (mobile phone first)**

- **Quick report**: Select a general area first: food, home, transport, education, leisure or health. This step is optional. Then write the problem, or use one of the 33 templates. You can use voice input in Chinese. You can attach a maximum of 3 photos.
- **Contact data**: Your name, mobile number and email address are necessary. The citizen pages do not show them. But the demo admin console needs no verification, so anyone can read them. Thus, do not enter real personal data. The website does not send email or text message notices yet. If the report is about a person or a business, you can select "real-name report".
- **Report fields**: The Worker accepts a new case only if it has a title of 1 to 200 characters, a body of 1 to 2000 characters, and tags as a list of strings. It refuses other items with `bad_item`.
- **Phones and keyboards**: The fixed news ticker and the bottom navigation do not cover the control that has keyboard focus. A larger phone text size does not make the page wider. A form error shows below its field.
- **Keyboard focus after actions**: After you add a note, or after an administrator changes a case, focus stays on the same form, control or case title.
- **Preview before you send**: AI sorts the report. The website then shows the title, the department, the 1999 category, the district, the location and the reason. The website makes the case only after you push "Confirm and send". If you change the form, you must make a new preview. If a send fails, the form keeps the draft. A retry uses the same case ID. If AI sorting is not available, the title is the first 40 characters of your text.
- **Privacy notice, terms and not-official statement**: This website is not a Taipei City Government website. It does not send reports to 1999 or to city departments. For an emergency, call 110 or 119. Before you send a report, you must agree to the privacy notice and the terms of use. The two documents are `<dialog>` elements in `taipei-issues.html` (`#privacy`, `#terms`). If the operator or the contact email changes, change them there.
- **Same or similar reports**: AI or the server (same text in the last 30 minutes) can find a possible duplicate. The website then gives you three choices:
  - "Add to #N": The website adds your text and photos to that case and gives it +1. The admin console shows your contact data next to the addition.
  - "Only +1 for #N". This choice does not save your contact data.
  - Send a new case. If the text is exactly the same, this choice changes to "Change the text".

  After an addition or a +1, the website opens that case in the public case list. The website keeps each addition in `addenda/<visitor ID>`.
- **My reports and additions**: "My reports" shows the cases that you sent. It tells you if an administrator hid a case. You can add text and a maximum of 3 photos to your own case. Each case can have a maximum of 10 additions. If the case becomes private while you write, the website keeps your text above the list.
- **Location**: Use GPS, move the pin on the small map, or push and hold on the map for about one second. On a computer, right-click the map. The report form opens after you confirm the address.
- **AI dispatch (taipei-bot)**: Claude finds the department, the official 1999 category (9 main categories, 136 subcategories) and the district. It also finds duplicate reports, locations outside Taipei, text that is not clear, and spam.
- **Personal data mask**: Before the website sends a report or an addition, it hides Taiwan telephone numbers, email addresses and ID numbers. The mask does not apply to the contact fields. The browser makes each photo smaller and encodes it again. This removes EXIF data and the photo location.
- **Map**: The map has one layer for each of the 9 main 1999 categories. New reports show immediately (WebSocket). Below the map, **Live** shows the newest reports of today. If report data cannot load, the map shows a connection error and a reload button. You can reach each report pin and district with Tab.
- **District map**: The website opens on the map. The main map shows the 12 districts as flat colour areas. Click a district to zoom in. **← 全市** goes back to the full city. If the boundary file cannot load, the map shows the street basemap.
- **Villages (里)**: When you open a district, the map shows its villages. The side panel lists the villages that have unfinished reports, most reports first. A report belongs to the village that contains its point.
- **Village page**: Click a village to see its page. **聯絡窗口** shows the village chief and the city councillors of the election zone, with a **撥打** (call) button and the party emblem. **重大事件** lists the reports in the village. **回報這個里的問題** opens the report form with a point in the village. The data comes from `data/li-contacts.json` and `data/councilors.json`.
- **Report pop-up**: Click a pin to open a pop-up. An icon shows the area of daily life of the report (食 food, 住 home, 行 transport, 育 education, 樂 leisure, 醫 health). The address opens the location in Google Maps. **看詳情** opens the case. On a phone, the pop-up stays inside the map.
- **District page**: The side panel of a district has 7 buttons: **全部** and one icon for each area of daily life. An icon limits the map, the list, the village counts and the village pages to that area. Reports in 「其他」 show only with **全部**. **熱門陳情** shows the 5 unfinished reports in the district that have the most +1 votes.
- **加入 (join a report)**: Each 熱門陳情 row has a **加入** button. It opens the report form in join mode. **補充到 #N** adds your text and photos to that case and gives it +1. AI does not sort this text. **只按 +1** gives +1 only. **改為新案件** changes the form back to a new report.
- **Report pins**: Each report is a map pin in the colour of its 1999 category. More +1 votes make the pin taller. Fixed reports are faded. On the full city map, all layers are off at the start. **全選** / **全不選** turns all layers on or off. When you open a district, all reports in that district show.
- **Dispatch history timeline**: The timeline shows 128,640 real 1999 dispatches from January to September 2026. You can look at one day at a time or play the days in sequence. Each point shows only the road section. It does not show the house number.
- **Photos**: Click a photo to make it larger in a lightbox. The case details also show a small read-only map. **在地圖上開啟** opens the main map at the case point. If a photo cannot be added, the error shows next to the photo picker.
- **Dark and light mode**: Use the button in the header to change the mode. Initially, the website uses the system setting. The browser keeps your selection.
- **Keyboard and multiple tabs**: You can use the website with a keyboard and a screen reader. The `c` key opens the report form. Live updates and other tabs do not remove your drafts or your +1 votes. A double tap on +1 adds one vote. Back returns from a case to the list, and the search stays. When the network drops, a banner shows. If a live update or a filter removes an open case from the list, the detail closes and a message tells you why.
- **Case numbers**: The Worker gives each case a permanent number when it creates the case. Citizens and staff see the same number. Case numbers and PR numbers never have the same value.
- **Case links**: Each case has a stable link from its data ID. The link opens the case in the correct list. If clipboard access fails, copy the link shown in the case details.
- **Department filter counts**: The department list shows the number of cases for each department under the current tab, search and milestone.
- **Search**: The search field finds a case by number (`57`, `#57` or `＃57`), title, text, tags or district. While you type with an input method editor, the list keeps the current result.
- **Relative time**: Times show the full minutes, hours or days that passed. For example, 90 minutes shows 1 hour.
- **Long text**: A word or URL that is longer than the available width wraps at any character. The text stays inside the page.
- **Browser identity**: The Worker site keeps your visitor identity in this browser. It confirms the identity on each page load. If the browser cannot keep the identity, the site stays read-only. Allow site storage and reload to send reports.
- **News ticker**: The bottom of the page shows Taipei news from Bing News and the PTT Taipei board, and selected Threads posts. A daily cron job saves a snapshot of both feeds; the ticker uses it when both sources are down. A pause button stops the ticker. The browser keeps your selection.

**Department administrators** (demo mode, no verification: click **局處後台（示範，免驗證）** at the bottom of the page, or add `?admin` to the URL. **回到市民畫面** or `?citizen` goes back. Anyone with the link can use all administrator functions, including the reporters' names and phone numbers. Use only simulated data.)

- **Back office**: The back office shows the reports of today, open cases, cases for review, cases without a department, and late cases. Three work queues let you approve, hide, send to a different department, or set a case to "in progress" or "fixed". Each queue shows 20 cases. **顯示更多** shows the other cases.
- **Counts**: The number in the Open tab and the 未結案件 number in the back office are the same. Both include hidden and flagged cases. Hidden cases stay out of the work queues.
- **Phones and long text**: On a phone, the active admin tab stays in view. Long contact data wraps inside the case details.
- **Case operations**: Make a repair order (PR). Merge it to close the case. Send the case to a different department. Set a milestone. Read the contact data of the citizen.
- **Repair order feedback**: A repair order title has a maximum of 80 characters. After you make or merge a repair order, the page shows a message.
- **Releases**: AI writes a draft of the weekly summary of closed cases. The tag is v<year>.<week> (for example v2026.43). Hidden cases stay out of the public summary, also after the release. There are also monthly 1999 dispatch reports for January to September 2026.
- **Insights**: The website shows the SLA (average number of days to repair) for each department. If a department is more than the limit, the website shows "failing".
- **Demo tools**: Save and reset a demo snapshot. After a rehearsal, one push sets the data back.
- **Reset demo data** (重設模擬資料, Worker website only): Puts the full database back to the seed data in `worker/data.json`. It removes all citizen reports, additions, +1 votes, contact data and demo snapshots. Push the button two times in 10 seconds. Uploaded photos stay in R2.

## Architecture

```
Browser (taipei-issues.html)
  │  window.claude interface: db / user / sample / geocode / news / history / photo / contact
  ▼
Cloudflare Worker (worker/src/index.js)
  ├─ Static page (worker/public/, made by build.mjs)
  ├─ /api/db, /api/ws ── Hub Durable Object (SQLite): shared database and live updates
  ├─ /api/sample ─────── Claude API (Haiku for sorting, Sonnet for releases)
  ├─ /api/geocode ────── OpenStreetMap Nominatim (address to point and point to address, cache 7 days)
  ├─ /api/news ───────── Bing News RSS, PTT Taipei board (cache 10 minutes; falls back to the daily snapshot when both are down)
  ├─ cron 01:00 UTC ─── Daily: saves a news snapshot in the Hub (kept 2 days)
  ├─ /api/photo ──────── R2 bucket `taipei-issue-photos`
  ├─ /api/contact ────── Name, mobile number and email address of the citizen (private DO table, the admin console can read it; the demo admin console needs no verification)
  ├─ /api/mine ───────── Owner only: the number of your cases that an administrator hid (signed visitor token)
  ├─ /api/reset ──────── Administrator only: puts the database back to worker/data.json
  └─ /api/visitor ────── Gives a visitor ID (HMAC signature)
```

The same `taipei-issues.html` page can also operate as a claude.ai artifact. `worker/build.mjs` puts a small adapter script before the page. This script connects `window.claude` to the Worker API above.

**Security and limits**

- A visitor can write only their own reports and +1 votes (`reports/<id>`, `votes/<id>`). The Worker checks the identity with a signature. Demo mode: any request with an `x-admin` header is an administrator request. No token is checked.
- Visitors receive only public cases in the database snapshot and in live updates. A hidden case or a case that waits for approval is not in the visitor data. The administrator receives all cases. The administrator live socket opens with `?admin`. The admin-only demo snapshot is also not in visitor data.
- Because the demo administrator needs no token, administrator writes, contact saves and photo uploads are limited to 120 per minute for each IP address, and an administrator document can be at most 256 KB.
- Protection against a flood of reports. The server examines each new report:
  - Each request can add only one report.
  - The creation time must be the current time. A report with an earlier time is not accepted.
  - Each visitor can send a maximum of 3 reports in 10 minutes and 10 reports in one day.
  - One IP address can send a maximum of 60 reports in 10 minutes. This permits many persons on one Wi-Fi network at an event.
  - If the text is the same as a different report from the last 30 minutes, the server stops the report. Spaces and punctuation are not compared. The website then tells you to give +1.
  - These limits do not apply to the administrator.
- Rate limits: AI, 10 requests for each IP address in one minute. Writes, 20 for each visitor in one minute. Photos, 10 for each visitor in one minute. New visitor IDs, 150 for each IP address in one minute.
- Photos: The server accepts only a standard baseline JPEG of 700 KB or less. The server removes the metadata again. Each photo response uses `image/jpeg`, `nosniff` and CSP `default-src 'none'`.
- All external requests have a timeout and a retry limit.

## Directories

| Path | Contents |
|---|---|
| `taipei-issues.html` | All of the front end (one file) |
| `check.mjs` | Front-end logic checks: personal data mask, data cleanup, Taipei boundary, templates, photo keys, area of daily life |
| `worker/` | Cloudflare Worker: `src/index.js` (routes), `src/hub.js` (Durable Object), `build.mjs`, `data.json` (seed data), `test/` (`test/browser.mjs` runs the browser tests) |
| `.github/workflows/ci.yml` | GitHub Actions CI: front-end checks, Worker API tests and browser regression tests |
| `data/1999-categories.json` | Official 1999 case categories (9 main categories, 136 subcategories) |
| `data/history-2026.json` | 1999 dispatches from January to September 2026 (road section level) |
| `data/history-roads.json` | Cache of road coordinates |
| `data/districts.geojson`, `data/li.geojson` | Boundaries of the 12 districts and the 456 villages (里), WGS84 |
| `data/li-contacts.json`, `data/councilors.json` | Village chiefs, and councillors for each election zone. Office phone numbers only. `scripts/fill-contacts.mjs` makes them from `data/offices.json`. |
| `data/offices.json` | Councillors and the 456 village offices. The Hub loads it at start. It is not sent to the page. |
| `scripts/` | Data scripts. Refer to the table below. |
| `deck/` | Slides and product screenshots |
| `docs/og.jpg` | Share card (1200 × 630) for links on social media. Made with GPT Image. `worker/build.mjs` copies it to the site and adds the `og:` and `twitter:` tags. |
| `docs/screens/` | Screenshots of the website for this README |
| `promo/` | Two videos drawn from the real 1999 data: `compose.html` (30 seconds, 9:16) and `intro.html` (59 seconds, 16:9). The output goes to `promo/out/` (not in git). |
| `DEMO.md`, `SCRIPT.md` | Demo procedure and speaker script |
| `PLAN.md` | Tasks and acceptance records for each phase |

| Script | Purpose |
|---|---|
| `scripts/fetch-1999-history.mjs` | Downloads the data.taipei 1999 dispatch CSV files, gets the road sections, finds the coordinates, and makes `data/history-2026.json` |
| `scripts/build-li.mjs` | Downloads the data.taipei village boundary map (TWD97 shapefile), changes it to WGS84, simplifies it, and makes `data/li.geojson` and `data/districts.geojson`. Needs `unzip`. |
| `scripts/fetch-offices.mjs` | Gets the current councillors from the Taipei City Council website and the village office lists from the 12 district offices, and makes `data/offices.json`. Run it again to update. The Hub loads the file again only when the date in the file changes. |
| `scripts/fill-contacts.mjs` | Copies the village chief names, the village office phones and the councillors from `data/offices.json` into `data/li-contacts.json` and `data/councilors.json`. Run it after `fetch-offices.mjs`. |
| `scripts/history-releases.mjs` | Makes the monthly dispatch reports from the history data (`--write` writes them to the live database) |
| `scripts/enrich-seed.mjs` | Adds 1999 categories and coordinates to the demo cases |
| `scripts/codex-proxy.mjs` | Local development only: sends AI sorting requests to Codex CLI |
| `scripts/demo-photos.mjs` | Changes the generated demo photos to JPEG, uploads them to R2, and adds them to the demo data. If a JPEG is larger than 650 KB, the script uses a lower quality. All 50 demo cases have a photo. |
| `promo/render.mjs` | Makes a video: `node promo/render.mjs promo` or `node promo/render.mjs intro`. Needs a global Playwright install with Chromium, ffmpeg with libx264, and a Traditional Chinese font. The top of the script shows the other options. |

## Local development

You must have Node.js 22 or later and Wrangler (`npm install -g wrangler`).

Make the file `worker/.dev.vars`. Do not put this file in git.

```
VISITOR_SECRET=<a long random string>
ANTHROPIC_API_KEY=<optional; if it is empty, AI sorting sets "1999 待分派">
AI_PROXY_URL=<optional; use Codex CLI for local sorting: http://127.0.0.1:8799>
```

To sort with Codex CLI instead of the Claude API, start the proxy and set `AI_PROXY_URL=http://127.0.0.1:8799`. The proxy runs `codex exec` one time for each request. The default model is `gpt-6-luna`. Set `CODEX_MODEL` to use a different model. Use the proxy only on a local computer.

```bash
node scripts/codex-proxy.mjs
```

Start the local Worker. Open <http://localhost:8788>, or `http://localhost:8788/?admin` for administrator mode.

```bash
cd worker && npx wrangler dev --port 8788
```

### Tests

These checks do not need a server:

```bash
node check.mjs
for t in relative-time sync visitor votes; do node worker/test/$t.mjs; done
```

The Worker API tests use the Worker URL in `BASE`. The list of these tests is in `.github/workflows/ci.yml`. For example:

```bash
BASE=http://localhost:8788 node worker/test/smoke.mjs
```

The browser tests need Playwright and Chromium. Install the same version as CI. On Linux, add `--with-deps` to install the system libraries.

```bash
npm install -g playwright@1.64.1
playwright install chromium
```

`worker/test/browser.mjs` starts a new local Worker with empty state on port 8877 for each test. Stop other Workers on that port, or set `BROWSER_TEST_PORT`. Add test file names to run only those tests. Set `CHROME_EXECUTABLE_PATH` to use an installed Chrome.

```bash
PLAYWRIGHT_MODULE="$(npm root -g)/playwright" node worker/test/browser.mjs
```

The runner leaves out `map-long-press.mjs` until its history section is rewritten: that section still targets the timeline canvas, and the timeline now uses pins. Give the file name to run it anyway.

GitHub Actions runs CI (`.github/workflows/ci.yml`) on each pull request and on each push to `master`. One job runs the checks above and the Worker API tests against a local Worker on port 8877. A second job runs `browser.mjs` in four parallel shards (`--shard=<n>/4`).

## Deployment

```bash
cd worker && npx wrangler deploy
```

The production environment must have two secrets. Set each secret with `wrangler secret put <name>`: `VISITOR_SECRET`, `ANTHROPIC_API_KEY`. The Worker does not use `ADMIN_TOKEN`; you can delete it with `wrangler secret delete ADMIN_TOKEN`. You must also have the R2 bucket `taipei-issue-photos`.

CAUTION: The live database loads `worker/data.json` only at the first start. If you change the seed data after that, write it with administrator access, or push **重設模擬資料** in the admin console. Use the `--write` option of a script, or the `ADMIN` and `BASE` environment variables.

## Data sources

| Data | Source |
|---|---|
| 1999 dispatches (January to September 2026) | [Taipei City Open Data Platform](https://data.taipei/dataset/detail?id=b796f87a-0ed8-4e57-89f6-225a4941b1ed). The source data has only the case date. It does not have the close status. |
| District and village boundaries | [Taipei City Village Boundary Map](https://data.taipei/dataset/detail?id=6b17b31d-4e16-495e-95b1-9fd1f47c80d8), Department of Civil Affairs. The districts are the union of their villages. |
| 1999 case categories | [Taipei 1999 Citizen Hotline](https://1999.gov.taipei/) |
| Base map | Taiwan e-Map, National Land Surveying and Mapping Center |
| Addresses and coordinates | © OpenStreetMap contributors (Nominatim) |
| District boundaries | © OpenStreetMap contributors (district relations, simplified to approximately 30 m by Nominatim) |
| News ticker | Bing News, PTT Taipei board |
| Demo photos | Made by GPT Image. They do not show real locations. |
| Party emblems | Wikimedia Commons (KMT, TPP, New Party, SDP: public domain) and Chinese Wikipedia (DPP: fair use). They identify the party of each councillor only. |

## Known limits

- Administrator mode applies only to the browser tab that you opened with `?admin`.
- Browsers without Web Locks can create different visitor identities if you open two tabs for the first time at the same time. "My reports" is tied to the identity kept by this browser.
- The Worker site makes report creation and note additions atomic. The claude.ai artifact keeps its existing database update method and does not have these server guarantees.
- If two administrators change one case at the same time, one change can replace the other change.
- AI sorting and the personal data mask operate in the browser. The Worker checks the prompt prefix and the length limit.
- If you upload a photo and do not send the report, the photo stays in R2. The system does not remove it automatically.
- Each history point shows only the road section. For approximately 6% of cases, the road section was not found. These points show near the center of the district.
