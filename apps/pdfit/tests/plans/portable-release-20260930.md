# Windows AMD64 이식형 배포 ZIP 검증

## 환경

- Windows 11, Docker Desktop Linux/amd64, 루트 Compose `service` 컨테이너, Chromium
- 배포 이미지: 현재 `pdfit-service:latest`
- 운영 비밀값과 사용자 데이터를 ZIP에 넣지 않는다.

## 단계

1. 서비스 컨테이너가 healthy이고 최신 브라우저 화면이 동작하는지 확인한다.
2. `release-stage.mjs`로 Windows AMD64 ZIP과 `.sha256`을 생성한다.
3. ZIP 내부에 Docker 이미지, `.env`, 설정 텍스트, Compose, Caddyfile, 설치·로그·중지 스크립트, README, `SHA256SUMS`, 빈 `data` 디렉터리가 있는지 확인한다.
4. ZIP과 내부 이미지의 SHA-256을 각각 비교한다.
5. OAuth·결제 비밀값이 비어 있는지 확인한다.

## 기대 결과

- 새 컴퓨터에서 Docker Desktop과 대상 환경의 OAuth 설정을 준비하면 설치할 수 있는 구조다.
- 패키지에 이 컴퓨터의 사용자 데이터나 인증 비밀값이 포함되지 않는다.
