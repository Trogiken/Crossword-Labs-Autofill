# Crossword Labs Autofill

A Chrome extension that fills in any [Crossword Labs](https://crosswordlabs.com) puzzle with one click.

It exists to demonstrate a client-side data exposure: when a puzzle page loads, Crossword Labs sends the complete solution to the browser in a global JavaScript variable (`grid`). Every cell's correct letter is in `grid[row][col].char`. The site's "Answers" button and its no-refund confirmation only gate the display of that data, not access to it. Grading also happens entirely in the browser.

## How it works

The popup runs a script in the page's main JavaScript context (`chrome.scripting.executeScript` with `world: "MAIN"`), which is what lets it read the page's globals. A normal content script runs in an isolated world and can't see them.

Clicking **Fill and grade puzzle** writes each `grid[r][c].char` into the matching SVG cell (`#cx-ROW-COL .cx-a`), rebuilds each word from `index_to_row_column` and `index_to_direction`, stores it in the site's own `localStorage` progress keys (`CROSSWORD_ID-wordIndex`), and reloads. The site then restores the answers and grades them itself.

## Install

**From the Chrome Web Store:** [Crossword Labs Autofill](https://chromewebstore.google.com/detail/igcmjnaginhhlnkifafcnajkmeegocei)

**From source:**

1. Clone or download this repo.
2. Go to `chrome://extensions` and turn on Developer mode.
3. Click **Load unpacked** and select the `extension` folder.

## Permissions

| Permission | Why |
| --- | --- |
| `activeTab` | Runs only on the current tab, only after you click the button. |
| `scripting` | Injects the fill script into the page. |
| `https://crosswordlabs.com/*` | Limits the extension to Crossword Labs. |

The extension makes no network requests and collects no data. See the [privacy policy](PRIVACY.md).

## Suggested fix for Crossword Labs

Don't send the solution grid to the client. Send only the grid shape (which cells exist and where words start), and grade answers with a server-side check.

## Disclaimer

This is a security research demonstration. Many Crossword Labs puzzles are made by teachers for their classes; please don't use this to get around assignments. Not affiliated with CrosswordLabs.com.

## License

MIT. See [LICENSE](LICENSE).
