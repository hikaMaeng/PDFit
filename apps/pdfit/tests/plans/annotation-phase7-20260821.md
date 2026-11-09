# Test Plan: Annotation Phase 7

## Goal

생성, 이동, 크기 변경, 삭제, 스타일 변경을 snapshot history로 Undo/Redo할 수 있는지 검증한다.

## Steps

1. history reducer 단위 테스트를 실행한다.
2. Docker runtime을 재배포한다.
3. Rectangle을 생성하고 Ctrl+Z, Ctrl+Shift+Z를 실행한다.
4. Rectangle을 한 번 드래그해 이동하고 Ctrl+Z를 실행한다.
5. toolbar Undo/Redo 버튼 활성 상태와 PDFGPU backend를 확인한다.

## Expected Results

생성은 한 번의 Undo로 제거되고 Redo로 복원된다. 여러 pointermove를 포함한 한 번의 drag는 Undo 한 번으로 시작 위치에 복원된다.
