# 태그 탐색 및 전체 선택 일괄 태그

환경: Docker service http://127.0.0.1:15201, Chromium, local-preview 로그인.
실행: node apps/pdfit/tests/tag-page-view-browser.mjs 및 node apps/pdfit/tests/bulk-manual-tag-browser.mjs
태그 탐색에서 새로고침/목록/표지 전환 및 선택/이동/삭제 부재 확인. 폴더 cvzxv에서 미선택/일부 선택일 때 태그관리 부재, 전체 선택 시 밑줄 버튼 표시, 모든 대상 파일 태그 추가 요청 및 결과 안내, 전체 선택 해제 시 버튼 숨김 확인. 일괄 추가 API는 fixture로 대체하여 실제 데이터 변경하지 않는다.
