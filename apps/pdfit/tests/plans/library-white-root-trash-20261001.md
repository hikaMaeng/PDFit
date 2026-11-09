# 라이트 목록 배경과 기본 폴더 삭제 표시 검증

## 목적

폴더·태그 문서 목록에서 제목 줄, 고정 도구 모음, 문서 행 및 바깥 여백을 라이트 모드에서 흰색으로 통일한다. 삭제 불가인 기본 `PDFit Library` 폴더는 휴지통을 표시하지 않고, 일반 폴더는 삭제 버튼을 유지한다.

## 환경

- Windows 11, Docker Compose `service`, `http://127.0.0.1:15201`
- Playwright Chromium, 데스크톱 1440×900
- 로컬 미리보기 인증 사용
- 일반 폴더는 `/api/folders/cache` 응답에 테스트 전용 항목을 브라우저에서만 추가한다. 실제 저장소에는 쓰지 않는다.

## 절차와 판정

1. `npm run build --workspace=@pdfit/pdfit` 및 `npm run build --workspace=service` 성공.
2. `docker compose up -d --build --wait --wait-timeout 60 service` 후 컨테이너 Healthy.
3. `node apps/pdfit/tests/library-toolbar-root-guard-browser.mjs` 실행. 라이트 폴더·태그 화면의 `main`, 고정 컨트롤, 행이 `rgb(255, 255, 255)`이고 기본 폴더의 휴지통은 0개, 일반 폴더의 삭제 버튼은 활성화 상태여야 한다. 다크 배경은 기존 색상을 유지한다.
4. 스크린샷으로 제목 줄과 바깥 여백의 흰색 및 사이드바 아이콘 상태를 육안 확인한다.
5. `node apps/pdfit/tests/light-blue-theme-browser.mjs`로 사이드바 대비·기존 라이트/다크 테마 회귀를 확인한다.
6. `git diff --check` 통과.
