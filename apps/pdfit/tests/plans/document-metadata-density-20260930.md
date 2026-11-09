# 문서 정보와 목록 밀도 검증 계획

## 목적

- 폴더·태그 목록의 행 높이를 동일하게 60px로 유지한다.
- 문서 정보 버튼을 다시 눌렀을 때 동일 문서의 메타데이터 요청이 중복 발생하지 않는다.
- 문서 정보 모달 안의 책 전용 기능 이름을 문서 일반 정보와 구분한다.

## 환경 및 준비

- Windows 11, Docker Compose `service` 컨테이너, Chromium Playwright.
- 로컬 미리보기 세션과 `PDFit Library`의 기존 테스트 문서를 사용한다.
- Google Drive 자료나 사용자 메타데이터를 수정하지 않는다.

## 절차와 기대 결과

1. `npm run build --workspace=@pdfit/pdfit`, `npm run build --workspace=service`가 성공한다.
2. `docker compose up -d --build --wait --wait-timeout 60 service` 이후 컨테이너가 healthy다.
3. `node apps/pdfit/tests/library-layout-browser.mjs`: 폴더·태그 행 높이가 모두 60px이고 태그 열 배치가 유지된다.
4. `node apps/pdfit/tests/book-metadata-loading-browser.mjs`: 문서 정보 모달을 열고 닫았다가 다시 열어도 메타데이터 GET은 한 번만 발생한다. 책 전용 버튼 이름은 `책 항목 직접 입력` 및 `책 정보 찾기`다.
5. `git diff --check`가 통과한다.

## 실패 시

- 브라우저 출력의 요청 수·응답 상태·시간을 기록하고 재현 가능한 동일 절차로 재검증한다.
- 데이터 변경이 필요한 복원 작업은 이 테스트에 포함하지 않는다.
