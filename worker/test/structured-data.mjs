// Run from any directory with: node worker/test/structured-data.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const workerDir = fileURLToPath(new URL("..", import.meta.url));
const buildPath = fileURLToPath(new URL("../build.mjs", import.meta.url));
const outputPath = new URL("../public/index.html", import.meta.url);
const build = spawnSync(process.execPath, [buildPath], { cwd: workerDir, encoding: "utf8" });
assert.equal(build.error, undefined, `build starts: ${build.error?.message || ""}`);
assert.equal(build.status, 0, `build succeeds: ${build.stderr || build.stdout}`);

const html = readFileSync(outputPath, "utf8");
const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i)?.[1];
assert.ok(head, "generated page has a head element");

const parseAttributes = tag => {
  const attributes = {};
  const pattern = /([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(pattern)) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
};

const titles = [...head.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/gi)].map(match => match[1]);
assert.equal(titles.length, 1, "generated head has one title");
assert.equal((html.match(/<title\b/gi) || []).length, 1, "generated page has no extra title in the body");
const title = titles[0];
assert.match(title, /非官方示範/, "title identifies the site as a non-official demonstration");

const metaTags = [...head.matchAll(/<meta\b[^>]*>/gi)].map(match => parseAttributes(match[0]));
const meta = key => {
  const matches = metaTags.filter(attributes => (attributes.name || attributes.property || "").toLowerCase() === key.toLowerCase());
  assert.equal(matches.length, 1, `one ${key} meta tag exists`);
  return matches[0].content;
};
const canonicalTags = [...head.matchAll(/<link\b[^>]*>/gi)]
  .map(match => parseAttributes(match[0]))
  .filter(attributes => attributes.rel?.toLowerCase() === "canonical");
assert.equal(canonicalTags.length, 1, "one canonical link exists");
const canonical = new URL(canonicalTags[0].href);
const canonicalUrl = canonical.href;
assert.equal(canonical.protocol, "https:", "canonical uses HTTPS");
assert.equal(canonical.origin, "https://taipei-issue-tracker.labanchen.workers.dev", "canonical stays on the non-official project domain");
assert.equal(canonical.pathname, "/", "canonical identifies the site root");
assert.equal(canonical.search, "", "canonical has no query parameters");
assert.equal(canonical.hash, "", "canonical has no fragment");
assert.equal(meta("og:url"), canonicalUrl, "Open Graph URL matches canonical URL");

const titleMeta = meta("og:title");
const siteNameMeta = meta("og:site_name");
assert.match(siteNameMeta, /非官方示範/, "Open Graph site name identifies the non-official demonstration");
assert.equal(titleMeta, title, "Open Graph title matches the page title");
const description = meta("description");
assert.equal(meta("og:description"), description, "Open Graph description matches the search description");

const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)];
const jsonLdScripts = scripts.filter(match => {
  const openTag = match[0].slice(0, match[0].indexOf(">") + 1);
  return parseAttributes(openTag).type?.toLowerCase() === "application/ld+json";
});
assert.equal(jsonLdScripts.length, 1, "page has one JSON-LD script");
const jsonLdText = jsonLdScripts[0][1];
assert.doesNotMatch(jsonLdText, /<\/script/i, "JSON-LD cannot terminate its script element");
const jsonLd = JSON.parse(jsonLdText);
assert.equal(jsonLd["@context"], "https://schema.org", "JSON-LD uses the Schema.org context");
assert.ok(Array.isArray(jsonLd["@graph"]), "JSON-LD has a graph");
assert.equal(jsonLd["@graph"].length, 3, "graph has only the site, page and application nodes");

const nodes = jsonLd["@graph"];
const nodeByType = type => {
  const matches = nodes.filter(node => node["@type"] === type);
  assert.equal(matches.length, 1, `graph has one ${type} node`);
  return matches[0];
};
const website = nodeByType("WebSite");
const webpage = nodeByType("WebPage");
const application = nodeByType("WebApplication");
const expectedIds = new Map([
  [website, `${canonicalUrl}#website`],
  [webpage, `${canonicalUrl}#webpage`],
  [application, `${canonicalUrl}#application`]
]);
const ids = new Set();
for (const [node, id] of expectedIds) {
  assert.equal(node["@id"], id, `${node["@type"]} has a stable ID under the canonical URL`);
  assert.ok(!ids.has(node["@id"]), "node IDs are unique");
  ids.add(node["@id"]);
  assert.equal(node.url, canonicalUrl, `${node["@type"]} URL matches the canonical URL`);
  assert.equal(new URL(node.url).origin, canonical.origin, `${node["@type"]} URL has the canonical origin`);
  assert.equal(node.name, node === website ? siteNameMeta : title, `${node["@type"]} name matches its Open Graph or page title`);
  assert.equal(node.inLanguage, "zh-Hant", `${node["@type"]} declares Traditional Chinese`);
  assert.equal(node.description, description, `${node["@type"]} description matches page metadata`);
}
assert.equal(webpage.isPartOf?.["@id"], website["@id"], "page links to its website");
assert.equal(application.isPartOf?.["@id"], website["@id"], "application links to its website");
assert.equal(webpage.mainEntity?.["@id"], application["@id"], "page identifies the web application as its main entity");
for (const node of nodes) {
  for (const relation of [node.isPartOf, node.mainEntity].filter(Boolean)) {
    assert.ok(ids.has(relation["@id"]), `${node["@type"]} relation points to a graph node`);
  }
}
assert.equal(application.isAccessibleForFree, true, "the application is marked free to access");

const requiredDescriptionMeaning = [
  ["personal development", /個人(?:開發|製作)/],
  ["non-official status", /非官方/],
  ["Taipei City Government identity", /臺北市政府/],
  ["official 1999 website identity", /1999\s*官方網站/],
  ["no forwarding to the government or 1999", /不會轉交[^。；]*?(?:市府|1999)/],
  ["simulated public reports", /公開案件[^。；]*?模擬/],
  ["simulated assignments", /分派[^。；]*?模擬/]
];
for (const [meaning, pattern] of requiredDescriptionMeaning) {
  assert.match(description, pattern, `description states ${meaning}`);
}

const banner = html.match(/<div\b[^>]*\bid="demo-notice"[^>]*>([\s\S]*?)<\/div\s*>/i)?.[1];
assert.ok(banner, "page has a visible demonstration notice");
assert.match(banner, /非官方示範/, "visible notice identifies the demonstration as non-official");
assert.match(banner, /模擬案件/, "visible notice identifies reports as simulated");
assert.match(banner, /不會轉交市府/, "visible notice says reports do not go to the government");

const forbiddenTypes = new Set([
  "GovernmentOrganization", "GovernmentService", "CivicStructure", "ContactPoint",
  "AggregateRating", "Review", "SearchAction", "FAQPage"
]);
const forbiddenKeys = new Set([
  "author", "publisher", "provider", "sameas", "telephone", "contactpoint",
  "aggregaterating", "review", "reviews", "ratingvalue", "reviewcount", "offers",
  "price", "potentialaction"
]);
const inspectSchema = value => {
  if (Array.isArray(value)) {
    for (const item of value) inspectSchema(item);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!forbiddenKeys.has(key.toLowerCase()), `schema omits identity, contact, rating and action field ${key}`);
      if (key === "@type") {
        const types = Array.isArray(child) ? child : [child];
        for (const type of types) assert.ok(!forbiddenTypes.has(type), `schema omits unsupported type ${type}`);
      }
      inspectSchema(child);
    }
  }
};
inspectSchema(jsonLd);

console.log("OK structured data matches the non-official demo and canonical site");
