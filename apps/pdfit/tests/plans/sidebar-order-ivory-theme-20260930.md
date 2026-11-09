# 왼쪽 메뉴 순서와 B안 라이트 테마 검증

## 환경

Windows 11, 루트 Docker Compose의 `service`, Chromium 1440×900 및 390×844. `/api/**`는 브라우저 테스트에서 모의 응답으로 처리하며 실제 사용자 문서는 사용하지 않는다.

## 실행

1. `npm run build --workspace=@pdfit/pdfit`
2. `npm run build --workspace=service`
3. `docker compose up -d --build --wait --wait-timeout 30 service`
4. `node apps/pdfit/tests/viewer-tags-free-tier-browser.mjs`
5. `git diff --check`

## 통과 조건

- 왼쪽 메뉴의 DOM·시각 순서가 태그 → 폴더 → 북마크이며 각 섹션의 펼침과 탐색은 유지된다.
- 라이트 모드의 배경은 아이보리 `#f4f1e9`, 왼쪽 메뉴는 차콜 `#3d403b`이고 선택·호버·구분선도 B안과 어울린다.
- 다크 모드와 문서 목록 기능의 기존 브라우저 검사가 통과한다.
- 최종 스크린샷에서 목록과 왼쪽 메뉴의 색 대비를 확인한다.

## 결과

`apps/pdfit/tests/reports/sidebar-order-ivory-theme/` 아래의 타임스탬프 보고서와 브라우저 스크린샷을 확인한다.
