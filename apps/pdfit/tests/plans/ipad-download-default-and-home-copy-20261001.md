# iPad 기본 다운로드·홈 문구 검증

## 환경

- 로컬 Docker Compose `service`, Playwright Chromium 및 WebKit 터치 컨텍스트
- PDF API는 작은 테스트 문서로 대체

## 절차

1. iPad Safari 조건에서 문서 다운로드 대화상자를 연다.
2. 안내가 `Safari에 설정된 다운로드 위치에 저장됩니다.`인지 확인한다.
3. 다운로드 버튼이 `download=1` URL을 요청하고 파일명으로 다운로드되는지 확인한다.
4. 서버가 일반 보기에는 `inline`, 다운로드 요청에는 `attachment`를 반환하는지 확인한다.
5. 홈 화면에서 버전 칩은 남고 `PDFIT 독서 작업 공간`은 없는지 확인한다.

## 실패 기준

- 이전 공유·파일 저장 안내가 남아 있음
- PDF가 다운로드 요청에서 inline으로 제공됨
- 홈의 삭제 요청 문구가 남아 있음
