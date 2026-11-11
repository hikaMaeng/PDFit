# 계정이 든 주소(`user:pass@host`)로 열 때 사이드바가 비는 문제 — 검증 계획 (2026-11-11)

## 요구 기준 (사용자 요청 원문)

> 주소에 기본인증 계정이 있어도 문제없는 구조까지만 정확히 수정해 그 이상 모든걸 풀어버리진 말고

배경 보고: "정확하게는 https://pdfituser42:…@pdfit.neurondev.net 이 링크로 열때만 안보여"

## 범위

- 한다: 페이지 기준 주소(`document.baseURI`)에 남은 계정을 걷어 상대 경로 `fetch`가 동작하게 한다(서비스·뷰어 진입점).
- 하지 않는다: 프록시·서버 인증 방식 변경, 기본 인증 제거, 앱 코드의 `fetch` 호출 방식 일괄 변경, 계정을 저장·전달하는 어떤 동작, 버전 올림(수동 지시로만).

## 원인 (재현으로 확인)

Chrome은 `location.href`에서만 계정을 지우고 `document.baseURI`에는 남긴다. 상대 경로 `fetch('/api/...')`가 계정이 든 주소로 완성되고, Fetch 표준은 이런 요청을 보내기 전에 `TypeError`로 거부한다.

## 절차

1. 수정 전 배포본에서 `credentials-url-browser.mjs` 실행 → 실패해야 한다(재현).
2. `ensureCredentialFreeBase` 추가, 두 진입점 시작부에서 호출.
3. `npm run deploy:standalone` 후 같은 테스트 → 통과해야 한다.
4. 회귀: `untagged-browser.mjs`, `tag-index-browser.mjs`, 계정 없는 주소에서 `<base>`가 생기지 않는지.
5. `npm run verify:repo`.

## 합격 기준

- A: 계정 주소로 사이드바 폴더 행 수 = API 폴더 수, 태그 연결 합계 = 태그 요약의 `bookCount` 합, 태그 행 수 = 요약 수, `baseURI`에 계정 없음, 상대 `fetch` 200, 계정 관련 오류 0, 프록시가 인증된 API 요청을 받음.
- B: 대조군(계정 없는 주소 + 브라우저 자격 증명)이 오류 없이 통과.
- C: 같은 계정 주소로 열린 `/viewer/...`에서 상대 `fetch` 200, 계정 관련 오류 0.
- 계정이 없는 주소에는 `<base>` 요소가 생기지 않는다.
