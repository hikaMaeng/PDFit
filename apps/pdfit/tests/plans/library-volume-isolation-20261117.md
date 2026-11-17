# NAS 접근 격리 검증 계획 — 2026-11-17

## 요구 기준 (사용자 보고 원문)

> 나는 nas연결이 끊기거나 잘 안되는게 그저 책을 열때나 실 폴더관련된 파일 추가삭제 및 업데이트에서만 영향력이 있기를 원해. pgvector기반의 모든 작동은 그것과 무관해야해

## 감사 결과 (코드 확인)
- 동기 `fs`로 볼륨을 읽던 곳: `FilesystemService` 전 메서드, 워처 이벤트 처리(`existsSync`/`statSync`), 부팅 `ensureBooksRoot`, 라이브러리 존재 확인(covers, 이미 수정).
- 비동기라도 멈춘 호출이 libuv 스레드를 점령하는 곳: 썸네일 `resolve`·주기 계획, OCR 원본 확인, 책 열기.
- NAS와 무관함을 확인: 태그 제안(제목만 사용), 태그·북마크·진행률·뷰어 상태 라우트(DB만), 썸네일 `find`(로컬 파일).
- 위험 코드: 워처의 `reconcile`은 파일이 없으면 DB 행을 지운다. 호출처가 없어 삭제.

## 검증
1. `node --test packages/pdfit/tests/library-volume-guard.test.mjs` (가드 시간초과·쿨다운·용량, 볼륨 다운 시 DB 라우트 200 / 파일 작업 503 / 색인 유지).
2. 기존 `folders-offline-volume`, `real-covers`, `background-tasks`.
3. `npm run verify:repo`, `npm run deploy:standalone`, 실서버 라우트 응답 시간.
