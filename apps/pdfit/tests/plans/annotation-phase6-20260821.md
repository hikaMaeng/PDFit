# Test Plan: Annotation Phase 6

## Goal

PDF 페이지를 클릭해 multiline 텍스트를 입력하고, 생성된 요소를 이동, 크기 변경, 수정, 삭제할 수 있는지 검증한다.

## Steps

1. free-text model 단위 테스트를 실행한다.
2. Docker runtime을 재배포한다.
3. Text 도구로 페이지를 클릭하고 두 줄 텍스트를 입력한다.
4. Ctrl+Enter로 입력을 확정한다.
5. Select 도구로 텍스트를 이동하고 resize handle로 크기를 변경한다.
6. Delete 키로 삭제한다.
7. PDFGPU backend를 확인한다.

## Expected Results

HTML textarea 입력 결과가 SVG `foreignObject`에 표시되고 PDF 좌표와 줄바꿈이 유지된다. 기존 선택 변환과 삭제 기능이 텍스트에도 동일하게 동작한다.
