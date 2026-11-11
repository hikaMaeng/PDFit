# 표지 카드 "최종 페이지" 수정 — 검증 계획 (2026-11-11)

## 요구 기준 (사용자 요청 원문)

> 고쳐줘

대상은 직전 대화에서 보고한 결함이다: 표지 카드의 "최종 페이지"가 항상 "—"로 나온다(저장 페이지가 111인 책도 "최종페이지: —"). 원래 요구는 이슈 #3 요청 3번("마우스를 올리면 … 태그·최종 열람·최종 페이지가 표시된다")이다.

## 범위

- 한다: 표지 카드 정보 오버레이가 뷰어가 저장하는 값(`viewer_state.page`)을 읽게 한다(`PdfCoverItem.tsx`).
- 하지 않는다: `usePageProgress`·`reading_progress` 제거나 복구, 문서 내보내기의 `Reading page`(같은 원인으로 늘 1이지만 요청 범위 밖), 버전 올림, 푸시.

## 원인 (확인된 사실)

- 오버레이는 `progressApi.get`(`reading_progress`)을 읽는다. 그 값을 저장하는 `progressApi.save`의 유일한 호출처 `usePageProgress`를 쓰는 곳이 없어 실제 DB에서 `reading_progress`는 0행이다.
- 같은 DB에서 `viewer_state`는 31행 중 21행이 page > 1이다.

## 절차

1. 실패하는 테스트 먼저: `cover-last-page-browser.mjs`를 수정 전 배포본에서 실행 → 저장 페이지가 있는 책이 "—"로 나와 FAIL이어야 한다.
2. 수정 후 `npm run deploy:standalone`, 같은 테스트 → PASS.
3. 회귀: `cover-card-overlay-deployed-browser.mjs`(카드 레이아웃·호버·토글), `npm run verify:repo`.

## 합격 기준

- 저장 페이지가 N(>1)인 책의 오버레이가 `N`을 보여 준다(기대값은 `GET /api/viewer-state/...`에서 가져온다).
- 저장 기록이 없는 책은 `—`를 보여 준다.
- `pageerror` 0건, 읽기 전용(GET 외 요청 0건).
- 카드 레이아웃 테스트와 `verify:repo`가 그대로 통과한다.
