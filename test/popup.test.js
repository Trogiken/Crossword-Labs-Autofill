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

// Loads the whole popup with a fake chrome API, clicks Fill (unless
// executeScript is null), then clicks "Report a problem", and returns what
// the user would see plus the issue that would open.
async function clickFill(tabUrl, executeScript) {
  const els = {};
  const el = (id) => (els[id] = {
    textContent: "", className: "", disabled: false, hidden: id === "error",
    focus() { focused = id; },
    addEventListener(type, fn) { this.onclick = fn; }
  });
  let opened = null;
  let focused = null;
  const ctx = {
    URL,
    navigator: { userAgent: "TestBrowser/1.0" },
    document: { getElementById: el, querySelectorAll: () => [] },
    chrome: {
      runtime: { getManifest: () => ({ version: "9.9.9" }) },
      tabs: { query: async () => [{ id: 1, url: tabUrl }], create: (o) => { opened = o.url; } },
      scripting: { executeScript }
    }
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  if (executeScript) await els.fill.onclick();
  const ui = {
    status: els.status.textContent,
    kind: els.status.className,
    disabled: els.fill.disabled,
    // The error panel's code badge, or null while the panel is hidden.
    error: els.error.hidden ? null : els["error-code"].textContent,
    errorMsg: els["error-msg"].textContent,
    focused
  };
  await els.report.onclick();
  const issue = new URL(opened);
  // The panel's button must open exactly the same issue as the footer one.
  opened = null;
  await els["report-error"].onclick();
  assert.equal(opened, issue.toString());
  return { ...ui, title: issue.searchParams.get("title"), body: issue.searchParams.get("body") };
}

const PUZZLE_URL = "https://crosswordlabs.com/view/test-puzzle";
const never = async () => { throw new Error("should not be called"); };

test("popup: success shows the message and keeps the button disabled", async () => {
  const ui = await clickFill(PUZZLE_URL, async () => [{ result: { ok: true, msg: "Filled 2 words." } }]);
  assert.equal(ui.status, "Filled 2 words.");
  assert.equal(ui.kind, "ok");
  assert.equal(ui.disabled, true);
  assert.equal(ui.error, null);
});

test("popup: other sites get a hint, not an error", async () => {
  const ui = await clickFill("https://example.com/", never);
  assert.equal(ui.status, "Open a Crossword Labs puzzle first.");
  assert.equal(ui.error, null);
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
  assert.equal(ui.error, null);
});

test("popup: no grid on a puzzle page offers a report", async () => {
  const ui = await clickFill(PUZZLE_URL, async () => [{ result: { ok: false, code: "E101", detail: "grid is undefined" } }]);
  assert.equal(ui.error, "E101");
  assert.equal(ui.errorMsg, "No puzzle grid found on this page.");
  assert.equal(ui.focused, "report-error");
  assert.match(ui.title, /^\[E101\]/);
});

test("popup: injection failure is E301 with a filled-in report", async () => {
  const ui = await clickFill(PUZZLE_URL, async () => { throw new Error("Cannot access contents of the page"); });
  assert.equal(ui.error, "E301");
  assert.equal(ui.title, "[E301] Couldn't run on this page.");
  for (const s of ["Code:      E301", "Cannot access contents of the page", PUZZLE_URL, "Extension: 9.9.9", "TestBrowser/1.0"]) {
    assert.ok(ui.body.includes(s), `report body should include ${s}`);
  }
  assert.equal(ui.disabled, false);
});

test("popup: empty result is E302", async () => {
  const ui = await clickFill(PUZZLE_URL, async () => [{ result: null }]);
  assert.equal(ui.error, "E302");
});

test("popup: unknown error codes become E901", async () => {
  const ui = await clickFill(PUZZLE_URL, async () => [{ result: { ok: false, code: "E999", detail: "" } }]);
  assert.equal(ui.error, "E901");
});

test("popup: long details are trimmed so the issue URL stays short", async () => {
  const ui = await clickFill(PUZZLE_URL, async () => [{ result: { ok: false, code: "E901", detail: "x".repeat(50000) } }]);
  assert.ok(ui.body.length < 2500, `body was ${ui.body.length} chars`);
});

test("report button: general report without an error", async () => {
  const ui = await clickFill(PUZZLE_URL, null);
  assert.equal(ui.title, "Problem report");
  for (const s of ["Code:      none", PUZZLE_URL, "Extension: 9.9.9", "TestBrowser/1.0"]) {
    assert.ok(ui.body.includes(s), `report body should include ${s}`);
  }
});

test("report button: doesn't include the URL of non-Crossword Labs pages", async () => {
  const ui = await clickFill("https://mail.example.com/inbox/secret", null);
  assert.ok(!ui.body.includes("example.com"));
  assert.ok(ui.body.includes("Page:      -"));
});

test("error panel: a successful run hides it and clears the error", async () => {
  let calls = 0;
  const flaky = async () => (calls++ ? [{ result: { ok: true, msg: "ok" } }] : [{ result: null }]);
  const els = {};
  // Two clicks in one popup: first fails, second succeeds.
  const el = (id) => (els[id] = {
    textContent: "", className: "", disabled: false, hidden: id === "error",
    focus() {},
    addEventListener(type, fn) { this.onclick = fn; }
  });
  let opened = null;
  const ctx = {
    URL, navigator: { userAgent: "T" },
    document: { getElementById: el, querySelectorAll: () => [] },
    chrome: {
      runtime: { getManifest: () => ({ version: "1" }) },
      tabs: { query: async () => [{ id: 1, url: PUZZLE_URL }], create: (o) => { opened = o.url; } },
      scripting: { executeScript: flaky }
    }
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  await els.fill.onclick();
  assert.equal(els.error.hidden, false);
  await els.fill.onclick();
  assert.equal(els.error.hidden, true);
  await els.report.onclick();
  assert.equal(new URL(opened).searchParams.get("title"), "Problem report");
});
