# 문서 목록 고정 영역 및 선택 작업 검증

## 환경

Windows 11, 루트 Docker Compose의 service, Chromium, 1440×900 및 390×844.
기존 viewer-tags-free-tier-browser.mjs의 API 모킹을 사용하여 실제 문서 변경 없이
36개 이상의 문서 목록으로 스크롤을 재현한다.

## 절차와 기대 결과

1. 폴더 목록을 아래로 스크롤한다. 제목은 이동하고 선택 도구 모음과
   이름/열린시간/태그 헤더는 함께 main 상단에 고정된다.
2. 왼쪽 메뉴의 위치는 문서 스크롤 전후 동일하고 body는 스크롤되지 않는다.
3. 태그 목록에서도 같은 고정 동작을 확인한다.
4. 두 문서를 선택한다. 배지 없이 `2개 선택됨` 텍스트와
   `폴더 이동`, `삭제` 레이블 버튼이 나타난다.
5. 모바일 줄바꿈 상태에서도 헤더와 선택 도구가 겹치거나 가로로 넘치지 않는다.
6. AI 자동 태그 옆 폴더 삭제 버튼은 없고 선택 삭제 및 이동 확인창은 정상 동작한다.
7. 기존 무료/유료 AI 태그, 검색, 태그 관리, 표지 보기 회귀 검증을 실행한다.
8. 태그 오른쪽 파일 크기 헤더·값 정렬과 파일명 옆 아이콘만 표시되는 문서 정보
   버튼을 확인한다. 폴더·태그 화면에서 기존 정보창을 열 수 있어야 한다.
   태그 목록의 폴더 위치 배지는 없고 실제 폴더는 유지돼야 한다.
9. 제목 아이콘 간격은 두 화면 모두 8px, 태그 개수 배지는 폴더와 같은 4px 사각형이다.
10. 체크박스·파일명 간격은 데스크톱 16px이고 태그 해제 확인 문구에 PDF가 없다.

## 실행

`npm run build --workspace=@pdfit/pdfit`, `npm run build --workspace=service`,
`docker compose up -d --build --wait --wait-timeout 30 service` 후
`node apps/pdfit/tests/viewer-tags-free-tier-browser.mjs`.
결과와 스크린샷은 tests/reports/viewer-tags-free-tier에 기록한다.
