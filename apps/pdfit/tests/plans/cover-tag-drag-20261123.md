# 표지 카드 태그 드래그 테스트

2026-11-23에 작성. Free Docker 서비스(`http://127.0.0.1:15203`)와 Chrome에서 실행한다.

1. `npm run deploy:standalone`으로 해당 버전을 실행하고 `/health`와 Docker 상태를 확인한다.
2. `PDFIT_TEST_ORIGIN`과 `PDFIT_TEST_ARTIFACT_DIR`을 지정하고 `node apps/pdfit/tests/cover-tag-drag-browser.mjs`를 실행한다. 각 시나리오는 새 브라우저 컨텍스트에서 테스트 문서와 태그의 API 응답을 사용한다.
3. 목록 제목, 마우스를 올린 표지, 상세 정보가 고정된 표지, 카드 제목, 검색 결과 표지에서 왼쪽 폴더 안 태그로 실제 마우스 드래그를 실행한다.
4. 드롭마다 올바른 책과 태그의 POST 200, 사이드바 개수 증가, 현재 카드 및 대상 태그 화면의 갱신, 페이지 오류가 없음을 확인한다.
5. `node apps/pdfit/tests/tag-folder-drag-browser.mjs`를 실행한다. 태그 이름을 다른 폴더의 빈 본문, 기존 태그 행, 접힌 폴더 제목에 드롭한다. PUT 200, 원본과 대상 폴더의 소속 표시, 새로고침 후 저장 상태를 확인한다. 마지막 시나리오는 PUT 응답 전에 저장 전 GET을 유도해도 응답 뒤 새 소속이 표시되는지 확인한다.

책 드래그는 파일명 링크 또는 `pdf-cover-card` 안의 `pdf-cover-info-overlay`에서 `lnb-folder-tag-row` 안의 태그 이름으로 드롭한다. 책 자체의 태그는 `pdf-cover-tags` 또는 `pdf-tag-values`에서 확인한다. 폴더 드래그는 `lnb-tag-folder` 안에서 이름이 일치하는 폴더 버튼, 태그 이름, 빈 본문의 안내 문구를 사용한다. 각 스크립트가 요청 상태와 화면 결과를 출력하며 `PDFIT_TEST_ARTIFACT_DIR`에 성공 또는 실패 화면을 저장한다.
