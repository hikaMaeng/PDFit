# 뷰어 흰 페이지 미복구·passive 휠 오류 검증 계획 — 2026-11-13

## 요구 기준 (사용자 보고 원문)

> 실제 뷰어에서 중간에 하얗게 되어버리면 다시는 복구가 안되는 현상 발생

> 스크롤등으로 페이지를 다니다보면 발생함

함께 받은 증거:
- 두 페이지 보기 79/312쪽에서 양쪽 페이지가 모두 흰 화면이다.
- 콘솔에 `/api/folders/…pdf`와 `/api/viewer-state/…`의 502 응답이 있다.
- 콘솔에 "Unable to preventDefault inside passive event listener invocation"이 반복된다.

## 가설과 확인 방법

1. **흰 페이지:** 구간(range) 요청 하나가 실패하면 렌더가 실패하고, 다시 시도하지 않는다. 확인 방법은 다음과 같다.
   - 큰 책(`밑바닥부터 시작하는 딥러닝.pdf`, 103,502,316 B)을 연다.
   - PDF 구간 요청만 502로 바꾸고 79쪽으로 이동한다.
   - 502를 풀고 15초 동안 그 페이지 캔버스에 불투명한 비흰색 픽셀이 생기는지 본다.
2. **passive 경고:** 페이지 모드에서 휠을 6틱 굴리고 콘솔 경고 개수를 센다.

## 절차

1. 수정 전 컨테이너에서 `viewer-transient-load-failure-browser.mjs`를 돌려 실패하는지 본다.
2. 수정 후 `npm run deploy:standalone` 하고 한 페이지(`single`)·두 페이지(`double`) 둘 다 돌린다.
3. 회귀 테스트를 돌린다.
   - `pdfgpu-0110-viewer-browser.mjs`
   - `viewer-restored-page-wheel-browser.mjs`
   - `viewer-double-fit-height-browser.mjs` 6종
   - `npm run test:pdfgpu`, `npm run verify:repo`
4. 모든 브라우저 테스트는 GET 이외 요청을 막아 서재 데이터를 바꾸지 않는다.

## 합격 기준

- 서버가 다시 응답하면 사용자 조작 없이 목표 페이지가 그려진다.
- 휠을 굴려도 passive `preventDefault` 콘솔 오류가 0건이다.
- page error가 0건이다.
- 기존 휠·스와이프·두 페이지 테스트가 통과한다.
