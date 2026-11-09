# 문서 목록 가운데 정렬·문서 정보 강조·라이트 팔레트 검증

## 환경

Windows 11, 루트 Docker Compose `service`, Chromium 1440×900 및 390×844.
브라우저 요청 `/api/**`는 사용자 데이터를 건드리지 않는 모의 응답으로 처리한다.

## 실행

1. `npm run build --workspace=@pdfit/pdfit`
2. `npm run build --workspace=service`
3. `docker compose up -d --build --wait --wait-timeout 30 service`
4. `node apps/pdfit/tests/viewer-tags-free-tier-browser.mjs`
5. 결과 스크린샷과 브라우저 오류를 검토한다.

## 통과 조건

- 목록 네 열 제목이 각 열 가운데에 정렬되고, 열린시간·태그·태그관리·AI·파일 크기 값이 정렬된다.
- 태그가 없는 행과 있는 행에서 태그관리와 AI 버튼의 x 좌표가 같다.
- 파일명은 읽기 쉬운 왼쪽 정렬을 유지한다.
- 문서 정보 버튼은 파일명 옆에 있으며 글자색·배경·테두리가 파일명과 구분된다.
- 라이트 모드 캔버스가 회색이 아닌 절제된 푸른색이고, 본문·구분선·버튼 대비가 유지된다.
- 모바일에서 가로 넘침이 없고 다크 모드 및 기존 작업 기능이 유지된다.

## 기록

`apps/pdfit/tests/reports/viewer-tags-free-tier/20260929_000000/`의
`library-light-blue-palette.png`, `list-centered-columns-document-info.png`,
`tag-actions-aligned-with-and-without-tag.png`, `result.json`을 확인한다.
