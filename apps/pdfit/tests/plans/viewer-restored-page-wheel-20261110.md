# 뷰어 복원 페이지 첫 휠 이동

## 목적

저장된 마지막 페이지로 열린 책에서, 이전/다음 버튼을 한 번도 누르지 않고 마우스 휠만 사용해도 복원된 페이지를 기준으로 다음 페이지로 이동하는지 검증한다.

## 결함

PDF.js 뷰어(`components/PdfViewer`)가 문서를 열 때 복원 페이지를 `currentPage`에는 반영하지만 휠·키 판정에 쓰는 `interactionRef.page`는 1로 남겼다. 복원 시 `goToPage`도 건너뛰므로 첫 휠이 `1→2`로 이동했다.

## 절차

1. `npm run deploy:standalone`으로 빌드하고 Free 컨테이너를 재생성한다.
2. 저장 상태(5페이지, `single` / `double`)를 모킹한 8페이지 PDF를 `/viewer/...`로 연다.
3. 페이지 입력이 5로 복원되었는지 확인한다.
4. 이전/다음 버튼 클릭 없이 휠을 한 번 내린다.
5. `node apps/pdfit/tests/viewer-restored-page-wheel-browser.mjs`를 수정 전·후 배포본에 각각 실행한다.

## 기대 결과

- `single`: `5→6`, `double`: `5→7`.
- 수정 전 배포본에서는 `5→2`로 실패해야 한다(회귀 감지력 확인).
- 페이지 오류 이벤트 없음, 컨테이너 `healthy`.
