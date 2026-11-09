# AI 자동 태그 확인창 문서 용어 검증

## 범위

폴더의 AI 자동 태그 확인창과 무료 체험 안내에서 처리 대상을 “PDF/책”이 아닌 “문서”로 표시한다. 문서 수와 실제 자동 분류 동작은 변경하지 않는다.

## 환경·단계

1. Windows 11에서 `@pdfit/pdfit` 및 `service`를 빌드한다.
2. 루트 `docker compose up -d --build --wait --wait-timeout 60 service`로 최신 프런트를 반영하고 healthy를 확인한다.
3. `node --test apps/service/tests/appearance-samples-browser.test.mjs`로 유료 계정 60개와 무료 체험 10개 확인창의 문구, 수량 및 기존 자동 태그 동작을 Playwright Chromium에서 검증한다.
4. `git diff --check` 및 새 배포 ZIP·SHA-256·내부 이미지 체크섬을 확인한다.

## 합격 기준

유료 계정 확인창은 “태그가 없는 문서 60개”, 무료 체험 안내는 “태그가 없는 문서 중 최대 10개”와 “처리할 문서는…”을 표시하고, 자동 태그 요청 수는 기존 테스트 기대와 일치한다.
