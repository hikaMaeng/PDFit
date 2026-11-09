# 문서 선택 수와 보관함 메뉴 표시 검증

## 환경

- Windows 11, Docker Compose `service`, Chromium/Playwright
- 로컬 주소: `http://127.0.0.1:15201`
- 동일 이름 PDF 2개(서로 다른 Drive ID)와 다른 이름 PDF 1개를 포함한 브라우저 픽스처

## 절차

1. `npm run build --workspace @pdfit/pdfit`와 `npm run build --workspace service`가 성공하는지 확인한다.
2. `docker compose up -d --build --wait --wait-timeout 60 service`로 최신 빌드를 실행하고 정상 상태를 확인한다.
3. `node apps/pdfit/tests/duplicate-document-selection-browser.mjs`를 실행한다. 태그별 목록과 폴더 목록에서 같은 이름 두 줄이 서로 독립적으로 선택되는지, 선택 수가 체크된 행 수와 일치하는지 확인한다.
4. `node apps/pdfit/tests/lnb-bookmarks-icon-browser.mjs`를 실행한다. 데스크톱과 태블릿 크기에서 보관함 글씨는 숨기고 아이콘·접근성 이름·화면 이동은 유지하는지 확인한다.
5. 뷰어 높이 맞춤과 라이트 모드 회귀 테스트를 실행한다.
6. 새 배포 ZIP의 해시, 내부 이미지 해시, 설정의 민감 값, Compose 구성을 확인한다.

## 통과 조건

- 같은 이름의 문서라도 세 줄을 체크하면 `3개 선택됨`으로 표시된다.
- 보관함 메뉴에 가시적인 글씨는 없고 버튼 기능과 접근성 이름은 유지된다.
- 빌드, Docker, 브라우저 테스트 및 ZIP 무결성 검사가 모두 통과한다.
