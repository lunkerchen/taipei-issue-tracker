# Taipei Issue Tracker

[繁體中文](README.md) | English

<!-- Written in ASD-STE100 Simplified Technical English. README.md is the Traditional Chinese translation of this file. -->

This website shows Taipei City as a GitHub repository. A 1999 citizen report is an issue. A repair by a city department is a pull request. Each monthly dispatch summary is a release.

This is a 1999 quick-report website for mobile phones. A citizen sends a report. AI sorts the report and sends it to the correct department. The report shows on the map immediately.

- Live website: <https://taipei-issue-tracker.labanchen.workers.dev>
- Hackathon topic: [puma.taipei/hackathon](https://puma.taipei/hackathon), "the city bug that you see"

> The reports, repair orders and +1 votes on the website are **simulated data**. They are not real cases of the Taipei City Government. The map timeline and the monthly dispatch reports use real 1999 dispatch data from data.taipei. Refer to "Data sources".

## Functions

**Citizens (mobile phone first)**

- **Quick report**: Select a general area first: food, home, transport, education, leisure or health. This step is optional. Then write the problem. Each general area has 3 to 7 templates (33 templates in total). If you use a template and do not write text after each colon, the website stops the report. You can use voice input in Chinese. The voice button shows only if the browser supports it. You can attach a maximum of 3 photos.
- **Contact data**: Your name and mobile number are necessary. The Worker saves the case and its private contact data together. A refused duplicate or a failed new case does not leave contact data for that attempt. A retry keeps the first saved contact data. The data uses the report author's identity, also when you send a report from an administrator tab. Only the administrator can read it. The website does not show it to the public. If the report is about a person or a business (for example, illegal parking, noise or an illegal building), you can select "real-name report".
- **Preview before you send**: After AI sorts the report, the website shows the title, the department, the 1999 category, the district, the location and the reason. If you select a location, the preview shows its coordinates, with or without an address. The website makes the case only after you push "Confirm and send". If you change the form, you must make a new preview. If a send fails, the form keeps the draft and announces the error to assistive technology. If the draft is unchanged and you have not moved focus, keyboard focus returns to "Preview report". A retry of the same report uses the same case ID.
- **Privacy notice, terms and not-official statement**: The report form and the page footer tell you that this website is not a Taipei City Government website. The website does not send reports to 1999 or to city departments. For an emergency, call 110 or 119. Before you send a report, you must agree to the privacy notice and the terms of use. The privacy notice tells you who collects the data, the purpose, which data is public, the third parties (Anthropic, Cloudflare, OpenStreetMap Nominatim, NLSC), the retention period and your rights under Article 3 of the Personal Data Protection Act. The two documents are `<dialog>` elements in `taipei-issues.html` (`#privacy`, `#terms`). If the operator or the contact email changes, change them there.
- **Same or similar reports**: AI can find a possible duplicate. The server can also find a report with the same text in the last 30 minutes. In these conditions, the website gives you three choices:
  - "Add to #N": The website adds your text and photos to that case and gives it +1. For a retry, the Worker uses the same addition ID and uploaded photo keys. It creates the addition once and keeps the other additions.
  - "Only +1 for #N".
  - Send a new case. If the text is exactly the same, this choice changes to "Change the text".

  After an addition or a +1 succeeds, the site opens the public case list and shows that case.
  While a +1 is saving, the site checks that the report preview is still current. If the visitor changes the draft, cancels the form, or opens a new report, the site keeps the current state and confirms that the +1 was saved.

  The website keeps each addition in `addenda/<visitor ID>` and shows it as "addition from another citizen".
- **My reports and additions**: "My reports" shows the cases that you sent. You can add text and a maximum of 3 photos to your own case. Wait until the photos finish uploading before you send an addition. If an upload fails, the text and uploaded photos stay in the form. Each case can have a maximum of 10 additions. On the Worker site, one write adds each note, so notes sent at the same time stay separate.
- **Location**: Use GPS, move the pin on the small map, or push and hold on the map. On a computer, right-click the map. After you push and hold, the website shows the address and the coordinates. The report form opens only after you confirm. A late GPS result cannot replace a pin that you chose or cleared.
- **AI dispatch (taipei-bot)**: Claude finds the department, the official 1999 category (9 main categories, 136 subcategories) and the district. It also finds duplicate reports, locations outside Taipei, text that is not clear, and spam.
- **Personal data mask**: The website hides Taiwan telephone numbers, including common slash separators and the `+886` and `00886` mobile prefixes, email addresses and ID numbers before it sends a report or an addition. Contact fields stay private. The browser makes each photo smaller and encodes it again. This removes EXIF data and the photo location.
- **Map**: The map has one layer for each of the 9 main 1999 categories. New reports show immediately (WebSocket). Below the map, there are two buttons: **Live** (the newest reports of today) and **Report**.
- **District map**: The website opens on the map, on phones and on computers. The main map shows the 12 districts as flat colour areas, without streets or buildings. Neighbour districts have different colours. Move the pointer on a district to raise it. Click a district to zoom in. **← 全市** goes back to the full city. If the boundary file cannot load (for example in the artifact), the map shows the street basemap.
- **Villages (里)**: When you open a district, the map shows its villages and the side panel lists the villages that have unfinished reports (not fixed), most reports first. A report belongs to the village that contains its point. Click a village on the map or in the list to zoom to it. On a phone, inside a district the map becomes shorter and the village list or village page shows directly below it; the timeline, Live and Report buttons show only on the full city map.
- **Village page**: Click a village to see its page in the side panel. **聯絡窗口** shows the village chief and the city councillors of the election zone, with a **撥打** (call) button when there is a phone number. **重大事件** lists the reports in the village: unfinished first, then most +1. Click a report to open it in the list. **回報這個里的問題** opens the report form with the district and a point in the village. Names and phone numbers come from `data/li-contacts.json` and `data/councilors.json`; empty entries show "資料待補".
- **Report pins**: Each report is a map pin in the colour of its 1999 category. More +1 votes make the pin taller. Fixed reports are faded. On the full city map, all 9 category layers are off at the start, so you see only the districts; **全選** / **全不選** turns all layers on or off. When you open a district, all reports in that district show, whatever the layer settings.
- **Dispatch history timeline**: The timeline shows 128,640 real 1999 dispatches from January to September 2026. You can look at one day at a time or play the days in sequence. If you select history while the map loads, it opens when the map is ready. You can cancel this selection or retry a failed load. Each point shows only the road section. It does not show the house number. The points use the same map pins as the reports. When you open the timeline, all layers are on; when you close it, your layer settings come back.
- **Photos**: The case details and the map pop-up show photos. Click a photo to make it larger in a lightbox. The case details also show a small map with the location.
- **Dark and light mode**: Use the button in the header to change the mode. Initially, the website uses the system setting. The browser keeps your selection. The map colors also change.
- **Keyboard and multiple tabs**: Case details keep the keyboard focus when they open or close. Live updates keep the text and cursor in an addition form. A +1 change updates only that case, so a different tab cannot remove votes for other cases.
- **Case links**: Each case has a stable link from its data ID, not its changing number. The page waits for server-confirmed reports and triage, clears filters, and opens the correct open or fixed list. The copied link has no query parameters. If clipboard access fails, select and copy the link shown in the case details.
- **Browser identity**: The Worker site keeps your visitor identity in this browser. If the browser cannot keep it, you can read cases but cannot send reports. Allow site storage and reload to send reports. On browsers with Web Locks, tabs opened at the same time use one identity.
- **News ticker**: The bottom of the page shows Taipei news from Bing News and the PTT Taipei board. It does not show posts about trade or requests. It also shows Threads posts that a person selected. Each item starts with its date, for example 10/24.

**Department administrators** (add `?admin=<token>` to the URL. After you open the page, the website removes the token from the address bar.)

- **Back office**: The back office shows the reports of today, open cases, cases for review, cases without a department, and late cases. Three work queues let you approve, hide, send to a different department, or set a case to "in progress" or "fixed".
- **Case operations**: Make a repair order (PR). Merge it to close the case. Send the case to a different department. Set a milestone. Read the contact data of the citizen.
- **Releases**: AI writes a draft of the weekly summary of closed cases. There are also monthly 1999 dispatch reports for January to September 2026.
- **Insights**: The website shows the SLA (average number of days to repair) for each department. A case that is open again does not count as fixed. A case that is fixed again uses the latest repair date. If a department is more than the limit, the website shows "failing".
- **Demo tools**: Save and reset a demo snapshot. After a rehearsal, one push sets the data back.

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
  ├─ /api/news ───────── Bing News RSS, PTT Taipei board (cache 10 minutes)
  ├─ /api/photo ──────── R2 bucket `taipei-issue-photos`
  ├─ /api/contact ────── Name and mobile number of the citizen (private DO table, only the administrator can read)
  └─ /api/visitor ────── Gives a visitor ID (HMAC signature)
```

The same `taipei-issues.html` page can also operate as a claude.ai artifact. `worker/build.mjs` puts a small adapter script before the page. This script connects `window.claude` to the Worker API above.

**Security and limits**

- A visitor can write only their own reports and +1 votes (`reports/<id>`, `votes/<id>`). The Worker checks the identity with a signature. The Worker compares the administrator token in constant time.
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
| `check.mjs` | Front-end logic checks: personal data mask, data cleanup, Taipei boundary, templates, photo keys |
| `worker/` | Cloudflare Worker: `src/index.js` (routes), `src/hub.js` (Durable Object), `build.mjs`, `data.json` (seed data), `test/` |
| `data/1999-categories.json` | Official 1999 case categories (9 main categories, 136 subcategories) |
| `data/history-2026.json` | 1999 dispatches from January to September 2026 (road section level) |
| `data/history-roads.json` | Cache of road coordinates |
| `data/districts.geojson`, `data/li.geojson` | Boundaries of the 12 districts and the 456 villages (里), WGS84 |
| `data/li-contacts.json`, `data/councilors.json` | Village chief per village (by village code) and councillors per election zone (6 zones). Fill `chief`, `phone`, `name`, `party` by hand. Use office phone numbers, not personal mobile numbers. |
| `scripts/` | Data scripts. Refer to the table below. |
| `deck/` | Slides and product screenshots |
| `DEMO.md`, `SCRIPT.md` | Demo procedure and speaker script |
| `PLAN.md` | Tasks and acceptance records for each phase |

| Script | Purpose |
|---|---|
| `scripts/fetch-1999-history.mjs` | Downloads the data.taipei 1999 dispatch CSV files, gets the road sections, finds the coordinates, and makes `data/history-2026.json` |
| `scripts/build-li.mjs` | Downloads the data.taipei village boundary map (TWD97 shapefile), changes it to WGS84, simplifies it, and makes `data/li.geojson` and `data/districts.geojson`. Needs `unzip`. |
| `scripts/history-releases.mjs` | Makes the monthly dispatch reports from the history data (`--write` writes them to the live database) |
| `scripts/enrich-seed.mjs` | Adds 1999 categories and coordinates to the demo cases |
| `scripts/codex-proxy.mjs` | Local development only: sends AI sorting requests to Codex CLI |
| `scripts/demo-photos.mjs` | Changes the generated demo photos to JPEG, uploads them to R2, and adds them to the demo data |

## Local development

You must have Node.js 22 or later and Wrangler.

```bash
cd worker
npm install -g wrangler   # if it is not installed
```

Make the file `worker/.dev.vars`. Do not put this file in git.

```
VISITOR_SECRET=<a long random string>
ADMIN_TOKEN=<local administrator token>
ANTHROPIC_API_KEY=<optional; if it is empty, AI sorting sets "1999 待分派">
AI_PROXY_URL=<optional; use Codex CLI for local sorting: http://127.0.0.1:8799>
```

**Use Codex CLI for local AI sorting** (a Claude API key is not necessary):

1. Start the proxy.
2. In `.dev.vars`, set `AI_PROXY_URL=http://127.0.0.1:8799`.

The proxy runs `codex exec` one time for each request. The default model is `gpt-6-luna` with low reasoning effort in a read-only sandbox. To use a different model, set `CODEX_MODEL`. Each sort takes approximately 10 seconds. Use the proxy only on a local computer. The live website continues to use the Claude API.

```bash
node scripts/codex-proxy.mjs
```

Start the server and do the tests:

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

Browser regression tests need Playwright and a running local Worker. Install Playwright in your test environment. You can set `PLAYWRIGHT_MODULE` to a module path and `CHROME_EXECUTABLE_PATH` to an installed Chrome executable. The phone mask test uses port 8788 by default; set `PHONE_MASK_BASE` to use another local URL. Set `PHONE_MASK_EVIDENCE_DIR` to save a browser screenshot.

```bash
node worker/test/report-flow.mjs
BASE=http://localhost:8807 node worker/test/coordinate-preview.mjs
node worker/test/addendum-flow.mjs
node worker/test/phone-mask.mjs
node worker/test/note-photos.cjs
node worker/test/share-links.mjs
BASE=http://localhost:8808 node worker/test/location-request-race.mjs
node worker/test/duplicate-target-navigation.mjs
```

The history map loading test uses sample dispatch data. It checks a delayed Leaflet load, cancellation, and retry:

```bash
HISTORY_MAP_LOADING_BASE=http://localhost:8788 node worker/test/history-map-loading.mjs
```

The location test uses a synthetic visitor identity, delays GPS and address results in the browser, and intercepts database writes.
The duplicate target navigation test uses `DUPLICATE_NAV_BASE` (default: `http://localhost:8809`), `PLAYWRIGHT_MODULE`, and `CHROME_EXECUTABLE_PATH` when set. Set `DUPLICATE_NAV_ADMIN_TOKEN` to the same local test value as the Worker's `ADMIN_TOKEN`. The test writes generated cases to the local Worker and deletes them when it ends. Use a separate local Worker persistence directory.
The browser test delays +1 and addendum writes while the visitor edits, cancels, or reopens the report form.

```bash
cd worker && BASE=http://localhost:8788 node test/smoke.mjs
```

```bash
BASE=http://localhost:8788 ADMIN_TOKEN=<local-test-token> node worker/test/report-contact.mjs
```

```bash
cd worker && node test/sync.mjs
```

Local URL: <http://localhost:8788>. Administrator mode: `http://localhost:8788/?admin=<ADMIN_TOKEN>`.

## Deployment

```bash
cd worker && npx wrangler deploy
```

The production environment must have three secrets. Set each secret with `wrangler secret put <name>`: `VISITOR_SECRET`, `ADMIN_TOKEN`, `ANTHROPIC_API_KEY`. You must also have the R2 bucket `taipei-issue-photos`.

CAUTION: The live database loads `worker/data.json` only at the first start. If you change the seed data after that, write it with administrator access. Use the `--write` option of a script, or the `ADMIN` and `BASE` environment variables.

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

## Known limits

- Administrator access applies only to the browser tab that you opened with the token.
- Browsers without Web Locks can create different visitor identities if you open two tabs for the first time at the same time. "My reports" is tied to the identity kept by this browser.
- The Worker site makes report creation and note additions atomic. The claude.ai artifact keeps its existing database update method and does not have these server guarantees.
- Case numbers can be the same if many persons send reports at the same time. If two administrators change one case at the same time, one change can replace the other change.
- AI sorting and the personal data mask operate in the browser. The Worker checks the prompt prefix and the length limit.
- If you upload a photo and do not send the report, the photo stays in R2. The system does not remove it automatically.
- Each history point shows only the road section. For approximately 6% of cases, the road section was not found. These points show near the center of the district.
