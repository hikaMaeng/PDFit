# NAS 접근 격리 보고 — 2026-11-17

계획: `apps/pdfit/tests/plans/library-volume-isolation-20261117.md`

## 변경
- `services/libraryVolume.ts`(신규): 8초 시간 초과, 15초 쿨다운, 동시 12개 제한, 오프라인 오류 코드 판별.
- `FilesystemService` 전부 비동기 + 가드 경유. 폴더 라우터는 볼륨 오류를 503으로 응답. 책 열기는 가드 프로브.
- 워처: 오프라인 동안 이벤트 무시(DB 행 삭제 금지), 동기 호출 제거. 썸네일·OCR도 가드 사용.
- Dockerfile `UV_THREADPOOL_SIZE=32`.

## 결과
- `node --test` 4개 파일 25건 통과(신규 4건 포함): 가드, 볼륨 다운 시 `GET files`·`GET folders` 200, `DELETE`/`GET 책`/`POST move` 503이며 삭제 실패 시 색인 행 유지.
- `npm run verify:repo` 통과. 배포 컨테이너 `UV_THREADPOOL_SIZE=32` 확인.
- 실서버 응답(NAS 연결된 상태, 측정값): `/api/folders` 200 0.010s, `/files` 200 0.015s, `/api/tags` 200 0.009s, `/api/covers` 200 0.278s, 책 열기 200 22.96s(큰 PDF를 NAS에서 읽는 시간).

## 한계
- 실서버 측정 시점에 NAS가 연결돼 있었다. 끊김 상태의 동작은 단위·통합 테스트(가짜 볼륨)로만 확인했고 실서버에서 재현하지 않았다.
- 브라우저 UI 검증은 하지 않았다(서버 변경).
- 가드 시간 초과 8초는 큰 폴더의 느린 readdir에서 오탐 가능성이 있다. 현재 715권 규모에서는 문제가 관측되지 않았다.
