# iPad Safari 직접 다운로드 회귀 계획

## 환경

- Windows 11 로컬 Docker Compose `service` 및 Playwright Chromium/WebKit 터치 컨텍스트
- 인증이 필요한 PDF API는 소형 PDF 응답으로 대체

## 절차

1. iPad Safari 형태의 뷰어에서 문서 다운로드 대화상자를 연다.
2. 안내 문구와 실제 다운로드 버튼의 직접 링크, `download=1` 요청, 파일명을 검사한다.
3. 버튼 클릭 시 파일 다운로드 이벤트가 발생하고 대화상자가 즉시 제거되지 않는지 확인한다.
4. native Save As를 제공하는 PC 경로도 그대로 동작하는지 확인한다.
5. 일반 폴더 문서·파일 ID 문서·샘플 문서에서 일반 보기와 다운로드의 `Content-Disposition`을 비교한다.
6. 빌드, Docker 갱신, 브라우저 및 서버 통합 테스트를 실행한다.

## 실패 기준

- 다운로드 버튼이 숨겨진 링크를 프로그램으로 클릭하거나 PDF 인라인 보기로 이동함
- 다운로드 응답에 `attachment` 또는 사용할 수 있는 파일명이 없음
- PC 파일 저장 선택 기능이 회귀함
- 브라우저 콘솔 오류 발생

## 한계

- 실제 iPad Safari와 원격 `pdfit.io` 인증 세션은 로컬 자동화에서 직접 검증하지 못함.
