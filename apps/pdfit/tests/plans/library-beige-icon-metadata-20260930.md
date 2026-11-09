# 베이지 라이트 모드·아이콘 전용 문서 정보 검증

## 환경과 실행

Windows 11, 루트 Docker Compose `service`, Chromium 1440×900·390×844,
실제 사용자 데이터를 쓰지 않는 `/api/**` 모의 응답.

`npm run build --workspace=@pdfit/pdfit`, `npm run build --workspace=service`,
`docker compose up -d --build --wait --wait-timeout 30 service` 후
`node apps/pdfit/tests/viewer-tags-free-tier-browser.mjs`를 실행한다.

## 통과 조건

- 라이트 모드 본문은 베이지 `#eee9df`, 왼쪽 메뉴는 웜 차콜 `#34322e`이다.
- 표면·구분선·보조 글씨는 같은 따뜻한 계열이며 파란색은 버튼·아이콘의 강조색으로 남는다.
- 문서 정보 버튼은 파일명 옆의 아이콘만 표시하며, 번역된 `aria-label`과 툴팁을 가진다.
- 클릭하면 기존 문서 정보 창이 열리고 언어 변경 시 접근성 이름도 바뀐다.
- 목록 정렬, 태그 작업 위치, 다크 모드, 모바일 레이아웃 및 기존 작업 흐름은 유지된다.

## 결과 기록

타임스탬프 보고서와 `viewer-tags-free-tier/20260929_000000/` 아래
`library-light-beige-palette.png`, `list-centered-columns-document-info.png`,
`result.json`을 확인한다.
