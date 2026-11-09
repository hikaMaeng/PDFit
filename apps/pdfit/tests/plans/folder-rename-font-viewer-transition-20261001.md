# 폴더 이름 변경·문서 목록·뷰어 전환 검증

## 목적

기본 폴더와 일반 폴더의 이름을 변경하고 기본 폴더 삭제 보호를 유지한다. 문서 목록 파일명에는 다른 한글 글꼴을 보통 두께로 적용하고 이름 열을 소폭 넓힌다. PDF.js 뷰어에서 두 페이지 보기→연속 스크롤 전환 시 PDF를 다시 요청하지 않고 현재 페이지를 즉시 보여 준다.

## 환경

- Windows 11, Docker Compose `service`, `http://127.0.0.1:15201`
- Node/TypeScript 빌드, Playwright Chromium
- 브라우저 이름 변경은 PATCH 요청을 가로채 응답하는 테스트 전용 모의 변경. 실제 Google Drive 폴더는 변경하지 않는다.
- 뷰어 테스트는 6페이지 합성 PDF를 브라우저 응답으로 제공한다.

## 절차와 판정

1. `npm run build --workspace=@pdfit/pdfit`, `npm run build --workspace=@pdfit/service_domain`, `npm run build --workspace=service` 통과.
2. `npm run test:indexing-pipeline --workspace=service`: 기본 폴더 이름 변경 결과의 `isRoot=true`, 중복 이름 거부, 기본 폴더 삭제 거부.
3. `docker compose up -d --build --wait --wait-timeout 60 service`로 서비스가 Healthy.
4. `node apps/pdfit/tests/folder-rename-font-browser.mjs`: 기본·일반 폴더 연필 버튼, 기본 폴더 휴지통 부재, 저장 뒤 폴더 경로와 제목 변경, 파일명 Noto Sans KR 및 `font-weight: 400`, 이름 열 2.7배 이상.
5. `node apps/pdfit/tests/viewer-layout-scroll-browser.mjs`: 두 페이지에서 연속 스크롤 전환 후 현재 두 페이지 캔버스 캐시 재사용, PDF GET 1회, 페이지 번호·헤더 레이아웃 유지.
6. `node apps/pdfit/tests/tablet-library-layout-browser.mjs` 및 `node apps/pdfit/tests/library-toolbar-root-guard-browser.mjs`: 데스크톱/태블릿 헤더 정렬 및 기존 테마·삭제 보호 회귀 확인.
7. 스크린샷 육안 확인 및 `git diff --check`.
