# Test Plan: Annotation Phase 9

## Goal

저장된 annotation을 문서 진입 시 복원하고, Undo/Redo 결과와 실패 후 재시도를 서버 상태에 일치시키는지 검증한다.

## Steps

1. 저장된 Rectangle이 있는 PDF를 새로고침한다.
2. 저장 전과 새로고침 후 위치와 크기를 비교한다.
3. 확대 후 annotation과 PDF가 함께 변환되는지 확인한다.
4. Circle 생성 후 Undo하고 새로고침한다.
5. 서버를 잠시 중지한 상태에서 Arrow를 생성해 저장 실패를 만든다.
6. 서버를 다시 시작하고 재시도 버튼을 누른 뒤 새로고침한다.

## Expected Results

저장된 요소가 같은 페이지 좌표로 복원되고, Undo 결과도 재진입 후 유지된다. 저장 실패는 로컬 요소를 잃지 않고 재시도로 복구된다.
