# 테스트 보고서: 즐겨찾기

- 실행 시각: 2026-11-20 KST
- 환경: Windows 11, Docker Compose `pdfit`(Free, `127.0.0.1:15203`), Playwright(headless Chromium)
- 계획: `apps/pdfit/tests/plans/favorites-20261120.md`
- 요구 기준(원문): 계획서 "요구 기준" 인용 참조

## 결과

| 검증 | 결과 |
|---|---|
| `tsc -p tsconfig.json`, `tsc -p tsconfig.front.json` (noEmit) | PASS |
| `npm run deploy:standalone` (빌드, 이미지 재빌드, 컨테이너 재생성, 색인 720 PDF) | PASS |
| `node --test packages/pdfit/tests/favorites.test.mjs` (호스트) | PASS 2, SKIP 1(DB URL 없음) |
| 같은 테스트를 컨테이너 안에서 `PDFIT_TEST_DATABASE_URL` 지정 실행 | PASS 3/3 (격리 스키마, 실행 후 `favorites_*` 스키마 0개) |
| `favorites-browser.mjs` A(API) | PASS — 미색인 책 PUT은 `favorite:false`, 켜면 목록 +1, `/books` 레코드에 태그 포함, 끄면 원복 |
| `favorites-browser.mjs` B(화면) | PASS — 사이드바 항목이 태그 섹션보다 앞, 배지 = API(0 → 1 → 0), 카드 별 `aria-pressed` false→true·라벨 전환, 목록 행도 true, `/favorites` 제목·칩 1건, 거기서 별을 끄면 행·배지 감소, `pageerror` 0 |
| `untagged-browser.mjs` (사이드바 변경 회귀) | PASS — 배지 4 = 칩 4 = 행 4 |
| `npm run verify:repo` | PASS |
| 컨테이너 상태 | `healthy`, 최근 20분 로그 error/fatal 0줄 |
| 테스트 후 실데이터 | `GET /api/favorites` = `[]` (시작 전과 동일) |

증거: `apps/pdfit/tests/reports/favorites/20261120_favorites/` (`sidebar.png`, `card-on.png`, `row-on.png`, `favorites-page.png`).

## 검증하지 못한 것

- 실제 파일 삭제 → 감시기 → purge 경로는 실제 라이브러리 파일을 지울 수 없어 실행하지 않았다. `purgeFile`/`purgeFolder`가 즐겨찾기 행을 지우는 것은 PostgreSQL 테스트로만 확인했고, 감시기·삭제 라우트가 이를 부르는 것은 기존 코드 경로(소스 대조)다.
- `tag-page-view-browser.mjs`는 Pro 출처(`127.0.0.1:15201`)를 대상으로 해 Free 배포만 올린 상태에서는 연결 거부로 실행되지 않았다(변경과 무관, 미실행).
- Pro(`apps/service`) 빌드·배포는 하지 않았다. 해당 저장소는 즐겨찾기를 구현하지 않아 501 → UI 숨김이 설계 동작이며, 그 경로는 호스트 테스트(501)로만 확인했다.

## 기각된 가설

- 별을 페이지가 내려주는 prop으로 구현하면 `cardPropsEqual` 메모와 모든 페이지(폴더·태그·검색)의 수정이 필요해 보였으나, 카드가 모델을 직접 구독하는 방식으로 바꿔 페이지 수정 없이 일관된 상태를 얻었다.
- 컨테이너 안 테스트가 처음 실패한 것은 구현 결함이 아니라 컨테이너의 `dist`가 앱 번들 레이아웃이라 `server/routes/favorites.js`가 없었기 때문이다(패키지 `dist`를 함께 복사해 해결).
