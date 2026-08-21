# Test Plan: Annotation Phase 4

## Goal

새 annotation의 기본 스타일과 선택 annotation의 선 색상, 선 두께, 투명도, 채움 스타일을 편집할 수 있는지 검증한다.

## Steps

1. package build와 annotation 단위 테스트를 실행한다.
2. Docker runtime을 재배포한다.
3. 스타일 컨트롤이 toolbar에 표시되는지 확인한다.
4. 채움을 활성화한 뒤 Rectangle을 생성한다.
5. 생성된 Rectangle을 선택하고 채움을 비활성화한다.
6. SVG 속성과 PDFGPU backend를 확인한다.

## Expected Results

새 요소에는 현재 기본 스타일이 복사되고, 선택 요소의 스타일 변경은 해당 SVG 요소에 즉시 반영된다.
