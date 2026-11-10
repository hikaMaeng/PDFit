# Cover card overlay layout plan — 2026-11-10

## Goal

Rework the cover (image list) card in `packages/pdfit/src/front/components/PdfCoverItem.tsx`.

## Acceptance criteria (user request, 2026-11-10)

1. A two-line title band (black background with alpha, white text) is laid over the bottom of the thumbnail.
2. Four buttons attach directly under the thumbnail and the card ends there (thumbnail + four buttons). The white divider between buttons is removed; the buttons split the row into four equal parts.
3. On mouse over, the rest of the thumbnail (everything except the title band) gets a black alpha overlay showing tags, last opened time, and last page.
4. Without hovering, a small circled-`i` icon at the thumbnail's top right toggles the same overlay.
5. The toggle exists for touch devices (mobile, tablet) that have no hover.

## Checks

Script: `apps/pdfit/tests/cover-card-overlay-deployed-browser.mjs` (read-only, deployed Free server, port 15203).

| Criterion | Check |
|---|---|
| 1 | title band bottom = thumbnail bottom (±1px); computed background `rgba(0, 0, 0, 0.\d+)`; text `rgb(255, 255, 255)` |
| 2 | `pdf-cover-actions` has 4 buttons, equal width (±1px), no gap between them; actions top = thumbnail bottom; card bottom − actions bottom ≤ 2.5px (border); no divider element |
| 3 | idle: overlay not visible; `hover()` on the thumbnail: overlay visible with `열린시간:`, `최종페이지:`, size; pointer leaves: hidden again |
| 4 | toggle at the thumbnail's top-right half; click → `aria-expanded=true` and overlay stays after the pointer leaves; click → hidden |
| 5 | Chrome with `hasTouch`/`isMobile` at 820×1180 and 390×844: `matchMedia('(hover: hover)')` is false; `tap()` on the toggle opens and closes the overlay |

Also: overlay bottom = title band top (the overlay covers everything except the band).

## Regression scope

Existing cover tests were changed for the new structure: `lnb-search-beige-browser.mjs`,
`viewer-tags-free-tier-browser.mjs` (layout assertions), `folder-tag-display-browser.mjs`,
`free-ai-tagged-retry-browser.mjs` (open the info overlay before reading tags).
These target the Pro service fixture on port 15201 and are recorded in the report with their real outcome.

## Run

```
npm run deploy:standalone
PDFIT_BROWSER_CHANNEL=chrome PDFIT_EVIDENCE_DIR=test/20261110/cover-card-overlay node apps/pdfit/tests/cover-card-overlay-deployed-browser.mjs
```
