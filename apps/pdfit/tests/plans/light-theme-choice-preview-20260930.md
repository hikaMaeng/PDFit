# 라이트 테마 4안 미리보기·문서 정보 아이콘·태그 글자 검증

## 환경

Windows 11, 루트 Docker Compose `service`, Chromium 1440×900·390×844.
실제 사용자 데이터를 사용하지 않고 `/api/**` 모의 응답으로 서재를 표시한다.

## 실행

1. `npm run build --workspace=@pdfit/pdfit`
2. `npm run build --workspace=service`
3. `docker compose up -d --build --wait --wait-timeout 30 service`
4. `node apps/pdfit/tests/viewer-tags-free-tier-browser.mjs`
5. `node apps/pdfit/tests/viewer-toolbar-export-browser.mjs`

## 통과 조건

- 문서 정보는 테두리·배경 없는 파란 아이콘 하나로 표시되며 툴팁·접근성 이름과 클릭 기능을 유지한다.
- 작은 태그 칩은 12px 글자, 22px 높이이고 기존 열 정렬과 모바일 레이아웃이 유지된다.
- 실제 PDFit 목록에 4개 라이트 색상 CSS 미리보기를 순차 적용해 스크린샷을 만든다.
- 미리보기 스타일은 각 캡처 뒤 제거하며 선택 전까지 실제 라이트 테마 설정값은 변경하지 않는다.
- 다크 모드와 기존 문서·태그 작업 회귀 검사가 통과한다.
- 태그 색상 선택지 25개 중 새로 추가한 갈색을 저장하고 칩에 반영한다.
- 태그 칩과 태그관리 간격을 약 3/5로 줄이고, 태그가 없는 행과 작업 위치를 맞춘다.
- 폴더 삭제 확인 문구에서 PDF 대신 문서를 사용한다.
- 다운로드 확인창의 파일명 앞 PDF 아이콘을 제거하고 안내 문구를 `이 문서를 기기에 다운로드합니다.`로 표시한다.

## 결과

`apps/pdfit/tests/reports/light-theme-choices/20260930_000000/`의 A~D PNG와
타임스탬프 보고서를 확인한다.
