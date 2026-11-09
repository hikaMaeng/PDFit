# D안 딥 블루 라이트 테마 검증 계획

## 목적

- 라이트 모드의 사이드바·본문을 사용자가 선택한 D안으로 적용한다.
- 기존 다크 모드의 파란색 표시가 라이트 모드에서도 읽히도록, 본문용·사이드바용 파란색을 배경별로 분리한다.
- 다크 모드 색상과 태그별 고유 색상은 유지한다.

## 환경

- Windows 11, 루트 Docker Compose `service`, Chromium Playwright 1440×900.
- `/api/auth/local-preview`로 읽기용 로컬 미리보기 세션을 생성한다.
- 기존 `PDFit Library` 폴더의 문서 목록만 열고 사용자 데이터를 수정하지 않는다.

## 절차 및 통과 조건

1. `npm run build --workspace=@pdfit/pdfit`와 `npm run build --workspace=service`가 성공한다.
2. `docker compose up -d --build --wait --wait-timeout 60 service` 후 컨테이너가 healthy다.
3. `node apps/pdfit/tests/light-blue-theme-browser.mjs`가 라이트 모드 본문 `#f4f8fc`, 사이드바 `#204e79`를 확인한다.
4. 본문 파란 링크와 파란 문서 정보 아이콘은 배경과 대비 4.5:1 이상, 사이드바 파란 아이콘은 3:1 이상, 선택된 메뉴 글자는 4.5:1 이상이다.
5. 같은 브라우저 검사에서 다크 모드 배경·사이드바·폴더 아이콘이 종전 색상과 같은지 확인한다.
6. 스크린샷을 눈으로 확인하고 `git diff --check`를 통과한다.

## 실패 시

- 색상·대비 출력값과 실패 위치를 기록하고, 해당 라이트 모드 토큰만 조정한 뒤 다시 빌드·배포·브라우저 검사한다.
