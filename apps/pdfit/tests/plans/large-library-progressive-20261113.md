# 대규모 썸네일 목록 블로킹 해소 검증 계획 — 2026-11-13

## 요구 기준 (원문)

사용자 요청:

> 대규모 아이템이 있는 썸네일 리스트는 블록킹 현상이 발생한다. 디바운스등으로 위에서부터 차근차근 썸네일이 읽어와서 표시되는 방식으로 처리하는 등의 넌블록킹 수단을 강구하라

요구를 수용 기준으로 옮기면 세 가지다.

1. 항목이 수백 개여도 목록이 뜨는 동안 화면이 멈추지 않는다(메인 스레드 블로킹 없음).
2. 카드는 위에서부터 차례로 붙고, 표지도 위에서부터 차례로 들어온다.
3. 목록은 끝까지 다 채워진다(일부만 그리고 멈추지 않는다).

## 대상과 전제

- 대상 코드
  - `packages/pdfit/src/front/components/useProgressiveItems.ts` (목록 청크 장착)
  - `packages/pdfit/src/front/components/thumbnailLoadQueue.ts` (표지 동시 요청 제한)
  - `packages/pdfit/src/front/components/cardPropsEqual.ts` + `PdfCoverItem` · `PdfListItem`의 `React.memo`
  - 적용 화면: `FolderPage`, `SearchPage`, `TagPage`의 목록 보기와 표지 보기
- 측정 대상 번들: `apps/pdfit/dist` (`npm run build:pdfit` 산출물). 테스트는 이 번들을 정적 제공하는 스텁 서버 위에서 돈다.
- 브라우저: Playwright Chromium, 1400×900, headless.
- 데이터: 로컬 라이브러리 형식(드라이브 ID 없음) PDF 600건, 썸네일 응답은 120ms 지연 후 1×1 PNG.

## 단계

1. `node apps/pdfit/tests/large-library-progressive-browser.mjs`
   - 첫 커밋에 붙은 카드 수 ≤ 150 (`data-list-rendered`), 전체는 600 (`data-list-total`).
   - 장착 중 `requestAnimationFrame` 간격 최댓값 < 400ms.
   - `data-list-mounted=true` 가 되고 카드 수 = 600.
   - 먼저 `ready` 가 된 표지 6장이 목록 순서상 1~6번째 파일이다.
   - 썸네일 동시 요청 ≤ 6, 스크롤 전 요청 수 < 600.
2. 수정 전/후 프레임 비교: 같은 스텁 위에서 rAF 간격을 기록해 최장 멈춤 시간과 전체 장착 시각을 비교한다.
3. 회귀: 표지·목록 카드를 쓰는 기존 브라우저 테스트.

## 범위 밖

- 배포된 컨테이너 대상 검증. 이번 작업 중 라이브러리 CIFS 호스트(`//192.168.0.13/usbshare1`)가 Docker 에서 끊겨(`mount error(115)`) `npm run deploy:standalone` 이 중단됐다. 호스트가 돌아온 뒤 다시 한다.
- Pro(`apps/service`) 재배포. 현재 보류 중이다.
- 가상 스크롤(화면 밖 카드 제거)은 하지 않는다. 선택·일괄 작업이 전체 목록을 전제로 하므로 장착만 나눈다.
