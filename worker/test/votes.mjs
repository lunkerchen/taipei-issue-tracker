// Run: node worker/test/votes.mjs. Exercise the page's real vote handler with two stale tabs.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const src = readFileSync(new URL("../../taipei-issues.html", import.meta.url), "utf8");
const handler = src.slice(src.indexOf("async function setVote("), src.indexOf("function heatmap()"));
const make = new Function("db", "initial", `
  let myVotes = { ...initial }, me = "visitor";
  const render = () => {}, fail = () => {};
  ${handler}
  return { vote: setVote, state: () => myVotes };
`);

let stored = {};
const db = { updateCreates: true, collection: () => ({ doc: () => ({
  set: async data => { stored = { ...data.issues }; },
  update: async data => { stored = { ...stored, ...data.issues }; }
}) }) };
const a = make(db, {}), b = make(db, {});
await Promise.all([a.vote("case-a", true), b.vote("case-b", true)]);
assert.deepEqual(stored, { "case-a": true, "case-b": true }, "stale tabs preserve votes for different cases");
await a.vote("case-a", false);
assert.deepEqual(stored, { "case-a": false, "case-b": true }, "removing one vote preserves the other tab's vote");

let rejectWrite;
const failed = new Promise((_, reject) => { rejectWrite = reject; });
const flaky = make({ updateCreates: true, collection: () => ({ doc: () => ({
  update: data => Object.hasOwn(data.issues, "case-a") ? failed : Promise.resolve()
}) }) }, {});
const pending = flaky.vote("case-a", true);
await flaky.vote("case-b", true);
rejectWrite(new Error("offline"));
await pending;
assert.equal(flaky.state()["case-a"], false, "failed vote returns to its previous state");
assert.equal(flaky.state()["case-b"], true, "failed vote does not erase a later vote for another case");
console.log("OK");
