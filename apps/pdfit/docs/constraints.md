# Constraints

## Blast radius

| Surface | Consumers | Invariants |
| --- | --- | --- |
| `src/front/main.tsx` | Vite service entry | Includes library routes and Settings navigation. |
| `src/front/viewer-main.tsx` | Vite viewer entry | Does not render service navigation or Settings UI. |
| `src/server/index.ts` | Docker runtime | Uses one pool, one port, and one mounted books root. |
| `src/server/services/settingsStore.ts` | Settings router | Uses parameterized SQL and preserves legacy `pro_settings` values. |
| `docker/Dockerfile` | Root Compose | Copies prebuilt `dist`; runtime image owns PostgreSQL startup. |

UI landmarks used by browser tests include visible `PDFit`, `PDF Viewer`, `Settings`, `AI servers`, and the `viewer status` aria label. OCR hooks: `bookmark-card-ocr` (`data-ocr-status`), `clip-ocr` and `page-ocr` panels (`data-ocr-status`, `-text`, `-source` with `data-source`, `-copy`, `-retry`, `-unavailable`, `-failed`), `page-ocr-open`, `page-ocr-dialog`. Real-cover hooks: `pdf-cover-real-cover`, `real-cover-dialog`, `real-cover-query`, `real-cover-search`, `real-cover-candidate`, `real-cover-restore`.
