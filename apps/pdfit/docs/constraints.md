# Constraints

## Blast radius

| Surface | Consumers | Invariants |
| --- | --- | --- |
| `src/front/main.tsx` | Vite service entry | Includes library routes and Settings navigation. |
| `src/front/viewer-main.tsx` | Vite viewer entry | Does not render service navigation or Settings UI. |
| `src/server/index.ts` | Docker runtime | Uses one pool, one port, and one mounted books root. |
| `src/server/services/settingsStore.ts` | Settings router | Uses parameterized SQL and preserves legacy `pro_settings` values. |
| `docker/Dockerfile` | Root Compose | Copies prebuilt `dist`; runtime image owns PostgreSQL startup. |

UI landmarks used by browser tests include visible `PDFit`, `PDF Viewer`, `Settings`, `AI servers`, and the `viewer status` aria label.
