# iPad PDF 다운로드 응답 검증 계획

- 목표: iPad Safari가 PDF를 저장하지 않고 미리보기로 여는 상황에서, 다운로드 경로가 일반 열람 경로와 구분되는지 확인한다.
- 환경: Windows 11, 로컬 Docker Compose `service`, Node Playwright Chromium/WebKit 터치 컨텍스트. 실제 iPad 및 원격 `pdfit.io`는 별도 수동 확인 대상.
- 준비: `npm run build --workspace @pdfit/pdfit`, `npm run build --workspace service`, `docker compose up -d --build --wait --wait-timeout 60 service`.
- 서버 검사: 일반 GET은 `application/pdf`와 `inline`, `?download=1` GET/HEAD는 `application/octet-stream`, `attachment`, `nosniff`, 정상 파일 길이를 갖는다.
- 브라우저 검사: 다운로드 버튼은 `download=1` 링크를 사용한다. 파일 제공 테스트 서버에 연결한 뒤 WebKit·Chromium에서 실제 다운로드 파일의 바이트가 원본 PDF와 일치하는지 확인한다. 파일명은 브라우저가 UTF-8 파일명을 해석하면 원본 이름, 그렇지 않으면 ASCII 폴백 `document.pdf`를 허용한다.
- 실패 기준: 다운로드 이벤트만 발생하고 저장 파일이 인증 오류나 다른 응답인 경우 실패로 처리한다.
- 재현 명령: `node --test apps/service/tests/shared-runtime.test.mjs`; `node apps/pdfit/tests/viewer-toolbar-export-browser.mjs --touch-save-hint --webkit`; `node apps/pdfit/tests/viewer-toolbar-export-browser.mjs --touch-save-hint`; `node apps/pdfit/tests/viewer-toolbar-export-browser.mjs`.
- 한계: 데스크톱 WebKit 터치 에뮬레이션은 iPadOS Safari 자체가 아니므로 실제 기기 다운로드 성공을 입증하지 않는다.
