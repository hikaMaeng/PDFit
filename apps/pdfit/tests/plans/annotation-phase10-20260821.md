# Test Plan: Annotation Phase 10

## Goal

전체 Annotation 기능과 기존 PDFGPU/Bookmark 동작을 실제 Docker 브라우저 환경에서 회귀 검증한다.

## Steps

1. 전체 PDFit build, annotation tests, PDFGPU integration tests, `verify:pdfit`를 실행한다.
2. Docker health와 runtime log를 확인한다.
3. Rectangle, Circle, Line, Arrow, Ink, Highlight, Text를 한 문서에 생성한다.
4. 선택한 Rectangle을 이동하고 크기 변경 후 Undo/Redo한다.
5. 모든 요소가 `저장됨` 상태인지 확인하고 페이지를 새로고침한다.
6. 7종 요소 수, PDFGPU backend, Bookmark 기본 도구, 브라우저 console error를 확인한다.
7. 테스트 annotation 행을 정리하고 빈 layer 상태를 확인한다.

## Expected Results

모든 annotation 종류가 저장·복원되고 선택 편집과 history가 동작한다. PDFGPU WebGPU backend와 Bookmark 흐름은 유지되고 브라우저/컨테이너 오류가 없다.
