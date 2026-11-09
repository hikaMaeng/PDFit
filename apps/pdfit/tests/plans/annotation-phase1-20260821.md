# Test Plan: Annotation Phase 1

## Goal

PDFGPU 위 SVG annotation layer가 PDF page point 좌표를 확대, 스크롤, 브라우저 크기 변경 후에도 동일하게 투영하는지 검증한다.

## Environment

- PDFit 0.4.4 Docker runtime
- PDFGPU 0.1.9 / PDFium WASM 2.14.0
- Codex in-app Chromium browser

## Steps

1. annotation 좌표 단위 테스트와 기존 PDFGPU 통합 테스트를 실행한다.
2. Docker Compose의 `pdfit` 서비스를 새 빌드로 재생성한다.
3. 다중 페이지 PDF를 기본 GPU Viewer로 연다.
4. 첫 페이지의 테스트 사각형을 확인한다.
5. 확대 전후 사각형의 페이지 상대 좌표를 비교한다.
6. Viewer를 스크롤한 뒤 사각형과 page shell의 상대 이동량을 비교한다.
7. 브라우저 viewport를 변경한 뒤 페이지 상대 좌표를 비교한다.

## Expected Results

- 빌드 및 테스트가 모두 통과한다.
- 사각형은 WebGPU Canvas와 독립된 SVG에 표시된다.
- 확대, 스크롤, resize 후에도 같은 PDF 위치를 유지한다.
- 기존 bookmark overlay와 PDFGPU 동작에 회귀가 없다.
