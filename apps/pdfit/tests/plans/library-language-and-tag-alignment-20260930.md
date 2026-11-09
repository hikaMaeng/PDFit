# 언어 변경과 태그 열 정렬 검증 계획

## 환경과 실행

Windows 11, 루트 Docker Compose `service`, Chromium 1440×900 및 390×844.
실제 사용자 데이터를 쓰지 않는 `/api/**` 모의 응답을 사용한다.

`npm run build --workspace=@pdfit/pdfit`, `npm run build --workspace=service`,
`docker compose up -d --build --wait --wait-timeout 30 service` 후
`node apps/pdfit/tests/viewer-tags-free-tier-browser.mjs`와
`node apps/service/tests/language-switch-browser.mjs`,
`npm run test:language --workspace=service`를 실행한다.

## 통과 조건

- 언어 메뉴에 인터넷 이용자 상위 10개 언어와 한국어·일본어가 표시된다.
- 언어 변경 즉시 문서 `lang`, 아랍어 `dir`, 목록 헤더, 문서 정보,
  태그관리 버튼, 설정 모달의 문구가 바뀌고 새로고침 뒤에도 유지된다.
- 로그인 전 화면에서도 12개 언어의 제목과 주요 문구가 바뀌며 재방문해도 유지된다.
- 문서 파일명·태그명은 번역과 무관하게 원래 값을 유지한다.
- 태그가 있는 행과 없는 행의 태그관리·AI 버튼 x 좌표가 같다.
- 태그관리 텍스트에 밑줄이 있고 태그 버튼 클릭 기능은 유지된다.
- 표지 작업 버튼과 체크박스 간격은 데스크톱·모바일에서 동일하다.
- 기존 무료/유료 작업, 삭제·이동, 고정 영역, 메타데이터 모달이 정상 동작한다.

결과와 스크린샷은 `viewer-tags-free-tier`, `language-switch` 및 이 계획의
타임스탬프 보고서에 기록한다.
