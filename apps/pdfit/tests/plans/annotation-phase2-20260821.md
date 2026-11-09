# Test Plan: Annotation Phase 2

## Goal

SVG annotation layer에서 Rectangle, Circle, Line, Arrow, Pen 도구가 PDF page 좌표로 생성되는지 검증한다.

## Steps

1. gesture model과 ink simplification 단위 테스트를 실행한다.
2. Docker runtime을 재배포한다.
3. 각 도구를 선택하고 첫 페이지에서 pointer drag로 생성한다.
4. 두 번째 페이지로 이동해 Rectangle을 생성한다.
5. 확대 후 생성된 annotation이 유지되는지 확인한다.
6. PDFGPU backend 및 기존 Bookmark 도구가 유지되는지 확인한다.

## Expected Results

각 도형이 SVG 요소로 한 번씩 생성되고, 여러 페이지와 확대 상태에서도 유지되며, pointermove 중에는 영속 상태를 갱신하지 않는다.
