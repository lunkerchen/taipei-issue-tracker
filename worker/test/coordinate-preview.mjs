import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BASE || "http://localhost:8807";
const evidenceDir = process.env.EVIDENCE_DIR;
const launchOptions = { headless:true };
if (process.env.CHROME_EXECUTABLE_PATH) launchOptions.executablePath = process.env.CHROME_EXECUTABLE_PATH;
const browser = await chromium.launch(launchOptions);

try {
  for (const address of ["", "合成測試路口"]) {
    const context = await browser.newContext({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
    try {
      const page = await context.newPage(), errors = [], creates = [];
      const token = "1234567890abcdef." + "a".repeat(64);
      let snapshot = { _seq:0 };
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/api/visitor", route => route.fulfill({ json:{ id:token } }));
      await page.route("**/api/health", route => route.fulfill({ json:{ ai:true } }));
      await page.route("**/api/sample", route => route.fulfill({ json:{
        title:"合成位置確認", dept:"交通局", tags:[], category:"", district:"中正區", address,
        reason:"合成分類", duplicate_of:null, duplicate_reason:"", spam:false, outside_taipei:false, too_vague:false
      } }));
      await page.route("**/api/db", async route => {
        if (route.request().method() === "GET") return route.fulfill({ json:snapshot });
        const body = route.request().postDataJSON();
        assert.equal(body.op, "create-report", "the test only permits the report submission");
        creates.push(body);
        const doc = { items:{ [body.data.key]:body.data.item } };
        snapshot = { _seq:1, reports:{ [token.split(".")[0]]:doc } };
        await route.fulfill({ json:{ ok:true, created:true, seq:1, data:doc } });
      });
      await page.goto(base, { waitUntil:"domcontentloaded" });
      await page.locator("#navReport").waitFor({ state:"visible" });
      await page.locator("#navReport").click();
      await page.locator("#cName").fill("合成市民");
      await page.locator("#cPhone").fill("0912345678");
      await page.locator("#cEmail").fill("citizen@example.com");
      await page.locator("#newText").fill("合成測試：路口號誌故障，需要修復");
      await page.locator("#agree").check();
      await page.locator("#pinBtn").click();
      await page.waitForFunction(() => document.querySelector("#pickMap").classList.contains("leaflet-container"));
      await page.locator("#pickMap").click({ position:{ x:125, y:115 } });
      await page.waitForFunction(() => picked?.loc === "pin");
      const selected = await page.evaluate(() => ({ lat:picked.lat, lng:picked.lng, loc:picked.loc }));
      await page.locator("#submitBtn").click();
      await page.locator("#dupBox").waitFor({ state:"visible" });
      const location = page.locator("#dupBox dt").filter({ hasText:/^地點$/ }).locator("+ dd");
      const coordinates = `${selected.lat.toFixed(5)}, ${selected.lng.toFixed(5)}`;
      assert.equal(await location.innerText(), `${address || "地圖標記位置"}（${coordinates}）`);
      assert.equal(creates.length, 0, "preview does not submit the report");
      if (evidenceDir) {
        await mkdir(evidenceDir, { recursive:true });
        await page.screenshot({ path:`${evidenceDir}/coordinate-preview-${address ? "address" : "no-address"}.png`, fullPage:true });
      }
      await page.locator('#dupBox [data-dup="new"]').click();
      await page.waitForFunction(() => document.querySelector("#newBox").hidden);
      assert.equal(creates.length, 1);
      const saved = creates[0].data.item;
      assert.deepEqual({ lat:saved.lat, lng:saved.lng, loc:saved.loc }, selected, "submitted coordinates match the pin shown in the preview");
      assert.equal(saved.address || "", address);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
  console.log("OK selected pin coordinates in preview and submission, with and without address");
} finally { await browser.close(); }
