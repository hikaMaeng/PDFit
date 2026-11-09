# Test Plan: Annotation Phase 3

## Goal

SVG annotation을 선택하고 PDF 좌표계에서 이동, 크기 변경, 삭제할 수 있는지 검증한다.

## Steps

1. annotation bounds, translate, resize 모델 단위 테스트를 실행한다.
2. Docker runtime을 재배포한다.
3. 브라우저에서 Rectangle을 생성하고 선택한다.
4. 선택된 Rectangle을 드래그해 이동한다.
5. 남동쪽 resize handle을 드래그해 크기를 변경한다.
6. Delete 키로 선택된 요소를 삭제한다.
7. PDFGPU backend가 계속 사용되는지 확인한다.

## Expected Results

선택 테두리와 네 개의 handle이 표시되고, 이동 시 크기는 유지되며, resize 시 기준점이 유지된다. 삭제 후 해당 SVG 요소가 제거되고 PDFGPU 렌더링은 영향을 받지 않는다.
