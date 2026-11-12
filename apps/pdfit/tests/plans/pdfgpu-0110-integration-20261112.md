# PDFit 0.4.7 — `@pdfgpu/core` 0.1.10 반영 검증 계획 — 2026-11-12

## 요구 기준 (사용자 요청 원문)

> f:\dev\pdfgpu 가 수많은 개선을 이뤘다. 이를 반영하고 문제가 없는지 확인해야해.

> 0.4.7로 진행

양쪽 보기 짝에 대해 사용자가 정한 것(원문):

> 이런게 왜 규칙 수준이지? 그때그때 맘대로 쓸 수 있어야 할거 같아

## 범위

- `@pdfgpu/core`를 `0.1.9-pdfit.1`(소스 `249af22`, PDFit 전용 색상 패치)에서 업스트림 `0.1.10`(태그 `v0.1.10`, `c72558d`)으로 바꾼다. 새 계약 `release-contracts/pdfit/v0.4.7.json`, 공개·비공개 패키지 버전 0.4.7.
- 0.1.10과 PDFit이 만나는 지점에서 생기는 회귀를 찾아 고친다. 키보드 이중 처리, PDF.js 양쪽 보기 짝, GPU 초기 페이지 재적용이 대상이다.
- PDF.js 양쪽 보기 짝을 읽는 사람이 고를 수 있게 한다(**표지 따로 보기**).
- 범위 밖:
  - GPU 뷰어 짝 전환. `@pdfgpu/core`에 짝 옵션이 없어서 pdfgpu 쪽 작업이 필요하다.
  - `v0.1.10` 이후 pdfgpu 커밋 `ee2a32e`, `1574f0e`. 미릴리스·미푸시 상태다.
  - Pro 배포, push·태그.

## 절차

1. `PDFGPU_REFRESH=1 node scripts/sync-pdfgpu.mjs`로 0.1.10 타르볼을 만들고, 매니페스트에서 계약 파일을 생성한다.
2. 타르볼 SHA-256을 따로 계산해 매니페스트와 대조한다.
3. `npm run build`, `npm run test:pdfgpu`(통합 + 양쪽 보기 짝 단위), `npm run test:tasks`, `npm run verify:repo`, `npm run verify:service-parity`를 돌린다.
4. `npm run deploy:standalone` 뒤 확인한다.
   - 컨테이너 `healthy`, `/health` 200
   - 컨테이너 안 `/app/package.json` 0.4.7
   - wasm SHA-256이 pdfgpu `83bebeb` 커밋 메시지의 2.15.1 값(`5e4cd023…`)과 같은지
5. 배포 서버(`127.0.0.1:15203`, 설치된 Chrome)에서 브라우저 검증을 돌린다.
   - `pdfgpu-0110-viewer-browser.mjs`. GET 이외 요청은 모두 막는다.
   - `viewer-restored-page-wheel-browser.mjs`
   - `viewer-double-fit-height-browser.mjs` 6종(기본·`--gpu`·터치·가로, 각각 legacy/GPU)
6. 대조 실험을 한다. 0.1.10에 변경 전(HEAD) 컴포넌트를 붙여 같은 증상이 나는지 보고, 되돌아감 방지 코드를 빼면 실패하는지 본다.

## 합격 기준

- 계약 검사: `source contract passed: PDFit 0.4.7 -> @pdfgpu/core@0.1.10`.
- PDF.js 양쪽 보기. 행 목록은 사용자가 정한 두 규칙에서 그대로 옮긴 것이다.
  - 기본: (1,2) → (3,4) → (5,6)
  - 표지 따로 보기: (1) → (2,3) → (4,5)
  - 버튼·PageDown·PageUp 모두 페이지가 겹치지 않는다.
  - 선택이 새로고침 뒤에도 남는다.
- GPU 뷰어
  - `pdfiumWorkerMain` 워커가 생성되고 캔버스를 그린다.
  - PageDown 한 번에 정확히 한 페이지 넘어간다. 뷰포트 포커스가 있을 때와 없을 때 모두.
  - 로딩 중 넘긴 페이지가 로딩이 끝난 뒤 되돌아가지 않는다.
- page error 0건, 서재 데이터 쓰기 0건(차단된 요청만 있음).
