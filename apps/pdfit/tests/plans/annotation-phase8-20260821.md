# Test Plan: Annotation Phase 8

## Goal

Annotation CRUD가 원본 PDF와 분리된 PostgreSQL 저장소에 incremental 방식으로 반영되는지 검증한다.

## Steps

1. package, frontend, server build를 실행한다.
2. Docker runtime을 재배포해 annotations schema를 초기화한다.
3. 브라우저에서 Rectangle을 생성하고 `저장됨` 상태를 확인한다.
4. Rectangle을 이동하고 갱신된 DB geometry를 확인한다.
5. 임시 Rectangle을 생성한 뒤 삭제하고 DB row 수를 확인한다.
6. PDFGPU backend를 확인한다.

## Expected Results

Create/PATCH/DELETE가 UUID 단위로 실행되고 DB에는 남아 있는 annotation만 존재한다. PDF 파일 바이트는 수정되지 않는다.
