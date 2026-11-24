# 책·태그 드래그 입력 검증

2026-11-24 작성. 책 카드에서 태그를 추가하고 사이드바 태그를 폴더에 넣는 동작을 Windows Chrome과 Free Docker에서 검증한다.

1. `PDFIT_TEST_ORIGIN`과 `PDFIT_TEST_ARTIFACT_DIR`을 지정한다. 수정 전후에 `node apps/pdfit/tests/cover-tag-drag-browser.mjs`와 `node apps/pdfit/tests/tag-folder-drag-browser.mjs`를 실행한다. 두 스크립트의 쓰기 응답은 브라우저 픽스처에서 제공한다.
2. 820px 마우스 및 390px 터치 화면에서 닫힌 사이드바가 책 드래그 중 열리는지 확인한다. 폴더 제목 위에서 기다려 내부 태그가 나타나면 태그에 드롭한다. 터치 취소 시 사이드바가 닫히고 이어지는 드래그가 성공해야 한다.
3. 휴대폰 뷰포트의 사이드바에서 폴더 안 태그의 손잡이를 끌어 다른 폴더 제목에 놓는다. 소속이 양쪽에 표시되고 재접속 후에도 대상에 남아야 한다. 데스크톱에서 빈 본문, 기존 태그 행, 접힌 제목으로 놓는 경로와 저장 중 갱신을 확인한다.
4. 독립 Free Docker에 테스트 PDF 두 권을 색인한다. 테스트용 태그와 폴더로 책 태그 POST, 폴더 소속 PUT, 화면 반영, 새로고침 뒤 API 저장 상태를 확인한다. 운영에서는 스크립트의 픽스처를 사용한다.

태그와 폴더 제목은 정확한 이름으로 찾는다. 손잡이는 `pdf-cover-drag-handle` 또는 `lnb-tag-drag-handle`과 번역된 접근성 이름을 사용한다. HTTP 상태, 페이지 오류, 스크린샷과 Docker `/health`를 기록한다.
