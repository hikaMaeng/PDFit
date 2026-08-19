# PDFit 유료 서비스 신규 인프라 전개·도메인 설정·실서비스 런칭 계획

> 이 문서는 PDFit 개인 Google Drive 기반 PDF 서비스를 새로운 서버와 새로운 도메인에 설치하고, Paddle 결제를 연결한 뒤, 실제 유료 결제를 활성화하는 전체 운영 절차다.
>
> 문서에 적힌 명령은 Ubuntu 24.04 LTS + Docker Engine/Compose Plugin + Nginx를 기준으로 한다. Windows Docker Desktop에서도 애플리케이션 자체는 동작하지만, 지속 운영 서버는 Linux를 권장한다.

## 0. 최종 목표와 현재 제품 계약

### 0.1 제품 구조

```text
사용자 브라우저
    │ HTTPS
    ▼
DNS → Nginx 또는 Caddy(TLS 종료, 443)
    │ reverse proxy
    ▼
PDFit Service Docker(127.0.0.1:15202)
    ├─ Express API + React 정적 자산
    ├─ Google OAuth / Google Drive API
    ├─ Paddle API 호출(결제 거래 생성)
    ├─ Paddle Webhook 수신(결제 확정)
    └─ PostgreSQL 17 + pgvector(컨테이너 내부, Docker volume에 영속화)
```

PDFit의 기존 로컬 문서 서비스는 별도 제품이며 `15201` 포트를 사용한다. 개인 Google Drive 기반 유료 서비스는 `apps/service`가 소유하고 `15202`에서 실행한다. 두 서비스를 새 서버에 함께 설치할 경우 포트·도메인·Compose 프로젝트·데이터 볼륨을 절대 혼동하지 않는다.

### 0.2 판매 상품 계약

| 항목 | 확정값 |
|---|---|
| 상품 | PDFit Pro 1년 이용권 |
| 가격 | 12,000원 |
| 결제 방식 | 1회성 결제 |
| 자동 갱신 | 없음 |
| 무료 체험 | 신규 Google 계정 20일 |
| 체험 중 결제 | 결제 시점부터 365일 + 남은 체험일의 2배 |
| 중도 해지 | 정기결제가 아니므로 해지 기능 없음 |
| 이용 제한 | 체험 또는 유료기간이 끝나면 서버 API가 `402 subscription-required` 반환 |
| 결제 확정 기준 | 브라우저의 결제 완료 콜백이 아니라 Paddle `transaction.completed` 웹훅 |

현재 구현의 핵심은 브라우저 화면의 네비게이션 가드가 아니라 서버의 이용권 검사다. 따라서 사용자가 URL을 직접 입력하거나 API를 직접 호출해도 만료 후에는 보호된 라이브러리·메타데이터 API가 차단되어야 한다.

### 0.3 신규 인프라 시작 전에 반드시 해결할 저장소 문제

현재 작업 트리에서는 `apps/service/`와 `packages/service_domain/`이 Git ignore 대상이다. 따라서 공개 저장소를 새 서버에서 단순히 `git clone`하는 것만으로는 이 유료 서비스가 재현되지 않는다.

새 인프라 작업 전에 다음 중 하나를 완료한다.

1. `apps/service`와 `packages/service_domain`을 별도의 비공개 Git 저장소로 옮기고 배포 서버에 해당 저장소를 clone한다.
2. 서비스 소스와 빌드 산출물을 포함한 비공개 release bundle을 만들어 서버에 전달한다.
3. 회사 내부 artifact registry에서 버전이 고정된 `apps/service/dist`와 Docker runtime 파일을 내려받도록 배포 스크립트를 만든다.

어떤 방법을 선택하든 다음 파일이 같은 버전으로 존재해야 한다.

```text
apps/service/
apps/service/docker/Dockerfile
apps/service/docker/docker-compose.yml
apps/service/docker/entrypoint.sh
apps/service/docker/package.json
apps/service/scripts/deploy.mjs
packages/service_domain/
packages/pdfit/
package.json
package-lock.json
turbo.json
```

서비스 파일을 공개 저장소에 실수로 올리거나, `.env`, Google refresh token, Paddle API key, Paddle webhook secret을 release bundle에 포함하지 않는다.

## 1. 신규 인프라에 지속 서비스를 설치하는 과정

### 1.1 서버 사양과 운영 계정

초기 운영 기준은 다음과 같이 잡는다.

- Ubuntu 24.04 LTS 64-bit
- 외부 고정 IPv4 1개, DNS에서 A 레코드를 지정할 수 있는 환경
- CPU 2코어 이상, RAM 4GB 이상, 시스템 디스크 40GB 이상
- PostgreSQL metadata와 백업을 저장할 여유 디스크 20GB 이상
- Docker Engine과 Docker Compose Plugin
- 배포 전용 비 root 계정
- SSH 공개키 로그인
- 서버 시간 동기화 활성화(NTP/systemd-timesyncd)

PDF 파일 자체는 Google Drive에 있으므로 이 서비스는 PDF 원본을 서버에 보관하지 않는다. 다만 사용자 계정, 암호화된 Google refresh token, 폴더·태그·진행 상태, 결제 이벤트는 서버의 PostgreSQL 데이터에 저장되므로 데이터 볼륨과 백업은 필수다.

### 1.2 OS 기본 보안 설정

서버에 root로 최초 접속한 뒤 관리 계정과 방화벽을 설정한다. 실제 사용자명은 조직 정책에 맞게 바꾼다.

```bash
apt update && apt upgrade -y
apt install -y ca-certificates curl git gnupg ufw unattended-upgrades

adduser pdfitops
usermod -aG sudo,docker pdfitops

ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
ufw status verbose
```

`15202`, `5432`, `19000` 등 내부 포트는 인터넷에 열지 않는다. Compose는 서비스 포트를 `127.0.0.1:15202:15202`로만 바인딩하고, 외부 요청은 Nginx 또는 Caddy를 통해서만 받는다.

SSH 보안은 다음을 확인한다.

- 비밀번호 로그인 비활성화
- root SSH 로그인 비활성화
- 배포 계정에 필요한 sudo 권한만 부여
- 정기적인 OS 보안 업데이트와 로그인 감사 로그 보관
- 별도 모니터링 계정과 백업 계정 분리

### 1.3 Docker 설치

Docker 공식 저장소를 사용한다. 설치 후 현재 사용자가 재로그인해야 `docker` 그룹 권한이 적용된다.

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | tee /etc/apt/sources.list.d/docker.list > /dev/null

apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable --now docker
docker version
docker compose version
```

### 1.4 Compose 외부 네트워크 준비

현재 `apps/service/docker/docker-compose.yml`은 외부 Docker 네트워크 `linker`를 참조한다. 서비스가 다른 Linker 서비스와 실제 통신하지 않는 단독 서버라도 현재 Compose 계약상 네트워크가 존재해야 한다.

```bash
docker network inspect linker >/dev/null 2>&1 || docker network create linker
docker network inspect linker
```

새 인프라에서 Linker 네트워크가 필요 없도록 구조를 단순화하려면 먼저 Compose에서 `linker` 네트워크 의존성을 제거하는 별도 코드 변경과 검증을 수행한다. 서버에서 임의로 Compose 파일을 수정해 배포하지 않는다.

### 1.5 서비스 소스 배치와 버전 고정

배포 전용 경로를 만들고 비공개 저장소 또는 artifact에서 정해진 release commit을 가져온다.

```bash
mkdir -p /opt/pdfit
chown -R pdfitops:pdfitops /opt/pdfit
cd /opt/pdfit

# 비공개 저장소를 사용하는 예시
git clone --branch <release-tag> <PRIVATE_SERVICE_REPOSITORY_URL> source
cd source
git rev-parse HEAD
npm ci
```

실제 운영에서는 `<release-tag>`와 commit SHA를 배포 기록에 남긴다. `main` 최신 상태를 무검증으로 배포하지 않는다.

빌드 도구와 런타임의 책임을 구분한다.

- 호스트: Node.js, npm, workspace build, `dist` 생성
- Docker image: 이미 만들어진 `dist`를 복사하고 실행
- Dockerfile: `npm run build`, Turbo, Vite, TypeScript를 실행하지 않음
- Compose: 이미지 build/recreate, 환경변수 주입, 데이터 볼륨 연결

Node.js 버전은 repository가 선언한 범위를 확인하고, Dockerfile의 `node:22` runtime과 호환되는 버전으로 고정한다.

```bash
node --version
npm --version
npm ci
```

### 1.6 서비스 환경변수 준비

서비스 전용 환경변수는 root `.env`에 두되 Git에는 절대 커밋하지 않는다. 새 서버에서 값을 입력한 뒤 권한을 제한한다.

```bash
cd /opt/pdfit/source
cp env.example .env
chmod 600 .env
${EDITOR:-vi} .env
```

현재 서비스에 필요한 변수는 다음과 같다.

```dotenv
# Google OAuth - 새 도메인에 맞춘 값
SERVICE_GOOGLE_CLIENT_ID=<google-web-client-id>
SERVICE_GOOGLE_CLIENT_SECRET=<google-client-secret>
SERVICE_GOOGLE_REDIRECT_URI=https://<NEW_DOMAIN>/api/auth/callback

# Paddle - 처음에는 sandbox, 실서비스 전환 직전에 production
PADDLE_ENVIRONMENT=sandbox
PADDLE_CLIENT_TOKEN=<test_client_side_token>
PADDLE_PRICE_ID=<sandbox_one_time_price_id>
PADDLE_API_KEY=<sandbox_server_api_key>
PADDLE_WEBHOOK_SECRET=<sandbox_notification_endpoint_secret>
```

실제 운영 전환 시 Sandbox 값을 다음처럼 Live 값으로 교체한다.

```dotenv
PADDLE_ENVIRONMENT=production
PADDLE_CLIENT_TOKEN=<live_client_side_token>
PADDLE_PRICE_ID=<live_one_time_price_id>
PADDLE_API_KEY=<live_server_api_key>
PADDLE_WEBHOOK_SECRET=<live_notification_endpoint_secret>
```

비밀값을 확인할 때도 값 전체를 로그·터미널 캡처·문서에 출력하지 않는다. 값의 존재 여부만 확인한다.

```bash
for name in SERVICE_GOOGLE_CLIENT_ID SERVICE_GOOGLE_CLIENT_SECRET SERVICE_GOOGLE_REDIRECT_URI \
  PADDLE_ENVIRONMENT PADDLE_CLIENT_TOKEN PADDLE_PRICE_ID PADDLE_API_KEY PADDLE_WEBHOOK_SECRET; do
  grep -q "^${name}=." .env && echo "${name}: configured" || echo "${name}: MISSING"
done
```

위의 짧은 확인 명령을 사용할 때 셸 문법 오류가 없는지 먼저 확인한다. 더 안전한 방법은 값을 출력하지 않는 별도 점검 스크립트를 사용하는 것이다. `PADDLE_API_KEY`와 `PADDLE_WEBHOOK_SECRET`은 서버에서만 사용하고, `PADDLE_CLIENT_TOKEN`은 Paddle.js 초기화용으로만 브라우저에 전달한다. Paddle도 API key는 서버 전용, client-side token은 Paddle.js 전용으로 분리하도록 안내한다.

### 1.7 첫 배포와 Docker 확인

서비스 전용 공식 진입점은 `npm run deploy --workspace=service`다. `apps/service/docs/usage.md`에 남아 있는 `npm run deploy:service` 표기는 현재 package script와 불일치하므로 신규 운영자는 실제 package.json 기준 명령을 사용한다.

```bash
cd /opt/pdfit/source
npm run deploy --workspace=service
```

이 명령은 다음을 순서대로 수행한다.

1. `@pdfit/service_domain` build
2. `service` front build
3. `service` server TypeScript build
4. service-domain dist 동기화
5. `docker compose config --quiet`
6. `docker compose up -d --build --force-recreate --remove-orphans service`

별도의 `docker compose up -d`만 실행하지 않는다. 배포 전후의 상태를 기록한다.

```bash
docker compose --env-file .env -f apps/service/docker/docker-compose.yml ps
docker compose --env-file .env -f apps/service/docker/docker-compose.yml logs --tail=200 service
curl -fsS http://127.0.0.1:15202/health
```

정상 응답은 다음 형태여야 한다.

```json
{"ok":true,"service":"pdfit-service"}
```

컨테이너 내부에서 PostgreSQL이 기동되고 schema가 생성되는지 확인한다.

```bash
docker exec pdfit-service-service-1 pg_isready -U service -d service
docker exec pdfit-service-service-1 psql -U service -d service -c '\dt'
```

컨테이너 이름은 Compose 프로젝트명에 따라 달라질 수 있으므로 먼저 `docker compose ps -q service`로 ID를 얻어 사용한다.

### 1.8 데이터 볼륨과 백업

현재 서비스는 `service-data` Docker named volume 아래 PostgreSQL data directory를 저장한다. 데이터 볼륨을 지우면 사용자 계정·세션·Google refresh token·Drive metadata·결제 이벤트가 사라질 수 있으므로 다음 명령을 운영 절차에 넣는다.

```bash
docker volume ls | grep pdfit-service
docker volume inspect pdfit-service_service-data
```

최소 백업 정책:

- 매일 PostgreSQL logical backup
- 매주 Docker volume 또는 서버 디스크 snapshot
- 서로 다른 저장소에 암호화 보관
- 최근 7일 daily + 최근 4주 weekly + 월별 장기 보관
- 분기마다 실제 복구 리허설
- backup 성공/실패 모니터링

Logical backup 예시:

```bash
mkdir -p /var/backups/pdfit
docker exec pdfit-service-service-1 pg_dump -U service -d service --format=custom \
  > /var/backups/pdfit/service-$(date +%F).dump
chmod 600 /var/backups/pdfit/*.dump
```

백업 파일은 같은 서버에만 두지 않는다. 복구 전에는 현재 볼륨을 별도 snapshot으로 보존하고, 기존 production container에 바로 덮어쓰지 말고 임시 Compose project에서 복구 검증을 수행한다.

복구 후 확인 항목:

- `service_users` 계정 수와 최신 로그인 계정
- `service_subscriptions` 유료 상태와 만료일
- `service_billing_events` event_id/transaction_id 중복 여부
- `/health` 응답
- Google OAuth 재로그인
- `/api/billing/status`
- 유료 계정의 `/api/folders`

## 2. 새로운 도메인 기반 설정

### 2.1 DNS

예시 도메인을 `pdfit.example.com`이라고 한다. 실제 운영에서는 사용자 소유 도메인으로 교체한다.

1. DNS provider에 `A` 레코드 `pdfit.example.com → <SERVER_PUBLIC_IP>`를 만든다.
2. IPv6를 실제로 운영하지 않으면 잘못된 `AAAA` 레코드를 만들지 않는다.
3. `dig +short pdfit.example.com` 또는 DNS provider의 확인 도구로 새 IP를 확인한다.
4. DNS 전파가 끝난 뒤 인증서 발급을 진행한다.

```bash
dig +short pdfit.example.com
```

### 2.2 Nginx와 HTTPS

먼저 HTTP에서 Nginx를 설치하고 80번 포트를 연결한 뒤 Let’s Encrypt 인증서를 발급한다.

```bash
apt install -y nginx certbot python3-certbot-nginx
systemctl enable --now nginx
```

`/etc/nginx/sites-available/pdfit-service` 예시:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name pdfit.example.com;

    location / {
        proxy_pass http://127.0.0.1:15202;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 120s;
        client_max_body_size 1m;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/pdfit-service /etc/nginx/sites-enabled/pdfit-service
nginx -t
systemctl reload nginx
certbot --nginx -d pdfit.example.com
systemctl status certbot.timer
```

HTTPS가 실제로 동작하는지 확인한다.

```bash
curl -fsS https://pdfit.example.com/health
curl -I http://pdfit.example.com/health
```

HTTP 요청은 인증서 발급 이후 HTTPS로 redirect되어야 한다. 인증서 자동 갱신은 `certbot renew --dry-run`으로 사전에 확인한다.

### 2.3 Google Cloud OAuth 설정

새 도메인에서는 Google OAuth client의 승인된 origin과 callback을 새 도메인으로 다시 등록한다.

#### Google Cloud 프로젝트

1. Google Cloud Console에서 서비스용 프로젝트를 선택하거나 새 프로젝트를 만든다.
2. Google Auth Platform의 Branding에서 앱 이름, 지원 이메일, 개발자 연락처를 입력한다.
3. Homepage URL을 `https://pdfit.example.com/`으로 설정한다.
4. 개인정보처리방침과 지원 페이지 URL을 실제 공개 페이지로 등록한다.
5. Data access에 다음 scope를 정확히 등록한다.

```text
openid
email
profile
https://www.googleapis.com/auth/drive.file
```

PDFit은 사용자의 Drive 파일을 서버로 업로드하는 서비스가 아니라 Google Drive API를 통해 개인 라이브러리를 읽고 관리하는 서비스이므로 코드의 scope와 Cloud Console의 등록 scope를 다르게 만들지 않는다. scope가 누락되면 Google의 미검증 앱 경고가 발생할 수 있다.

#### OAuth Client

OAuth Client Type은 Web application으로 설정한다.

```text
Authorized JavaScript origins
https://pdfit.example.com

Authorized redirect URIs
https://pdfit.example.com/api/auth/callback
```

마지막 `/`, `http`/`https`, 서브도메인, 경로를 임의로 바꾸지 않는다. `.env`의 `SERVICE_GOOGLE_REDIRECT_URI`와 Google Cloud의 redirect URI는 완전히 동일해야 한다.

#### 로그인 검증

1. 로그아웃 상태에서 `https://pdfit.example.com/` 접속
2. Google 로그인 버튼 선택
3. OAuth consent 화면 확인
4. callback 후 PDFit 화면 복귀 확인
5. 좌측 하단에 Google 이름·이메일·`체험판 (20일 남음)` 표시 확인
6. 다시 로그아웃 후 로그인 재시도
7. 여러 로그인 탭을 동시에 열어도 OAuth state가 정상 처리되는지 확인

Google 계정의 refresh token은 브라우저나 Vite asset에 노출하지 않는다. 서버 PostgreSQL에 암호화되어 저장되는지 로그와 DB 구조로 확인한다.

### 2.4 도메인 변경에 따른 Paddle Checkout 설정

Paddle은 Sandbox와 Live가 별도 workspace다. 제품, 가격, client-side token, API key, notification destination, 고객 데이터가 환경 간에 공유되지 않으므로 Sandbox에서 만든 ID와 credential을 Live에 재사용하지 않는다. 운영 도메인을 Paddle Checkout의 승인된 웹사이트 도메인으로 등록한 뒤 Live에서 각각 새로 만든다.

Paddle 공식 참고:

- [Sandbox와 Live 환경 분리](https://developer.paddle.com/sdks/sandbox/)
- [Live 전환 체크리스트](https://developer.paddle.com/build/go-live-checklist/)
- [거래 생성 API](https://developer.paddle.com/api-reference/transactions/create-transaction/)
- [client-side token](https://developer.paddle.com/paddle-js/about/client-side-tokens/)
- [웹훅 서명 검증](https://developer.paddle.com/webhooks/about/signature-verification/)

#### Sandbox에서 먼저 만들 항목

1. Product: `PDFit Pro 1년 이용권`
2. Price: `₩12,000`, one-time purchase, 통화 KRW
3. Sandbox client-side token: Paddle.js 초기화용
4. Sandbox server API key: transaction 생성용, 필요한 transaction 권한만 부여
5. Notification destination:

```text
https://pdfit.example.com/api/billing/webhook
```

6. 이벤트: `transaction.completed`
7. Webhook endpoint secret: 서버 `.env`에만 저장
8. Checkout website approval/default payment link: 새 도메인으로 설정

서비스는 `/api/billing/checkout`에서 서버 API key로 Paddle `/transactions`를 호출하며 `custom_data.userId`를 넣는다. 브라우저는 응답으로 받은 transaction ID와 client-side token으로 Paddle Checkout을 연다. API key를 JavaScript asset이나 브라우저 요청에 포함하지 않는다.

#### Sandbox 검증

Sandbox에서 다음을 완주한 뒤에만 Live 설정으로 넘어간다.

- 체험판 계정에서 pricing 화면 표시
- Paddle Checkout 열림
- 테스트 카드 결제 완료
- Paddle이 `transaction.completed`를 공개 webhook URL로 전송
- 서버가 `Paddle-Signature`를 원문 body 기준으로 검증
- `event_id`, `transaction_id`, `userId`, 설정된 price ID, `data.status=completed`를 검증
- DB가 한 번만 유료 전환
- 같은 웹훅 재전송 시 중복 이용권이 생기지 않음
- 화면 새로고침 후 `유료`와 이용기간 표시

Paddle 서명 검증은 `ts:rawBody`를 HMAC-SHA256으로 계산하고, timestamp 허용 오차를 5초로 제한한다. Express JSON parser가 원문 body를 변형하기 전에 webhook route가 `express.raw()`로 body를 받아야 한다.

#### Live에서 다시 만들 항목

Sandbox 검증이 끝난 뒤 Paddle Live workspace에서 아래 항목을 각각 새로 만든다.

- Live product
- Live KRW one-time price
- Live client-side token(`live_` 계열)
- Live API key(`transaction.write` 등 최소 권한)
- Live notification destination
- Live webhook secret
- Live checkout website approval

Live에서 Sandbox의 `test_` client token, `sdbx` API key, Sandbox price ID, Sandbox webhook secret을 사용하면 안 된다. 환경과 credential이 맞지 않으면 Paddle API가 거부한다.

## 3. 실제 서비스 런칭 후 유료결제 활성화

### 3.1 Live 활성화 전 Go/No-Go 조건

다음 항목 중 하나라도 `미확인`이면 Live 결제를 활성화하지 않는다.

| 확인 항목 | 통과 기준 |
|---|---|
| 소스 재현성 | 새 서버에서 서비스 소스/패키지/lockfile을 동일 release로 확보 |
| Docker | `docker compose config --quiet` 통과, service health 정상 |
| HTTPS | 새 도메인에서 인증서와 redirect 정상 |
| Google OAuth | 로그인·callback·Drive scope·refresh token 저장 확인 |
| DB | `service-data` volume과 복구 가능한 백업 존재 |
| Sandbox 결제 | Checkout·웹훅·DB 유료 전환·중복 방지 완료 |
| webhook | 공개 URL에서 유효 서명 200, 무효 서명 401, 잘못된 price/user 400 |
| 접근 제한 | 체험/유료 만료 후 보호 API 402 |
| Paddle Live | Live seller 승인, 도메인 승인, Live product/price/credential 생성 |
| 운영 정책 | 환불·chargeback·지원 이메일·개인정보처리방침·영수증 처리 정책 확정 |
| 백업 | 최근 backup과 복구 테스트 증거 존재 |

### 3.2 Live credential 적용

점검 창을 정하고 `.env`의 Paddle 부분만 교체한다. Google OAuth와 DB credential은 필요 없으면 건드리지 않는다.

```dotenv
PADDLE_ENVIRONMENT=production
PADDLE_CLIENT_TOKEN=<LIVE_CLIENT_TOKEN>
PADDLE_PRICE_ID=<LIVE_PRICE_ID>
PADDLE_API_KEY=<LIVE_API_KEY>
PADDLE_WEBHOOK_SECRET=<LIVE_ENDPOINT_SECRET>
```

적용 후 반드시 공식 배포 명령을 사용한다.

```bash
cd /opt/pdfit/source
npm run deploy --workspace=service
```

배포 직후 다음을 확인한다.

```bash
docker compose --env-file .env -f apps/service/docker/docker-compose.yml ps
curl -fsS https://pdfit.example.com/health
docker compose --env-file .env -f apps/service/docker/docker-compose.yml logs --tail=100 service
```

로그에는 API key나 webhook secret이 출력되면 안 된다. 컨테이너 환경변수를 확인할 때도 변수명만 출력하거나 값은 앞뒤 일부만 마스킹한다.

### 3.3 첫 Live 결제

실제 결제는 운영자 또는 내부 승인된 계정으로 1건만 먼저 수행한다. Paddle Live에서는 Sandbox 테스트 카드가 아니라 실제 결제 수단을 사용하며, 금액 12,000원과 세금 표시를 확인한다.

순서:

1. 실제 Google 계정으로 PDFit 로그인
2. 체험판 상태와 체험 종료일 확인
3. `Pro 결제하기` 선택
4. Paddle Checkout에서 상품명과 `₩12,000` 확인
5. 실제 결제 승인
6. Paddle transaction ID 기록
7. Paddle Notifications에서 `transaction.completed` delivery 확인
8. 서비스 webhook 응답 HTTP 200 확인
9. PostgreSQL에서 해당 `event_id`, `transaction_id`, user ID 확인
10. `/api/billing/status`와 화면에서 `active`/`유료` 확인
11. 보호 API `/api/folders`가 200인지 확인
12. 새로고침·로그아웃·재로그인 후에도 유료 상태 유지 확인

DB 확인 예시:

```bash
docker exec pdfit-service-service-1 psql -U service -d service -P pager=off -c \
"SELECT status,
        trial_ends_at AT TIME ZONE 'Asia/Seoul' AS trial_ends_kst,
        current_period_ends_at AT TIME ZONE 'Asia/Seoul' AS paid_ends_kst,
        cancel_at_period_end
   FROM service_subscriptions
  WHERE user_id='<GOOGLE_SUB>';"

docker exec pdfit-service-service-1 psql -U service -d service -P pager=off -c \
"SELECT event_id, transaction_id, user_id, created_at
   FROM service_billing_events
  WHERE user_id='<GOOGLE_SUB>'
  ORDER BY created_at DESC;"
```

결제 완료 화면만으로 유료 권한을 부여하지 않는다. Paddle 웹훅과 DB 반영이 확인되지 않으면 결제는 성공했지만 서비스 권한이 아직 확정되지 않은 상태로 처리한다.

### 3.4 공개 유료결제 활성화

첫 Live 결제와 웹훅 검증이 끝난 뒤에만 일반 사용자에게 가격 화면을 노출한다.

- `PADDLE_ENVIRONMENT=production`인지 확인
- `PADDLE_PRICE_ID`가 Live 12,000원 one-time price인지 확인
- Paddle client token이 `live_`인지 확인
- Paddle API key가 서버 환경변수에만 존재하는지 확인
- `PADDLE_WEBHOOK_SECRET`이 해당 Live notification destination의 secret인지 확인
- Paddle notification endpoint가 새 도메인인지 확인
- `BILLING_MOCK_ENABLED`를 production에서 켜지 않음
- `/api/billing/checkout`이 503이 아니라 transaction ID를 반환하는지 확인
- 실제로 결제하지 않은 신규 계정은 체험판으로 시작하는지 확인
- 모든 유료 상태는 webhook에서만 발생하는지 확인

이 시점부터 Sandbox 계정의 결제 기록은 운영 유료 계정으로 사용하지 않는다. 운영팀은 Live transaction ID, 사용자 Google `sub`, Paddle event ID를 내부 장애 대응 기록에 남긴다. API key·client token·webhook secret 자체는 기록하지 않는다.

## 4. 운영 중 상태 전이와 검증 시나리오

### 4.1 정상 상태

| DB 조건 | 화면 | 보호 API |
|---|---|---:|
| `status=trial`, `trial_ends_at > now()` | `체험판 (N일 남음)`, 결제 버튼 | 200 |
| `status=active`, `current_period_ends_at > now()` | `유료`, 1년 이용권 활성 | 200 |
| `status=trial`, `trial_ends_at <= now()` | `결제 필요`, 결제 버튼 | 402 |
| `status=active`, `current_period_ends_at <= now()` | `결제 필요`, 결제 버튼 | 402 |

화면의 guard는 사용성을 위한 것이고, 실제 제한은 `apps/service/src/server/app.ts`의 server-side subscription gate가 수행한다.

### 4.2 수동 만료 테스트

운영 DB를 직접 조작해 테스트할 때는 반드시 다음 절차를 지킨다.

1. 대상 Google `sub`를 확인한다.
2. 현재 row를 백업하거나 정확한 원래 값을 기록한다.
3. 테스트 전용 세션을 만들고, 운영자 브라우저 세션을 사용하지 않는다.
4. `trial_ends_at` 또는 `current_period_ends_at`을 과거로 설정한다.
5. 화면 screenshot과 보호 API의 402를 함께 기록한다.
6. 원래 값을 `UPDATE`로 복구한다.
7. 복구 후 `/api/billing/status`, 화면, 보호 API를 다시 확인한다.
8. 임시 세션과 테스트 데이터를 삭제한다.

DB 날짜를 조작한 채로 배포 창을 종료하거나, 사용자의 실제 이용기간을 임의로 연장·단축하지 않는다.

### 4.3 웹훅 중복과 지연

Paddle은 네트워크 실패 시 delivery를 재시도할 수 있으므로 `service_billing_events.event_id`와 `transaction_id`가 모두 중복 방지 기준이다.

- 동일 `event_id` 재전송: 200으로 처리하되 두 번째 이용권을 만들지 않음
- 동일 `transaction_id`가 다른 event ID로 들어옴: 중복 구매인지 조사하고 자동 연장하지 않음
- 잘못된 signature: 401
- 만료된 timestamp: 401
- 존재하지 않는 user ID: 400
- 설정되지 않은 price ID: 400
- Paddle API/환경변수 미설정: checkout 503, webhook 503

운영자가 webhook을 수동 재전송할 때는 먼저 DB의 event/transaction row와 현재 subscription을 확인한다.

### 4.4 환불·chargeback 정책의 Go-Live 차단 항목

현재 코드의 유료 전환은 `transaction.completed`만 처리하며, 환불이나 chargeback으로 이미 부여된 이용권을 자동 회수하는 흐름은 별도 구현 대상이다. 실제 Live 오픈 전에 다음 중 하나를 사업 정책으로 확정한다.

1. 환불·chargeback 발생 시 수동으로 계정을 검토하고 DB 상태를 정정한다.
2. Paddle의 환불·조정 관련 이벤트를 추가 구독하고, transaction ID를 기준으로 이용권 회수/정지 로직을 구현한다.

자동 회수가 필요한 사업 정책이라면 이 항목을 구현·테스트하기 전에는 “완전한 운영 결제”로 선언하지 않는다. 어떤 경우에도 Paddle의 브라우저 redirect나 사용자가 보낸 요청만으로 환불 상태를 신뢰하지 않는다.

## 5. 모니터링과 장애 대응

### 5.1 상시 모니터링

- `https://pdfit.example.com/health` 1분 간격 외부 monitor
- HTTP 5xx 비율과 응답시간
- Docker container restart count
- PostgreSQL data volume 사용량
- 백업 최근 성공 시간
- webhook 401/400/500/503 수
- Paddle checkout transaction 생성 실패 수
- 신규 가입 대비 결제 완료 수
- 결제 완료 후 5분 안에 subscription이 active가 되지 않은 transaction 수

서비스 로그는 개인정보·credential·refresh token·API key·카드 데이터를 출력하지 않는다. 사용자 이메일은 장애 추적에 필요할 때도 최소한으로 마스킹한다.

### 5.2 결제는 성공했지만 유료가 되지 않을 때

1. Paddle transaction이 `completed`인지 확인한다.
2. notification destination URL이 현재 도메인인지 확인한다.
3. delivery HTTP status를 확인한다.
4. `Paddle-Signature` secret이 현재 Live destination secret인지 확인한다.
5. `PADDLE_PRICE_ID`가 transaction items의 Live price ID와 같은지 확인한다.
6. webhook payload의 `custom_data.userId`가 `service_users.id`와 같은지 확인한다.
7. 컨테이너 로그에서 `Webhook processing failed`를 확인한다.
8. 원본 payload를 수정하지 말고 Paddle에서 안전하게 delivery를 재전송한다.
9. 재전송 후 event/transaction 중복 방지가 정상인지 확인한다.

Paddle이 200을 받았는데 DB가 바뀌지 않았다는 이유로 수동 `active`를 바로 넣지 않는다. 먼저 event ID와 transaction ID를 저장해 reconciliation한다.

### 5.3 서비스가 내려갔을 때

```bash
docker compose --env-file .env -f apps/service/docker/docker-compose.yml ps
docker compose --env-file .env -f apps/service/docker/docker-compose.yml logs --tail=300 service
curl -v http://127.0.0.1:15202/health
df -h
docker system df
```

재시작은 원인을 확인한 뒤 수행한다.

```bash
docker compose --env-file .env -f apps/service/docker/docker-compose.yml restart service
```

데이터 볼륨 삭제, `docker system prune`, Compose project 삭제, PostgreSQL 초기화는 장애 대응의 첫 단계로 사용하지 않는다.

## 6. 배포 업데이트와 롤백

### 6.1 일반 업데이트

1. 변경 commit과 release tag 생성
2. 변경된 DB schema/이전 호환성 확인
3. backup 생성
4. staging 또는 Sandbox 결제 검증
5. 새 서버에서 release checkout
6. `.env`는 유지하고 이미지/소스만 교체
7. `npm run deploy --workspace=service`
8. `/health`, Google login, billing status, Paddle checkout, webhook 확인
9. headless browser evidence 저장
10. 배포 commit/이미지 tag/health 결과 기록

### 6.2 롤백

애플리케이션 버전만 이전 release로 되돌린다.

```bash
git checkout <previous-release-tag>
npm ci
npm run deploy --workspace=service
```

DB volume을 삭제하거나 이전 버전의 schema를 무조건 덮어쓰지 않는다. 이미 결제된 Paddle transaction은 애플리케이션 rollback으로 취소되지 않으므로, rollback 후 현재 subscription과 `service_billing_events`를 대조한다.

결제 webhook이 수신된 뒤 구버전으로 rollback하는 경우에도 이전 버전이 해당 event를 안전하게 무시하거나 처리할 수 있는지 확인한다. webhook contract가 바뀐 release는 backward-compatible 기간을 둔다.

## 7. 최종 런칭 체크리스트

### 인프라

- [ ] 고정 IP와 DNS A/AAAA 정책 확정
- [ ] 방화벽은 SSH/80/443만 외부 허용
- [ ] Docker Engine/Compose 설치 및 자동 시작
- [ ] `linker` 외부 네트워크 존재
- [ ] 서비스 소스와 `package-lock.json` 재현성 확인
- [ ] `.env` 생성, 권한 600, Git 미추적 확인
- [ ] `service-data` volume 백업과 복구 테스트 완료
- [ ] Nginx/Caddy reverse proxy와 HTTPS 정상
- [ ] `/health` 외부 응답 정상

### Google

- [ ] 새 도메인 homepage 등록
- [ ] 개인정보처리방침/지원 URL 등록
- [ ] `drive.file` scope 등록
- [ ] OAuth origin 등록
- [ ] callback URI가 코드·Google Cloud·`.env`에서 동일
- [ ] 실제 Google 계정 로그인·로그아웃·재로그인 확인
- [ ] refresh token이 client/log/asset에 노출되지 않음

### Paddle Sandbox

- [ ] Sandbox product/price 생성
- [ ] Sandbox client token/API key/webhook secret 설정
- [ ] Sandbox notification destination이 새 도메인
- [ ] `transaction.completed` webhook delivery 성공
- [ ] 유효/무효 signature 테스트
- [ ] 실제 service 화면에서 결제 후 `유료`
- [ ] DB event/transaction idempotency 확인
- [ ] 체험판 활성/만료와 유료 활성/만료 각각 402 테스트

### Paddle Live

- [ ] Live seller 승인
- [ ] Live website/domain 승인
- [ ] Live product/12,000원 one-time price 생성
- [ ] Live client-side token 생성
- [ ] 최소 권한 Live API key 생성
- [ ] Live notification destination/webhook secret 생성
- [ ] `.env`를 Live 값으로 교체
- [ ] Sandbox credential이 남아 있지 않음
- [ ] 내부 승인 계정으로 첫 실제 결제 완료
- [ ] Paddle transaction·webhook·DB·화면을 하나의 transaction ID로 대조
- [ ] 환불/chargeback 정책과 대응 담당자 확정

### 공개 오픈

- [ ] 가격 페이지의 상품명·금액·세금 표시 확인
- [ ] 신규 계정은 20일 체험판으로 시작
- [ ] 모든 보호 메뉴가 만료 계정을 pricing으로 보내고 API도 402
- [ ] 유료 계정이 새로고침·로그아웃·재로그인 후에도 유지
- [ ] 외부 health monitor와 backup monitor 활성
- [ ] 장애 연락처와 Paddle webhook 대응 절차 공유
- [ ] 배포 release SHA, 환경 전환 시각, 첫 transaction ID를 내부 기록

## 8. 현재 코드 기준 핵심 파일 지도

| 영역 | 경로 | 역할 |
|---|---|---|
| 서비스 Compose | `apps/service/docker/docker-compose.yml` | 15202, service-data volume, Google/Paddle env wiring |
| runtime image | `apps/service/docker/Dockerfile` | pgvector PostgreSQL + Node runtime, healthcheck |
| PostgreSQL entrypoint | `apps/service/docker/entrypoint.sh` | DB 초기화와 service process 시작 |
| 배포 | `apps/service/scripts/deploy.mjs` | domain build, dist sync, Compose config/up |
| server wiring | `apps/service/src/server/index.ts` | Google/Paddle config와 store 조립 |
| HTTP application | `apps/service/src/server/app.ts` | auth, webhook raw body, API auth, 402 gate, static serving |
| billing | `apps/service/src/server/billingRouter.ts` | transaction 생성, signature 검증, idempotent fulfillment |
| OAuth | `apps/service/src/server/authRouter.ts` | Google callback, HttpOnly session cookie |
| subscription model | `packages/service_domain/src/common/subscription.ts` | trial/active/expired projection과 bonus 계산 |
| persistence | `packages/service_domain/src/server/store.ts` | users, sessions, subscriptions, billing events, metadata |
| pricing UI | `apps/service/src/front/billing/PricingPage.tsx` | status, trial date, bonus, Paddle Checkout |
| account footer | `apps/service/src/front/auth/AccountFooter.tsx` | 로그인 계정과 유료/체험/결제 필요 표시 |
| service API docs | `apps/service/docs/api.md` | billing/webhook/access contract |
| service constraints | `apps/service/docs/constraints.md` | server-side access/security invariants |

이 문서는 운영자가 새로운 인프라에서 실행할 순서를 정의한다. 코드·도메인·Paddle 정책이 바뀌면 이 문서의 해당 단계와 최종 체크리스트를 같은 변경에서 갱신한다.
