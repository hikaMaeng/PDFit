# 표지 선택 후 반영 지연 검증 계획 — 2026-11-17

## 요구 기준 (사용자 보고 원문)

> 커버이미지 선택후 반영까지 제법 시간이 걸린다. 이미 이미지가 확보된 상태에서 그저 디비 한줄 업데이트하는거 아닌가? 왜 이렇게 느려?

## 코드 확인으로 세운 가설
1. 서버 적용(`PUT /api/covers`)은 파일 한 개와 JSON 한 개 쓰기라 느리지 않다.
2. `PdfCoverItem`의 모든 카드가 전역 `getCoversRevision`을 구독해, 표지 하나를 바꾸면 715장이 전부 동기 재렌더된다.
3. 서버가 `folders-changed`를 보내 사이드바가 폴더 목록을 다시 불러온다.
4. 후보 검색이 가장 느린 사이트(Open Library)를 기다린다.

## 절차 (이북 폴더 715장 표지 보기, 인앱 브라우저)
- 수정 전/후에 후보 첫 표시 시각, 후보 클릭→대화상자 닫힘, 클릭 후 10ms 하트비트 최대 간격, 클릭 뒤 `/api/folders` 요청 수를 잰다.
- `node tests/real-cover-browser.mjs`(교체본이 없는 파일, 8단계)와 `node --test packages/pdfit/tests/real-covers.test.mjs`.
