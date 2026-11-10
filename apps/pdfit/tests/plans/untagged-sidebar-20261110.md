# 사이드바 "미분류" 항목

## 요구 기준 (사용자 요청 원문)

> 태그의 젤 첫번째 아이템으로 미분류 라는 항목을 넣어서 아무런 태그가 없는 아이템을 볼 수 있는 기능을 추가한다.

## 해석

- 사이드바 태그 목록의 **첫 항목**이 "미분류"다(실제 태그 앞, 항상 표시).
- 그 항목을 열면 **태그가 하나도 없는 문서**만 목록으로 보인다.
- 범위 밖: 미분류 항목으로 문서를 끌어다 놓기, 미분류 항목 삭제·색 지정(실제 태그가 아니므로 제공하지 않는다).

## 구현 요약

- 서버: `MetadataStore.listUntaggedBooks?/countUntaggedBooks?`(선택 구현), `GET /api/tags/untagged-books`, `GET /api/tags/untagged-count`(미구현 저장소는 501). Postgres는 `NOT EXISTS (book_tags)`로 계산한다.
- 클라이언트: `tagsApi.listUntaggedBooks/countUntaggedBooks`, 하이드레이트된 캐시용 `listCachedUntaggedBooks`, 경로 `/untagged`, `TagPage`의 `untagged` 모드, LNB 첫 행.

## 절차

1. `npm run deploy:standalone`으로 Free 컨테이너를 재생성한다.
2. 단위/통합: `node --test packages/pdfit/tests/untagged-books.test.mjs`(라우트, 실제 태그 `untagged-books`와의 비충돌, 501). `PDFIT_TEST_DATABASE_URL`을 준 컨테이너 내부 실행으로 PostgreSQL 쿼리(태그 추가·제거에 따른 목록 변화)를 격리 스키마에서 검증한다.
3. 독립 대조: 폴더별 `GET /api/tags/folder/:folder`(태그가 있는 파일만 반환)의 키 수와 폴더별 PDF 수의 차이를 합산해 `untagged-count`와 비교한다.
4. 브라우저: `PDFIT_TEST_CHANNEL=chrome node apps/pdfit/tests/untagged-browser.mjs`
   - A(실제 라이브러리, 읽기 전용): 첫 항목 위치·정확히 1행, 배지 = API 개수, `/untagged` 제목 칩·목록 행 수 = API 개수, 목록에 API의 모든 파일명 존재, 선택 상태 표시, 실제 태그 페이지에서 선택 해제.
   - B(서버 변경 응답 가로채기): 미분류 문서에 태그를 붙이면 목록·제목 칩·사이드바 배지가 줄고 나머지 문서는 남는다.
5. 기존 태그 사이드바 테스트 회귀 확인: `tag-unicode-order-browser`, `tag-grouped-navigation-browser`, `tag-delete-active-browser`, `viewer-tags-free-tier-browser`.
6. 컨테이너 `healthy`와 최근 로그의 error/fatal 확인.

## 합격 기준

- 위 요구 기준의 두 부분(첫 항목, 태그 없는 문서 목록)이 각각 확인된다.
- 사이드바 숫자, 제목 칩, 목록 행 수, API 개수, 폴더별 산술이 서로 일치한다.
- 기존 테스트 중 실패가 있으면 변경 전부터의 실패인지 구분해 기록한다.
