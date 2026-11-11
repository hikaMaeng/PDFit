# PDFit 0.4.6 릴리스 검증 계획 — 2026-11-11

## 요구 기준 (사용자 요청 원문)

> 지금까지 변경된 내용은 태반 기능 추가였어 이를 묶어서 0.4.6 으로 버전업 커밋 푸쉬 태깅

(사용자는 "앞으로 버전업은 수동지시로만 한다"고 정했고, 이 요청이 그 수동 지시다.)

## 범위

- 공개 저장소 `hikaMaeng/PDFit`의 `main`을 0.4.6으로 올리고 커밋·푸시하고 `v0.4.6` 태그를 만든다(0.4.5와 같은 주석 태그).
- 바꾸는 것: 루트·`apps/pdfit`·`apps/pdfit/docker`·`packages/pdfit`의 `package.json`, `package-lock.json`의 공개 워크스페이스 항목 4줄, `release-contracts/pdfit/v0.4.6.json`(0.4.5와 같은 PDFGPU 핀), `scripts/release-stage.mjs`, `tagSuggestion.ts`의 User-Agent 2곳, README·사용 문서의 설치 명령, `CHANGELOG.md`의 `[0.4.6]` 섹션.
- 범위 밖: 비공개 `apps/service`·`packages/service_domain`(0.4.5 릴리스 때와 같이 따로 맞춘다), Pro 배포, GitHub Release 문서(요청에 없음), `C:\Users\hika0\pdfit-release`.

## 절차

1. `npm run build`(PDFGPU 동기화, 릴리스 계약 검증, 전체 turbo 빌드). 합격: `source contract passed: PDFit 0.4.6 -> @pdfgpu/core@0.1.9-pdfit.1`.
2. `npm run verify:repo`.
3. `npm run deploy:standalone` 뒤 컨테이너 `healthy`, 사이드바 버전 표시가 `v0.4.6`.
4. 브라우저: `tag-index-browser.mjs`(새 버전에서 기능이 그대로인지)와 사이드바 버전 문구 확인.
5. 커밋(공개 저장소만), `git tag -a v0.4.6`, `git push origin main`, `git push origin v0.4.6`.
6. 푸시 뒤 원격에서 `main`과 `v0.4.6`이 같은 커밋을 가리키는지 `git ls-remote`로 대조.

## 합격 기준

- 릴리스 계약 검증과 `verify:repo`가 0.4.6으로 통과한다.
- 컨테이너가 `0.4.6`을 보여 주고 `healthy`다.
- 원격 `v0.4.6`이 가리키는 커밋이 로컬 릴리스 커밋과 같다.
