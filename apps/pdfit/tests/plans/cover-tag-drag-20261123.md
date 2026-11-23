# 표지 카드 태그 드래그 테스트

2026-11-23에 작성. Free Docker 서비스(`http://127.0.0.1:15203`)와 Chrome에서 실행한다.

1. `npm run deploy:standalone`으로 해당 버전을 실행하고 `/health`와 Docker 상태를 확인한다.
2. `node apps/pdfit/tests/cover-tag-drag-browser.mjs`를 실행한다. 각 시나리오는 새 브라우저 컨텍스트에서 테스트 문서와 태그의 API 응답을 사용한다.
3. 목록 제목, 마우스를 올린 표지, 상세 정보가 고정된 표지, 카드 제목에서 왼쪽 태그로 실제 마우스 드래그를 실행한다.
4. 각 드롭에서 올바른 책과 태그의 POST 200, 사이드바 개수 증가, 대상 태그 화면의 문서 표시, 페이지 오류가 없음을 확인한다.

출발점은 파일명 링크 또는 `pdf-cover-card` 안의 `pdf-cover-info-overlay`를 사용한다. 도착점은 `lnb-tag-row` 안의 정확한 태그 이름이다. `PDFIT_TEST_ARTIFACT_DIR`에 성공 화면이나 실패 화면을 저장한다.
