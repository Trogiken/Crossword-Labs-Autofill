// Tests for extension/popup.js. No dependencies: run with `node --test`.
//
// popup.js is loaded into a sandbox with fake DOM and chrome APIs. pageFill()
// is also run on its own against a small made-up puzzle shaped like the data
// Crossword Labs puts on its pages.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC = fs.readFileSync(path.join(__dirname, "../extension/popup.js"), "utf8");
const PAGE_FILL = SRC.slice(SRC.indexOf("function pageFill"), SRC.indexOf("\n// Checks the tab"));

// C A T
// A # #
// R # #
// Word 0 is CAT (across), word 1 is CAR (down), both starting at (0, 0).
function puzzle() {
  const w = (index, start) => ({ index, is_start_of_word: start });
  return [
    [{ char: "c", across: w(0, true), down: w(1, true) }, { char: "a", across: w(0, false), down: null }, { char: "t", across: w(0, false), down: null }],
    [{ char: "a", across: null, down: w(1, false) }, null, null],
    [{ char: "r", across: null, down: w(1, false) }, null, null]
  ];
}

// Runs pageFill() in a fake page. Options switch off parts of the page;
// `setup` is extra code run inside the page first.
function runPageFill(opts = {}) {
  const store = {};
  const cells = {};
  let reloaded = false;
  const ctx = {
    document: {
      querySelector(q) {
        if (q.startsWith("meta")) return opts.noOgImage ? null : { content: "https://crosswordlabs.com/image/42.svg" };
        if (opts.noDom) return null;
        return (cells[q] = cells[q] || { textContent: "" });
      },
      querySelectorAll: () => []
    },
    localStorage: {
      setItem(k, v) {
        if (opts.storageThrows) throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
        store[k] = v;
      }
    },
    location: { reload: () => { reloaded = true; } },
    setTimeout: (f) => f()
  };
  vm.createContext(ctx);
  if (!opts.noGrid) ctx.grid = puzzle();
  if (!opts.noId) ctx.CROSSWORD_ID = 42;
  if (opts.tables) {
    ctx.index_to_row_column = [{ row: 0, col: 0 }, { row: 0, col: 0 }];
    ctx.index_to_direction = { 0: "across", 1: "down" };
  }
  if (opts.setup) vm.runInContext(opts.setup, ctx);
  const result = vm.runInContext(PAGE_FILL + "\npageFill()", ctx);
  return { result, store, cells, reloaded };
}

const SAVED = { "42-0": "cat", "42-1": "car" };

test("fills and saves using the site's tables", () => {
  const { result, store, cells, reloaded } = runPageFill({ tables: true });
  assert.equal(result.ok, true);
  assert.deepEqual(store, SAVED);
  assert.equal(cells["#cx-0-2 .cx-a"].textContent, "T");
  assert.equal(reloaded, true);
});

test("rebuilds word starts from grid cells when the tables are missing", () => {
  const { result, store } = runPageFill();
  assert.equal(result.ok, true);
  assert.deepEqual(store, SAVED);
});

test("reads the puzzle ID from og:image when CROSSWORD_ID is missing", () => {
  const { result, store } = runPageFill({ noId: true });
  assert.equal(result.ok, true);
  assert.deepEqual(store, SAVED);
});

test("E101 when there is no grid", () => {
  const { result, reloaded } = runPageFill({ noGrid: true });
  assert.equal(result.code, "E101");
  assert.equal(reloaded, false);
});

test("E202 when boxes fill but there is no puzzle ID", () => {
  const { result, reloaded } = runPageFill({ noId: true, noOgImage: true });
  assert.equal(result.code, "E202");
  assert.match(result.detail, /id=no/);
  assert.equal(reloaded, false);
});

test("E202 with the storage error name when localStorage throws", () => {
  const { result } = runPageFill({ storageThrows: true });
  assert.equal(result.code, "E202");
  assert.match(result.detail, /storage=QuotaExceededError/);
});

test("E201 when nothing can be filled or saved", () => {
  const { result } = runPageFill({ noDom: true, noId: true, noOgImage: true });
  assert.equal(result.code, "E201");
});

test("E901 with a stack trace when something throws", () => {
  const { result } = runPageFill({
    noId: true,
    setup: 'Object.defineProperty(globalThis, "CROSSWORD_ID", { get() { throw new Error("boom"); } })'
  });
  assert.equal(result.code, "E901");
  assert.match(result.detail, /boom/);
});

// Loads the whole popup with a fake chrome API, clicks the button, and
// returns what the user would see.
async function clickFill(tabUrl, executeScript) {
  const els = {};
  const el = (id) => (els[id] = {
    hidden: id === "report", href: "", textContent: "", className: "", disabled: false,
    addEventListener(type, fn) { this.onclick = fn; }
  });
  const ctx = {
    URL,
    navigator: { userAgent: "TestBrowser/1.0" },
    document: { getElementById: el, querySelectorAll: () => [] },
    chrome: {
      runtime: { getManifest: () => ({ version: "9.9.9" }) },
      tabs: { query: async () => [{ id: 1, url: tabUrl }], create() {} },
      scripting: { executeScript }
    }
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  await els.fill.onclick();
  const report = els.report.hidden ? null : new URL(els.report.href);
  return {
    status: els.status.textContent,
    kind: els.status.className,
    disabled: els.fill.disabled,
    title: report && report.searchParams.get("title"),
    body: report && report.searchParams.get("body")
  };
}

const PUZZLE_URL = "https://crosswordlabs.com/view/test-puzzle";
const never = async () => { throw new Error("should not be called"); };

test("popup: success shows the message and keeps the button disabled", async () => {
  const ui = await clickFill(PUZZLE_URL, async () => [{ result: { ok: true, msg: "Filled 2 words." } }]);
  assert.equal(ui.status, "Filled 2 words.");
  assert.equal(ui.kind, "ok");
  assert.equal(ui.disabled, true);
  assert.equal(ui.title, null);
});

test("popup: other sites get a hint and no report link", async () => {
  const ui = await clickFill("https://example.com/", never);
  assert.equal(ui.status, "Open a Crossword Labs puzzle first.");
  assert.equal(ui.title, null);
  assert.equal(ui.disabled, false);
});

test("popup: www and embed URLs are accepted", async () => {
  const ok = async () => [{ result: { ok: true, msg: "ok" } }];
  assert.equal((await clickFill("https://www.crosswordlabs.com/view/x", ok)).kind, "ok");
  assert.equal((await clickFill("https://crosswordlabs.com/embed/x", ok)).kind, "ok");
});

test("popup: no grid on a non-puzzle page is a hint, not a bug", async () => {
  const ui = await clickFill("https://crosswordlabs.com/", async () => [{ result: { ok: false, code: "E101", detail: "" } }]);
  assert.equal(ui.status, "Open a Crossword Labs puzzle first.");
  assert.equal(ui.title, null);
});

test("popup: no grid on a puzzle page offers a report", async () => {
  const ui = await clickFill(PUZZLE_URL, async () => [{ result: { ok: false, code: "E101", detail: "grid is undefined" } }]);
  assert.match(ui.status, /\(E101\)$/);
  assert.match(ui.title, /^\[E101\]/);
});

test("popup: injection failure is E301 with a filled-in report", async () => {
  const ui = await clickFill(PUZZLE_URL, async () => { throw new Error("Cannot access contents of the page"); });
  assert.match(ui.status, /\(E301\)$/);
  assert.equal(ui.title, "[E301] Couldn't run on this page.");
  for (const s of ["Code:      E301", "Cannot access contents of the page", PUZZLE_URL, "Extension: 9.9.9", "TestBrowser/1.0"]) {
    assert.ok(ui.body.includes(s), `report body should include ${s}`);
  }
  assert.equal(ui.disabled, false);
});

test("popup: empty result is E302", async () => {
  const ui = await clickFill(PUZZLE_URL, async () => [{ result: null }]);
  assert.match(ui.status, /\(E302\)$/);
});

test("popup: unknown error codes become E901", async () => {
  const ui = await clickFill(PUZZLE_URL, async () => [{ result: { ok: false, code: "E999", detail: "" } }]);
  assert.match(ui.status, /\(E901\)$/);
});

test("popup: long details are trimmed so the issue URL stays short", async () => {
  const ui = await clickFill(PUZZLE_URL, async () => [{ result: { ok: false, code: "E901", detail: "x".repeat(50000) } }]);
  assert.ok(ui.body.length < 2500, `body was ${ui.body.length} chars`);
});
