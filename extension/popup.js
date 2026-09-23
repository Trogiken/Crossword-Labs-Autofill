const statusEl = document.getElementById("status");
const button = document.getElementById("fill");

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = kind || "";
}

// Runs inside the page's own JS context (world: "MAIN") so it can
// read the page's globals: grid, index_to_row_column, index_to_direction, CROSSWORD_ID.
function pageFill() {
  if (typeof grid === "undefined" || !Array.isArray(grid)) {
    return { ok: false, msg: "No puzzle grid found on this page." };
  }
  if (typeof index_to_direction === "undefined" || typeof CROSSWORD_ID === "undefined") {
    return { ok: false, msg: "This page is missing the puzzle's save data." };
  }

  let filled = 0;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const cell = grid[r][c];
      if (!cell) continue;
      const t = document.querySelector(`#cx-${r}-${c} .cx-a`);
      if (t) { t.textContent = cell.char.toUpperCase(); filled++; }
    }
  }

  for (const idx in index_to_direction) {
    let { row, col } = index_to_row_column[idx];
    const across = index_to_direction[idx] === "across";
    let word = "";
    while (grid[row] && grid[row][col]) {
      word += grid[row][col].char;
      across ? col++ : row++;
    }
    try { localStorage.setItem(`${CROSSWORD_ID}-${idx}`, word); } catch (e) { }
  }

  setTimeout(() => location.reload(), 100);
  return { ok: true, msg: `Filled ${filled} boxes. Reloading…` };
}

button.addEventListener("click", async () => {
  button.disabled = true;
  setStatus("Filling…");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\/crosswordlabs\.com\//.test(tab.url || "")) {
    setStatus("Open a Crossword Labs puzzle first.", "err");
    button.disabled = false;
    return;
  }
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: pageFill
    });
    const out = res && res.result;
    setStatus(out ? out.msg : "No response from the page.", out && out.ok ? "ok" : "err");
    if (!out || !out.ok) button.disabled = false;
  } catch (e) {
    setStatus("Couldn't run on this page: " + e.message, "err");
    button.disabled = false;
  }
});

// Open the source link in a new tab (plain links don't navigate from a popup reliably).
document.getElementById("source").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: e.currentTarget.href });
});
