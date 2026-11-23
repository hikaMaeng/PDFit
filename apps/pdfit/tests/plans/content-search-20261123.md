# 콘텐츠 검색 검증 계획

## 목표와 환경

Free의 탭별 요청, 결과 링크, PostgreSQL 전문 인덱스 반영을 확인한다. PostgreSQL 17 격리 스키마와 로컬 Free 컨테이너, Playwright Chromium을 사용한다.

## 실행과 기대 결과

1. 빌드 후 `node --test packages/pdfit/tests/content-search.test.mjs packages/pdfit/tests/title-search.test.mjs packages/pdfit/tests/ocr.test.mjs`를 실행한다. `PDFIT_TEST_DATABASE_URL`을 테스트 DB로 설정해 기존 목차 반영, 목차·클립 갱신, 페이지 OCR 캐시 복원, 파일 교체·삭제, 제목·초성 회귀를 확인한다. DB 테스트는 별도 스키마를 만들고 닫을 때 삭제한다.
2. `npm run deploy:standalone` 후 Docker health와 `/app/data/books`의 서재 표시를 확인한다. DB에서 컴포넌트별 GIN과 현재 버전의 기존 페이지 OCR 인덱스 행 수를 확인한다. 결과 텍스트는 실행 로그에 기록하지 않는다.
3. `PDFIT_TEST_BASE_URL`과 필요 시 `PDFIT_TEST_CHROMIUM_PATH`를 설정해 `node apps/pdfit/tests/content-search-browser.mjs`를 실행한다. 검색과 클립 조회 응답은 Playwright로 고정한다. 첫 검색은 제목 API만 요청하고 탭을 클릭할 때마다 해당 API 하나만 요청한다. 결과의 페이지 링크, 일치한 클립 열기, 새 검색의 제목 탭 복귀, 모바일 주소에서 선택된 탭의 노출을 확인한다. `title-search-browser.mjs`는 실제 서재의 제목·초성 회귀를 확인하는 데 사용한다.
4. 확대 배포 시 흔한 텍스트와 희소 텍스트의 `EXPLAIN (ANALYZE, BUFFERS)`, 탭별 p95, 인덱스 크기, 최초 생성 시간, 한·영 검색 품질을 기록한다.

## 브라우저 위치자와 증거

- 검색 입력 `lnb-search-input`, 제목 결과 건수 `search-result-count`.
- `tab`과 `tabpanel`의 접근 가능한 이름은 제목, 목차, 페이지 OCR, 클립 OCR, 클립 메모.
- 본문 결과 목록 `content-search-results`, 문서 링크는 파일명과 `page` 쿼리.
- 클립 열기 버튼의 이름은 클립 열기이며, 대상은 `bookmark-preview-dialog`의 메모 입력이다.
- 제목 결과의 행·카드 개수는 `list-mount-sentinel`의 `data-list-mounted="true"` 이후 확인한다.
- 실행 결과, 요청 경로·횟수, 페이지 오류, 스크린샷을 남긴다.
