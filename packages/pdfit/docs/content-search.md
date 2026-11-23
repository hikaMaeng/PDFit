# 라이브러리 검색

## Tabs

사이드바에서 새 검색을 제출하면 `/search?q=`의 **제목** 탭이 먼저 열린다. Free에는 **목차**, **페이지 OCR**, **클립 OCR**, **클립 메모** 탭이 있다. 활성 탭이 자기 범위만 요청한다. 비활성 탭은 요청·건수 집계·PDF 읽기·OCR을 실행하지 않는다. 주소의 `scope`로 탭을 복원하며, 탭을 떠나면 브라우저 요청을 중단하고 늦게 온 응답을 버린다. 검색 결과에는 일치 문구, 문서, 폴더, 대상 페이지를 표시한다. 클립은 검색에 일치한 항목을 바로 열 수 있다.

## Indexes

| 탭 | 검색 단위와 원본 | 인덱스 및 갱신 |
| --- | --- | --- |
| 제목 | `books.filename`에서 확장자를 뺀 제목, `books.title_choseong` | 기존 NFC·대소문자 무시 부분 일치 / 공백 제거 초성 부분 일치. 목록 규모가 커지면 정규화한 제목·초성에 각각 `pg_trgm` GIN을 검토한다. 이때 `LIKE` 이스케이프, 영문·초성 혼합, 초성 1~2글자 일치를 보존한다. 짧은 검색어의 실행 계획과 쓰기 비용을 비교 후 적용한다. |
| 목차 | 저장한 목차의 항목 제목과 1부터 시작하는 페이지, `book_outlines.entries` | `book_outline_search`의 항목별 GIN. 기존 JSON 한 번 반영, 생성·갱신·비우기와 같은 트랜잭션에서 반영. 문서 크기·수정시각이 다른 목차와 판별된 과거 자동 페이지 번호 목차는 제외한다. |
| 페이지 OCR | 생성 완료된 텍스트 레이어 또는 OCR 결과의 페이지별 텍스트 | `book_page_ocr_search`의 페이지별 GIN. OCR 캐시 생성·재사용 시 반영. 첫 작업 계획 때 현 버전의 기존 JSON 캐시를 현재 도서 키와 대조해 복원한다. DB의 수정시각·크기와 맞는 경우에만 저장하고 파일 변경 또는 제거 시 무효화한다. 긴 결과의 인덱스는 페이지당 64,000 UTF-16 코드 단위까지 저장한다. |
| 클립 OCR | `bookmarks.ocr_text`와 클립 UUID, 페이지 | 완료 상태의 텍스트에 부분 GIN. OCR 저장과 결과 초기화·삭제를 DB 인덱스가 반영한다. |
| 클립 메모 | `bookmarks.comment`와 클립 UUID, 페이지 | 메모에 별도 부분 GIN. 메모 저장과 비우기·삭제를 DB 인덱스가 반영한다. |

본문 계열 첫 버전은 `pg_catalog.simple`과 NFC를 사용한다. 검색어를 단어로 나눠 한 목차 항목·페이지·클립에 모두 포함된 결과를 찾는다. 제목 탭의 부분 일치·초성은 제목에만 적용된다. 한국어 조사나 복합어를 나누는 품질은 현재 이미지의 `textsearch_ko`와 실제 한·영 혼합 문서의 정답 세트를 비교한 뒤 결정한다. 분석기를 바꾸면 조회와 인덱스를 같은 설정으로 전환한다. [PostgreSQL 17 인덱스](https://www.postgresql.org/docs/17/textsearch-indexes.html) · [텍스트 검색 함수](https://www.postgresql.org/docs/17/functions-textsearch.html) · [pg_trgm](https://www.postgresql.org/docs/17/pgtrgm.html)

검색은 순위·문서·페이지·레코드 키로 순서를 고정한다. 본문은 예시 문구를 최대 400자로 반환하고, 상위 100건을 기본으로 표시한다. 한 건을 추가로 조회해 결과 상한 표시를 결정한다. 전체 건수는 제목 탭에서 제공한다.

## Rollout

1. Free의 PostgreSQL 초기화가 목차 투영과 필드별 인덱스를 준비한다. 기존 목차는 한 번 반영한다. 기존 OCR은 작업 스케줄러가 캐시를 재사용하며, 초기 복원 중에는 이미 반영된 페이지부터 검색된다. 아직 OCR을 만들지 않은 페이지는 뷰어에서 읽은 후 검색할 수 있다.
2. 데이터 규모를 늘리기 전에 대표 검색어와 흔한 검색어에서 `EXPLAIN (ANALYZE, BUFFERS)`로 검색 계획, 탭별 p95와 버퍼 읽기, 인덱스 크기와 초기 구축 시간을 기록한다. 확대 배포에서 시작 시 DDL 잠금이 문제라면 기존 인덱스 구축은 `CREATE INDEX CONCURRENTLY`를 사용하는 운영 마이그레이션으로 옮긴다. 제목과 본문에서 한·영 혼합, 한글 조사·붙여쓰기, 1~2자 초성, 잘못 인식된 OCR을 비교한다.
3. Pro는 제목을 계정별 IndexedDB에서 검색하는 기존 경로를 사용한다. 본문 탭 도입 시에는 비공개 저장소에 인증된 계정·Drive 파일 ID를 기준으로 투영을 추가하고 계정 간 결과 격리를 검증한다. 도서 정보의 편집 제목을 제목 검색에 넣을 때는 해당 메타데이터와 파일명 검색의 우선순위 및 초성 재생성을 함께 정한다.

## Code and testing

- 조회 계약 · [search.ts](../src/server/routes/search.ts) · [ContentSearchScope](../src/common/protocol/search/index.ts)
- 인덱스와 쿼리 · [contentSearch.ts](../src/server/postgres/contentSearch.ts)
- 기존 OCR 복원 · [restorePageOcrSearchIndex](../src/server/ocr/pageOcrSearchIndex.ts) · [createOcrService](../src/server/ocr/ocrService.ts)
- 탭 전환 · [SearchPage](../src/front/pages/SearchPage.tsx) · [ContentSearchResults](../src/front/pages/ContentSearchResults.tsx)
- 검증 · [콘텐츠 검색 테스트 계획](../../../apps/pdfit/tests/plans/content-search-20261123.md)
