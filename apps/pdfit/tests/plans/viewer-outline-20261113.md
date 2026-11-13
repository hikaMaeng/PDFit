# 뷰어 목차 보기 계획 — 2026-11-13

## 요구 (사용자 원문)

> 뷰어에 신기능인 목차보기 기능을 신설한다.
> 뷰어 네비에 새로운 버튼으로 추가하고 누르면 모달로 책의 목차가 나온다.
> 조회 불가능한 경우는 조회 실패로 처리

> 한번 읽어와서 승인된 목차는 디비에 저장되어야한다

## 해석과 전제

- "뷰어 네비": 뷰어 툴바의 페이지 이동 영역. 버튼은 이전 페이지 화살표 왼쪽.
- "책의 목차": PDF 자체의 개요(`/Outlines`). 본문 글자에서 목차를 추측하지 않는다.
- "조회 불가능": 개요가 없거나 비어 있음(`empty`), 읽는 중 오류(`error`). 둘 다 "목차 조회 실패".
- "승인된 목차": 조회에 성공한 목차로 해석했다. 사용자가 따로 승인하는 단계는 만들지 않았다. 실패 결과는 저장하지 않는다.
- 저장본은 책의 크기·수정 시각이 저장 당시와 같을 때만 쓴다. 파일 삭제·이동·폴더 제거 때 함께 지운다.

## 검증 항목

| # | 항목 | 수단 |
|---|---|---|
| 1 | 실제 `/Outlines` PDF를 PDF.js로 읽어 깊이·페이지·제목(UTF-16)·이름 목적지·쪽 번호 목적지·URI·없는 목적지가 맞게 나온다 | `npm run test:outline` |
| 2 | 개요 없는 PDF, 읽기 오류 → `failed` | `npm run test:outline` |
| 3 | 저장본이 있으면 PDF를 읽지 않는다. 성공만 저장한다 | `npm run test:outline` |
| 4 | `/api/outlines` 404 → PUT → GET, 잘못된 목록 400, 미지원 저장소 501 | `npm run test:outline` |
| 5 | PostgreSQL: 교체 시 1행 유지, 파일 변경 후 무효, `purgeFile`/`purgeFolder` 삭제 | `PDFIT_TEST_DATABASE_URL` + `npm run test:outline` |
| 6 | 배포 서버: 버튼 → 모달 목록이 PDF 원본 개요와 같다, 첫 조회 PUT 200, DB 저장 | `apps/pdfit/tests/viewer-outline-browser.mjs` |
| 7 | 항목 클릭 → 해당 페이지 이동 | 같은 스크립트 |
| 8 | 새로고침 후 재조회는 저장본(`data-source=stored`), PUT 없음 | 같은 스크립트 |
| 9 | 개요 없는 책 → "목차 조회 실패", PUT 없음, GET 404 | 같은 스크립트 |
| 10 | `?engine=gpu` 에서도 같은 목록 | 같은 스크립트 |
| 11 | 컨테이너 DB `book_outlines` 행 확인 | `psql` (컨테이너 내부) |

## 실행

```bash
npm run deploy:standalone
```

```bash
PDFIT_TEST_CHANNEL=chrome PDFIT_TEST_RUN=20261113_deployed node apps/pdfit/tests/viewer-outline-browser.mjs
```

## 대상 책 (배포 라이브러리)

- 목차 있음: `이북/(만화)미적분 7일만에 끝내기.pdf`
- 목차 없음: `AX/Session Brief_01_1. AX시대 어떻게 일하고 살아가며 성장할 것인가_202608_vFinal.pdf`
