# Test Plan: Annotation Phase 5

## Goal

영역 기반 형광펜이 반투명 SVG annotation으로 생성되고 PDFGPU page 좌표를 유지하는지 검증한다.

## Steps

1. package build와 annotation 단위 테스트를 실행한다.
2. Docker runtime을 재배포한다.
3. Highlight 도구를 선택하고 PDF 페이지에서 영역을 드래그한다.
4. 생성된 SVG highlight의 색상과 투명도를 확인한다.
5. PDFGPU backend를 확인한다.

## Expected Results

노란색 반투명 highlight가 PDF 위 SVG layer에 생성되며 원본 PDF와 PDFGPU 렌더링은 변경되지 않는다.
