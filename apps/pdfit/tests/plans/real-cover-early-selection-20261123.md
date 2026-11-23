# 표지 검색 중 후보 선택 검증

## 목표와 환경

2026-11-23. Free Docker UI와 Chrome 헤드리스에서 검증한다. 로컬 테스트 서버는 배포된 UI를 제공하고, 표지 요청에는 실제 `createCoversRouter`와 임시 표지 저장소를 연결한다. YES24는 후보 한 건을 응답한다. Open Library는 취소 또는 시간 초과까지 대기하며 별도 단계에서 503을 응답한다.

## 절차와 기대 결과

1. `npm run test:covers`로 기존 검색, 적용, 썸네일, 복원 동작을 확인한다. 배포 뒤 `GET /health`가 200을 반환하는지 확인한다.
2. `node apps/pdfit/tests/real-cover-early-selection-browser.mjs`를 실행한다. `PDFIT_TEST_ORIGIN` 기본값은 `http://127.0.0.1:15203`이다. `PDFIT_TEST_ARTIFACT_DIR`을 지정하면 화면을 저장한다.
3. 검색 스피너가 보일 때 첫 후보를 클릭한다. 브라우저의 Open Library 검색 요청이 `ERR_ABORTED`로 끝나고 서버 외부 조회가 `AbortError`로 중단된다. 적용 요청이 즉시 시작되며 적용 중에는 후보와 검색 버튼이 비활성화된다.
4. 첫 적용 응답을 404로 돌려준다. 적용 오류가 보이고 같은 후보를 다시 선택할 수 있다. 취소한 출처의 경고가 나타나지 않는다. 재시도는 후보 검색을 반복하지 않고 200을 반환한다.
5. 새 검색 중 후보를 다시 선택한다. 적용이 200으로 끝나고 대화상자가 닫힌다. 카드 썸네일의 `c` 값과 저장된 표지가 갱신된다.
6. 대화상자를 열고 검색 중 닫아 브라우저와 서버 취소를 확인한다. 다음에 열었을 때 503 응답은 출처 경고로 표시되고 YES24 후보는 선택 가능하다.

## 화면 식별과 증거

카드의 `pdf-cover-real-cover`로 열고, `Use a real book cover` 이름의 `dialog`에서 `Use cover: Early Cover (YES24)` 버튼, 검색·적용 상태 텍스트, `alert`를 확인한다. 썸네일 영역은 `pdf-cover-thumbnail`로 찾는다. 부분 결과, 적용 중, 적용 후 화면과 브라우저·서버의 취소 결과를 기록한다.
