# 확인창 문구 배치 검증 계획

- 대상: AI 자동 태그 안내 한 줄, 태그 전체 초기화 안내 물음표 뒤 줄바꿈 두 건만 확인한다.
- 환경: Windows 11, `pdfit` 프런트 빌드 및 로컬 Docker `service`, Playwright Chromium 1280×800·768×800 한국어 화면.
- 절차: 태그 없는 문서 60개가 있는 폴더를 열어 AI 확인창의 문구가 한 줄인지 요소 높이와 줄 높이로 비교한다. 태그 전체 초기화 확인창에서 물음표 뒤 개행과 정확히 두 줄의 높이를 확인한다.
- 실패 기준: AI 문구가 두 줄 이상이거나 초기화 문구가 물음표 뒤에서 줄바꿈되지 않으면 실패한다.
- 실행: `npm run build --workspace pdfit`; `node apps/pdfit/tests/dialog-copy-layout-browser.mjs`; Docker 화면은 `$env:PDFIT_TEST_ORIGIN='http://127.0.0.1:15201'; node apps/pdfit/tests/dialog-copy-layout-browser.mjs`.
