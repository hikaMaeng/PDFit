# 문서 목록 열 간격 및 문서 정보 레이블

## 환경 및 실행

Windows 11, root Docker Compose service http://127.0.0.1:15201,
Chromium 1440×900 및 390×844. 기존 모의 API 테스트로 실제 문서는 변경하지 않는다.

두 workspace 빌드 및 Docker Compose 갱신 후
`node apps/pdfit/tests/viewer-tags-free-tier-browser.mjs`를 실행한다.

## 통과 조건

- 데스크톱 열린시간·태그·파일 크기의 열 폭이 동일하고 열 시작 위치 간격이 같다.
- 세 열의 헤더·값은 같은 왼쪽 정렬이고 헤더·행 그리드가 일치한다.
- 파일명 바로 옆에 아이콘과 `문서 정보` 레이블이 함께 보인다.
- 폴더·태그 목록에서 기존 정보창 열기가 정상이고 검색·선택·고정 영역이 유지된다.
- 모바일의 줄바꿈에서 가로 넘침이 없고 기존 무료/유료 태그 회귀가 통과한다.

증거는 tests/reports/viewer-tags-free-tier의 result.json 및 화면 캡처에 기록한다.
