# 폴더 페이지 유니코드 순 정렬 검증

요구: "폴더에서 볼 때 정렬을 유니코드 순으로 해. 리스트든 썸네일 화면이든".

1. `npm run test:sort`: `compareUnicode`의 코드 포인트·NFC 규칙.
2. `PDFIT_TEST_CHANNEL=chrome PDFIT_TEST_SAMPLE=715 node apps/pdfit/tests/folder-unicode-order-browser.mjs`: `/folder/이북` 목록·표지 보기의 화면 순서 = `GET /api/folders/이북/files` 이름을 독립 비교 함수(NFC 코드 포인트 배열 비교)로 정렬한 순서. 쓰기 없음, `pageerror` 없음.
