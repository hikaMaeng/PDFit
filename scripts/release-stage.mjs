import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const version = '0.4.3';
const sourceImage = process.env.PDFIT_SERVICE_IMAGE ?? 'pdfit-service:latest';
const releaseImage = `pdfit/service:${version}`;
const repositoryRoot = resolve(import.meta.dirname, '..');
const releaseRoot = join(repositoryRoot, 'release');
const archivePath = join(releaseRoot, `PDFit-Service-${version}-windows-amd64.zip`);
const checksumPath = `${archivePath}.sha256`;
const stageRoot = mkdtempSync(join(tmpdir(), 'pdfit-service-release-'));
const imageFilename = `pdfit-service-image-${version}-linux-amd64.tar`;
const imagePath = join(stageRoot, imageFilename);

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', ...options });
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase();
}

function write(name, content) {
  writeFileSync(join(stageRoot, name), content.replace(/^\n/, ''), 'utf8');
}

const imageArchitecture = execFileSync(
  'docker',
  ['image', 'inspect', sourceImage, '--format', '{{.Architecture}}'],
  { encoding: 'utf8' },
).trim();
if (imageArchitecture !== 'amd64') {
  throw new Error(`${sourceImage} must be a linux/amd64 image; received ${imageArchitecture}.`);
}

mkdirSync(releaseRoot, { recursive: true });

write('docker-compose.yml', `
services:
  service:
    image: ${releaseImage}
    init: true
    env_file:
      - .env
    environment:
      GOOGLE_CLIENT_ID: \${SERVICE_GOOGLE_CLIENT_ID}
      GOOGLE_CLIENT_SECRET: \${SERVICE_GOOGLE_CLIENT_SECRET}
      GOOGLE_REDIRECT_URI: \${SERVICE_GOOGLE_REDIRECT_URI}
      MAX_UPLOAD_MB: \${SERVICE_MAX_UPLOAD_MB:-2048}
      BILLING_MOCK_ENABLED: \${BILLING_MOCK_ENABLED:-false}
      PADDLE_ENVIRONMENT: \${PADDLE_ENVIRONMENT:-production}
      PADDLE_CLIENT_TOKEN: \${PADDLE_CLIENT_TOKEN:-}
      PADDLE_PRICE_ID: \${PADDLE_PRICE_ID:-}
      PADDLE_API_KEY: \${PADDLE_API_KEY:-}
      PADDLE_WEBHOOK_SECRET: \${PADDLE_WEBHOOK_SECRET:-}
    ports:
      - "\${SERVICE_BIND_ADDRESS:-127.0.0.1}:\${SERVICE_PORT:-15202}:15202"
    volumes:
      - type: bind
        source: ./data
        target: /app/data
    restart: unless-stopped
    networks:
      default: {}
      proxy:
        aliases:
          - pdfit-service

networks:
  proxy:
    external: true
    name: \${PDFIT_PROXY_NETWORK:-m42-proxy}
`);

write('.env', `
SERVICE_GOOGLE_CLIENT_ID=CHANGE_ME
SERVICE_GOOGLE_CLIENT_SECRET=CHANGE_ME
SERVICE_GOOGLE_REDIRECT_URI=http://localhost:15202/api/auth/callback
SERVICE_BIND_ADDRESS=127.0.0.1
SERVICE_PORT=15202
SERVICE_MAX_UPLOAD_MB=2048
PDFIT_PROXY_NETWORK=m42-proxy
BILLING_MOCK_ENABLED=false
PADDLE_ENVIRONMENT=production
PADDLE_CLIENT_TOKEN=
PADDLE_PRICE_ID=
PADDLE_API_KEY=
PADDLE_WEBHOOK_SECRET=
`);

write('install.ps1', `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$bundleRoot = $PSScriptRoot
$envPath = Join-Path $bundleRoot '.env'
$imagePath = Join-Path $bundleRoot '${imageFilename}'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker Desktop 또는 Docker Engine을 먼저 설치해 주세요.'
}
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker가 실행 중인지 확인해 주세요.' }

$settings = @{}
Get-Content -LiteralPath $envPath | ForEach-Object {
  if ($_ -match '^([^#=]+)=(.*)$') { $settings[$matches[1].Trim()] = $matches[2].Trim() }
}
foreach ($requiredKey in @('SERVICE_GOOGLE_CLIENT_ID', 'SERVICE_GOOGLE_CLIENT_SECRET', 'SERVICE_GOOGLE_REDIRECT_URI', 'PDFIT_PROXY_NETWORK')) {
  if (-not $settings[$requiredKey] -or $settings[$requiredKey] -eq 'CHANGE_ME') {
    throw ".env의 $requiredKey 값을 먼저 입력해 주세요."
  }
}
try { [uri]$settings['SERVICE_GOOGLE_REDIRECT_URI'] | Out-Null } catch { throw 'SERVICE_GOOGLE_REDIRECT_URI가 올바른 URL이 아닙니다.' }

$expectedHash = ((Get-Content -LiteralPath (Join-Path $bundleRoot 'SHA256SUMS.txt')) -split '\\s+')[0]
$actualHash = (Get-FileHash -LiteralPath $imagePath -Algorithm SHA256).Hash
if ($actualHash -ne $expectedHash) { throw 'Docker 이미지 체크섬이 일치하지 않습니다.' }

New-Item -ItemType Directory -Path (Join-Path $bundleRoot 'data') -Force | Out-Null
docker network inspect $settings['PDFIT_PROXY_NETWORK'] *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "프록시 네트워크 '$($settings['PDFIT_PROXY_NETWORK'])'를 생성하는 중..."
  docker network create $settings['PDFIT_PROXY_NETWORK'] *> $null
  if ($LASTEXITCODE -ne 0) { throw '프록시 Docker 네트워크 생성에 실패했습니다.' }
}

Write-Host '[1/4] 서비스 이미지를 불러오는 중...'
docker load --input $imagePath
if ($LASTEXITCODE -ne 0) { throw 'Docker 이미지 불러오기에 실패했습니다.' }

Write-Host '[2/4] 구성을 검사하는 중...'
docker compose --project-name pdfit-service --env-file $envPath --file (Join-Path $bundleRoot 'docker-compose.yml') config --quiet
if ($LASTEXITCODE -ne 0) { throw 'Compose 구성 검사에 실패했습니다.' }

Write-Host '[3/4] PDFit 서비스를 시작하는 중...'
docker compose --project-name pdfit-service --env-file $envPath --file (Join-Path $bundleRoot 'docker-compose.yml') up -d --force-recreate --remove-orphans
if ($LASTEXITCODE -ne 0) { throw 'PDFit 서비스 시작에 실패했습니다.' }

Write-Host '[4/4] 서비스 상태를 확인하는 중...'
$healthy = $false
for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
  $health = docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' pdfit-service-service-1 2>$null
  if ($health -eq 'healthy') { $healthy = $true; break }
  if ($health -eq 'unhealthy' -or $health -eq 'exited') { break }
  Start-Sleep -Seconds 2
}
if (-not $healthy) {
  docker compose --project-name pdfit-service --env-file $envPath --file (Join-Path $bundleRoot 'docker-compose.yml') logs --tail 100 service
  throw '서비스가 정상 상태가 되지 않았습니다. 위 로그를 확인해 주세요.'
}

$bindAddress = $settings['SERVICE_BIND_ADDRESS']
if (-not $bindAddress -or $bindAddress -eq '0.0.0.0') { $bindAddress = 'localhost' }
Write-Host "PDFit Service가 정상 실행 중입니다: http://$bindAddress\`:$($settings['SERVICE_PORT'])" -ForegroundColor Green
`);

write('stop.ps1', `
$ErrorActionPreference = 'Stop'
docker compose --project-name pdfit-service --env-file (Join-Path $PSScriptRoot '.env') --file (Join-Path $PSScriptRoot 'docker-compose.yml') down
`);

write('logs.ps1', `
$ErrorActionPreference = 'Stop'
docker compose --project-name pdfit-service --env-file (Join-Path $PSScriptRoot '.env') --file (Join-Path $PSScriptRoot 'docker-compose.yml') logs --follow --tail 200 service
`);

write('README.md', `
# PDFit Service ${version} 이식형 배포 패키지

이 ZIP은 Windows 11의 Docker Desktop에서 PDFit 서비스와 내장 PostgreSQL을 실행합니다.
소스 저장소나 Node.js 설치는 필요하지 않으며, 사용자 PDF와 메타데이터는 Google Drive에 저장됩니다.

## 설치

1. ZIP을 쓰기 가능한 영문 경로에 완전히 압축 해제합니다.
2. Docker Desktop을 설치하고 Linux 컨테이너 모드로 실행합니다.
3. Google Cloud Console에서 Drive API와 Sheets API를 활성화하고 OAuth 웹 클라이언트를 만듭니다.
4. 이 폴더의 \`.env\`에서 다음 값을 설정합니다.
   - \`SERVICE_GOOGLE_CLIENT_ID\`
   - \`SERVICE_GOOGLE_CLIENT_SECRET\`
   - \`SERVICE_GOOGLE_REDIRECT_URI\`
5. PowerShell에서 \`powershell -ExecutionPolicy Bypass -File .\\install.ps1\`을 실행합니다.

기본 로컬 주소는 \`http://localhost:15202\`, 기본 OAuth 콜백은
\`http://localhost:15202/api/auth/callback\`입니다. Google OAuth의 승인된 리디렉션 URI에도
같은 값을 정확히 등록해야 합니다.

Cloudflare Tunnel 또는 HTTPS 역방향 프록시를 사용한다면 \`.env\`의 콜백을
\`https://YOUR_DOMAIN/api/auth/callback\`으로 바꾸고 Google OAuth에도 같은 주소를 등록하세요.
터널이 호스트에서 실행되면 기본 \`127.0.0.1:15202\`를 그대로 사용할 수 있습니다.
다른 컴퓨터에서 직접 접속해야 할 때만 \`SERVICE_BIND_ADDRESS=0.0.0.0\`으로 바꾸고
방화벽과 HTTPS 프록시를 별도로 구성하세요.

\`PDFIT_PROXY_NETWORK=m42-proxy\`는 Nginx Proxy Manager 같은 Docker 프록시와 연결할
외부 네트워크 이름입니다. 설치 시 네트워크가 없으면 자동 생성하며, 프록시 컨테이너도
같은 네트워크에 연결한 뒤 \`pdfit-service:15202\`로 전달하면 됩니다.

## 데이터와 운영

- 영구 데이터: 압축 해제 폴더의 \`data\` (삭제 전 백업 필요)
- 로그: \`powershell -ExecutionPolicy Bypass -File .\\logs.ps1\`
- 종료: \`powershell -ExecutionPolicy Bypass -File .\\stop.ps1\`
- 최대 업로드: 기본 2048MB, \`SERVICE_MAX_UPLOAD_MB\`로 조정 가능(최대 10240MB)

실제 결제를 사용하려면 Paddle 환경값을 모두 채우고 웹훅을
\`https://YOUR_DOMAIN/api/billing/webhook\`에 등록합니다. \`BILLING_MOCK_ENABLED=true\`는
로컬 개발에서만 사용하세요.

\`SERVICE_GOOGLE_CLIENT_SECRET\`은 저장된 Google refresh token 암호화에도 사용되므로
운영 시작 후 임의로 변경하지 마세요.
`);

try {
  run('docker', ['tag', sourceImage, releaseImage]);
  run('docker', ['save', '--output', imagePath, releaseImage]);
  write('SHA256SUMS.txt', `${sha256(imagePath)} *${imageFilename}\n`);

  const quote = (value) => `'${value.replaceAll("'", "''")}'`;
  const command = `Compress-Archive -Path (Join-Path ${quote(stageRoot)} '*') -DestinationPath ${quote(archivePath)} -CompressionLevel Optimal -Force`;
  run('powershell', ['-NoProfile', '-Command', command]);
  writeFileSync(checksumPath, `${sha256(archivePath)} *${basename(archivePath)}\n`, 'utf8');
  console.log(`Created ${archivePath}`);
  console.log(`Created ${checksumPath}`);
} finally {
  const safePrefix = resolve(tmpdir()).toLowerCase();
  if (resolve(stageRoot).toLowerCase().startsWith(safePrefix)) rmSync(stageRoot, { recursive: true, force: true });
}
