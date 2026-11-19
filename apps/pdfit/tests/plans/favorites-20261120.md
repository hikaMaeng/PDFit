# 즐겨찾기

## 요구 기준 (사용자 요청 원문)

> 좌메뉴의 태그보다 더 위에 즐겨찾기를 신설한다.
> 새로운 별아이콘이 각 카드에 추가되며 칸이 차있는 거나 비워지는 식으로 토글된다. 즐겨찾기 마킹한 항목만 모아서 보여주는 기능이다.
> 기본적으로 db정보로만 작동하며 실제 파일이 존재하는지는 기존에 존재하는 파일 점검 시점에만 동기화된다

## 해석

- 사이드바 "즐겨찾기" 항목이 태그 섹션 머리글보다 위에 있다(개수 배지 포함).
- 모든 표지 카드(좌상단)와 목록 행(파일명 앞)에 별이 있고, 빈 별 ↔ 채운 별로 토글된다.
- `/favorites` 보기는 표시한 책만 모은다. 목록·토글 모두 DB(`book_favorites` + `books`)만 읽고 쓴다.
- 파일 존재 동기화 = 기존 점검 지점(감시기 삭제 처리, 파일·폴더 삭제, 이동)의 `purgeFile`/`purgeFolder`. 새 점검을 만들지 않는다.
- 범위 밖: Pro(호스팅) 저장소 구현(501이면 UI 숨김), 이동 시 즐겨찾기 승계, 즐겨찾기 정렬 변경.

## 절차

1. `npm run deploy:standalone`.
2. `node --test packages/pdfit/tests/favorites.test.mjs`(라우트·이벤트·501). 컨테이너 안에서 `PDFIT_TEST_DATABASE_URL`을 줘 PostgreSQL 동작(books에 없는 책 불가, syncBooks 유지, purge 삭제)을 격리 스키마에서 검증.
3. `PDFIT_TEST_CHANNEL=chrome node apps/pdfit/tests/favorites-browser.mjs` (실제 책 하나를 켰다 끄고 원복).
4. 회귀: `untagged-browser.mjs`(사이드바 변경), `npm run verify:repo`.
5. 컨테이너 `healthy`, 최근 로그 error/fatal.

## 합격 기준

- 사이드바 항목이 태그 섹션보다 앞(DOM 순서)이고 배지 = `GET /api/favorites` 길이.
- 카드·행 별의 `aria-pressed`가 토글에 따라 바뀌고 서버에 반영된다.
- 즐겨찾기 보기에서 별을 끄면 행과 배지가 즉시 줄어든다.
- `books`에 없는 책은 켜지지 않고, purge는 즐겨찾기 행을 지운다.
