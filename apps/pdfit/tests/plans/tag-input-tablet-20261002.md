# 태그 입력과 색상 검증

Windows 11, root Docker Compose service healthy, http://127.0.0.1:15201.
공유 패키지 및 서비스 프런트·서버 빌드, Docker 갱신 후 `node apps/pdfit/tests/tag-input-tablet-browser.mjs` 실행.
Chromium 및 WebKit의 터치·모바일 1024×1180 환경에서 태그관리 입력 전 라벨·테두리 회색, 포커스 파랑, IME Enter 무시, Enter 추가, 버튼 추가, 기본 파랑·선택 빨강 PATCH 요청, 추가 후 파랑 초기화 검증. 변경 API는 가로채 실제 서재를 수정하지 않는다.
`node --test --test-name-pattern='new tags default' packages/pdfit/tests/ai-tagging.test.mjs`로 기본색 및 중복색·사용자색 보존 검증.

2026-10-06 추가 기준: 초기 input 미포커스, 라벨·테두리 회색, hover 시 둘 다 파란색, 추가 버튼 빈 입력에서도 활성 및 파란색. 빈 입력 클릭은 포커스만 이동하고 API 요청 없음.

2026-10-06 추가 검증: 저장 요청을 gate로 지연해 새 태그 칩 부재 및 버튼 비활성 확인, 성공 뒤에만 칩 표시. 사용자 빨강 선택은 추가 후·새로고침 재진입에도 유지. 폴더 새로고침 전 row element가 완료 후에도 연결되어 전체 목록 재마운트가 없는지 확인. API mutation은 fixture로 가로챈다.
