# 설정 화면 정리 — 실행 보고 (2026-11-10)

- 계획: `apps/pdfit/tests/plans/settings-globe-pgvector-removal-20261110.md`
- 증거: `test/20261110/20261110_100000_settings-globe-pgvector-removal/` (Git 제외)
- 결과: 통과 (항목 1~5). 사용자 지시 3번("AI서버")은 내용이 잘려 있어 아직 반영하지 않았다.

## 변경

- `LNB.tsx`: 왼쪽 버튼 아이콘을 `LanguageIcon`(지구본)으로, 툴팁·접근성 이름을 `언어`로 변경.
  기존에는 두 버튼이 모두 "설정"이라 이름도 같았다. 공유 패키지 변경이므로 유료버전은 다음 유료 배포 때 반영된다.
- `SettingsPage.tsx`: PGVector 탭 제거, `PGVectorTab.tsx` 삭제.
- 프런트 `api/settings.ts`, 서버 `routes/settings.ts`, `settingsStore.ts`: PGVector 설정 조회·저장 제거.
  이 값을 읽어 DB에 연결하는 코드는 없었다(저장만 하고 쓰이지 않는 설정).
- `messages.ts`의 `pgRuntime`, `pgRuntimeCopy` 삭제(번역 카탈로그 JSON의 잔여 항목은 그대로 둠).
- `scripts/verify-pdfit.mjs`: PGVector 저장 검증을 "라우트가 404"로 대체.
- 문서: docs/02, apps/pdfit docs(api, architecture, overview, testing, usage), README(영·한), packages/pdfit/docs/internals.

## 실행 결과

| 항목 | 결과 | 증거 |
|---|---|---|
| `npm run build` | `Tasks: 4 successful, 4 total` | `build.log` |
| `npm run verify:repo` | `verify:repo passed` | `verify-repo.log` |
| 배포 전 백업 | `predeploy-backup-settings-20261110.sql`, 161213 bytes, COPY 12개, SHA-256 `d89de3f0d685d5f627fe55ce3a65ec2f430048a4f46309e080f99962b1a6e112` | `backup.sha256` |
| `npm run deploy:standalone` | exit 0, `Library index ready: 719 PDFs across 2 folders`, healthy, 재시작 0 | `deploy.log` |
| 행 수 | 배포 전후 동일 (books 719, book_tags 1319, tags 127, bookmarks 8, viewer_state 27, app_settings 2, folders 2 …) | `counts-before.txt`, `counts-after.txt` |
| API | `/api/settings/pgvector` 404, `/api/settings/ai-servers` 200 | 터미널 출력 |
| 브라우저 | 아이콘 `LanguageIcon`, 이름 `언어`, 대화상자에 언어·테마 컨트롤, 설정 탭 `["AI 서버"]`, 콘솔 오류 0 | `settings-globe.json`, `header.png`, `settings.png` |

## 확인하지 못한 것

- 유료버전 화면(이번에 재배포하지 않음).
- 다른 언어(영어 등)에서의 툴팁 표시: `t('language')`의 기존 번역을 그대로 쓴다.
