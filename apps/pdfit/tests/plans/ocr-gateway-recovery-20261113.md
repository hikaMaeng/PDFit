# 뷰어 페이지 텍스트(OCR) 게이트웨이 502 복구 검증 계획 — 2026-11-13

## 요구 기준 (사용자 보고 원문)

> 뷰어의 ocr이 잦은 에러를 발생

함께 받은 증거: 뷰어 "24페이지 텍스트" 대화상자에 `텍스트를 읽지 못했습니다. HTTP 502`.

## 원인 (코드가 아니라 바깥 기록으로 확인)

nginx-proxy(`pdfit.neurondev.net` → `host.docker.internal:15203`) 에러 로그
`/data/logs/proxy-host-9_error.log`:

```
2026/11/13 01:55:36~01:55:53  connect() failed (111: Connection refused) while connecting to upstream,
  request: "POST /api/ocr/page HTTP/2.0", upstream: "http://192.168.65.254:15203/api/ocr/page",
  referrer: "https://pdfit.neurondev.net/viewer/이북/딥러닝을 위한 수학.pdf"
```

- 그 로그 파일에서 `ocr/page` 실패는 모두 16건이고, 전부 이 18초 구간에 있다. 그 밖의 시각에는 없다.
- 같은 시각 `pdfit-pdfit-1` 은 재배포로 내려가 있었다(다음 `start` 가 01:56:02).
- 즉 실패한 요청은 서버에 닿지도 않았다. 응답은 서버의 `{ "error": … }` 가 아니라 프록시의 502 HTML이었고,
  그래서 화면에는 서버 메시지 대신 `HTTP 502` 가 남았다.
- 서버 쪽 OCR 경로 자체는 같은 책·같은 페이지를 포함해 30여 회 호출에서 모두 200이었다
  (캐시 삭제 후 24쪽 재요청 583 ms, 캐시 없는 8쪽 동시 요청 8/8 성공).

## 수정

1. `packages/pdfit/src/front/api/ocr.ts` — 서버에 닿지 못한 요청(fetch 실패, 또는 이 API의 JSON이 아닌
   502/503/504)만 `OcrUnreachableError` 로 구분해 1·2·4·8·15초 백오프로 다시 보낸다(최대 5회, 약 30초).
   서버가 돌려준 실패(JSON `error`)는 그대로 올린다 — 다시 보내도 같은 결과이기 때문이다.
2. `PageOcrDialog` — 끝내 닿지 못하면 `HTTP 502` 대신 번역된 문구(`ocrUnreachable`)를 보여준다.
3. `routes/ocr.ts` — 502로 끝난 읽기를 서버 로그에 한 줄 남긴다(지금까지는 `ERROR POST /page 502` 뿐이라
   서버와 게이트웨이 중 누가 답했는지 알 수 없었다).

## 절차

1. `npm run deploy:standalone`
2. `node apps/pdfit/tests/ocr-gateway-recovery-browser.mjs`
   - 1단계: 뷰어를 연다.
   - 2단계: `/api/ocr/page` 의 첫 두 번만 nginx 502 본문(`text/html`)으로 가로막고, 패널이 `failed` 를
     거치지 않고 `done` 으로 끝나는지, 요청이 502·502·성공 3회로 나가는지, 첫 시도와 성공 사이가
     2.8초 이상인지 본다.
   - 3단계: 모든 시도를 막고, 요청이 6회(첫 시도 + 재시도 5회) 나간 뒤 실패 문구가 한국어
     `텍스트를 읽지 못했습니다. 서버에 연결하지 못했습니다…` 인지 본다.
3. 회귀: `PDFIT_TEST_SKIP_VISION=1 node apps/pdfit/tests/ocr-browser.mjs`

## 범위 밖

- 재배포 중 끊기는 다른 요청(`/api/events`, 뷰어 구간 로딩)은 이 변경이 다루지 않는다.
- 비전 모델 경로는 이 변경과 무관하므로 회귀에서 건너뛴다(`PDFIT_TEST_SKIP_VISION=1`).
