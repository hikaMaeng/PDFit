# LNB·검색·베이지 테마·헤더 검증

환경: Windows 11, 루트 Docker Compose service, http://127.0.0.1:15201, Chromium, 한국어.

1. 공유 패키지 TypeScript와 서비스 프런트·서버를 빌드하고 런타임을 동기화한다.
2. 루트에서 `docker compose up -d --build --wait --wait-timeout 60 service`로 갱신한다.
3. `node apps/pdfit/tests/lnb-search-beige-browser.mjs`를 실행한다. 1280×800 및 1024×1180에서 LNB 이름, 초기화 버튼 부재, 마이클립 이동, 헤더 왼쪽 정렬, 버튼 간격 12px, 문서 수 위치, 검색 위치, 결과 수 제거, 빈 결과 문구와 아이콘, 검색어 지우기를 확인한다.
4. `node apps/pdfit/tests/lnb-bookmarks-icon-browser.mjs`로 클립 아이콘·레이블·선택 상태를 확인한다.
5. `node apps/pdfit/tests/viewer-light-canvas-browser.mjs` 및 같은 명령에 `--gpu`를 붙여 두 엔진의 라이트·다크 모드, 보기 전환, 클립 패널, 다른 탭과 테마 동기화를 확인한다. 뷰어 API는 테스트 PDF로 가로채 실제 데이터를 변경하지 않는다.
6. Docker 로그와 스크린샷을 확인한다. 모든 assertion 통과 및 pageerror 없음이 성공 기준이다.

추가 검증: 헤더 순서 5개와 left 정렬, 문서정보 밑줄과 별도 열 위치, 올해·과거 날짜를 테스트 브라우저의 계정별 localStorage에 넣어 결과 확인, 표지보기의 열린시간, AttachFile 아이콘, 마이클립 흰색, 계정 하단 글자 색 확인. 검색은 AI 자동태그 왼쪽에 있어야 한다.

최종 표지보기 기준: 목록 열 헤더 없음, 파일명 앞 체크박스 선택·해제 정상, 하단 두 그룹에 버튼 각각 2개, 구분선 opacity 0.7. AI 자동태그와 보기 전환 그룹 간격 24px, LNB rgb(255,241,217), 클립 아이콘 색 동일.
