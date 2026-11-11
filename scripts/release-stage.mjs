import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const version = '0.4.6';
const releaseQualifier = (process.env.PDFIT_RELEASE_QUALIFIER ?? '').trim();
const releaseEnvFile = (process.env.PDFIT_RELEASE_ENV_FILE ?? '').trim();
const releaseRedirectUri = (process.env.PDFIT_RELEASE_REDIRECT_URI ?? '').trim();
const releaseBindAddress = (process.env.PDFIT_RELEASE_BIND_ADDRESS ?? '').trim();
const releaseArm64ImageFile = (process.env.PDFIT_RELEASE_ARM64_IMAGE_FILE ?? '').trim();
const crossPlatform = (process.env.PDFIT_RELEASE_CROSS_PLATFORM ?? '').trim().toLowerCase() === 'true';
if (releaseQualifier && !/^[a-z0-9][a-z0-9-]*$/i.test(releaseQualifier)) {
  throw new Error('PDFIT_RELEASE_QUALIFIER may contain only letters, numbers, and hyphens.');
}
const sourceImage = process.env.PDFIT_SERVICE_IMAGE ?? 'pdfit-service:latest';
const releaseImage = `pdfit/service:${version}`;
const repositoryRoot = resolve(import.meta.dirname, '..');
const releaseRoot = join(repositoryRoot, 'release');
const archiveBaseName = `pdfit-service-${version}${releaseQualifier ? `-${releaseQualifier}` : ''}-${crossPlatform ? 'windows-macos' : 'windows-amd64'}`;
const archivePath = join(releaseRoot, `${archiveBaseName}.zip`);
const checksumPath = `${archivePath}.sha256`;
const stageRoot = mkdtempSync(join(tmpdir(), 'pdfit-service-release-'));
const bundleRoot = join(stageRoot, archiveBaseName);
const imageFilename = `pdfit-service-image-${version}-linux-amd64.tar`;
const arm64ImageFilename = `pdfit-service-image-${version}-linux-arm64.tar`;
const imagePath = join(bundleRoot, imageFilename);
const arm64ImagePath = join(bundleRoot, arm64ImageFilename);
const settingsFilename = '.env';

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', ...options });
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase();
}

function write(name, content, { bom = false } = {}) {
  const value = content.replace(/^\n/, '');
  writeFileSync(join(bundleRoot, name), `${bom ? '\uFEFF' : ''}${value}`, 'utf8');
}

function readSelectedServiceSettings(path) {
  if (!path) return undefined;
  const settings = new Map();
  for (const line of readFileSync(resolve(path), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) settings.set(match[1].trim(), match[2].trim());
  }
  return settings;
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
mkdirSync(bundleRoot, { recursive: true });
mkdirSync(join(bundleRoot, 'data'), { recursive: true });
writeFileSync(join(bundleRoot, 'data', '.gitkeep'), '', 'utf8');

write('docker-compose.yml', `
name: pdfit-service

services:
  service:
    image: ${releaseImage}
    init: true
    env_file:
      - ${settingsFilename}
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
      SERVICE_AI_BASE_URL: \${SERVICE_AI_BASE_URL:-}
      SERVICE_AI_MODEL: \${SERVICE_AI_MODEL:-}
      SERVICE_AI_API_KEY: \${SERVICE_AI_API_KEY:-}
      YES24_API_KEY: \${YES24_API_KEY:-}
      SERVICE_SAMPLE_OWNER_USER_ID: \${SERVICE_SAMPLE_OWNER_USER_ID:-}
      SERVICE_SAMPLE_DRIVE_ID: \${SERVICE_SAMPLE_DRIVE_ID:-}
      SERVICE_SAMPLE_FOLDER_ID: \${SERVICE_SAMPLE_FOLDER_ID:-}
      SERVICE_SAMPLE_CLIENT_EMAIL: \${SERVICE_SAMPLE_CLIENT_EMAIL:-}
      SERVICE_SAMPLE_PRIVATE_KEY: \${SERVICE_SAMPLE_PRIVATE_KEY:-}
      SERVICE_SAMPLE_CACHE_TTL_SECONDS: \${SERVICE_SAMPLE_CACHE_TTL_SECONDS:-300}
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

const suppliedSettings = readSelectedServiceSettings(releaseEnvFile);
const setting = (key, fallback = '') => suppliedSettings?.get(key) || fallback;
const settingsContent = `
# Managed PDFit server settings. The installer applies these values automatically.
SERVICE_GOOGLE_CLIENT_ID=${setting('SERVICE_GOOGLE_CLIENT_ID')}
SERVICE_GOOGLE_CLIENT_SECRET=${setting('SERVICE_GOOGLE_CLIENT_SECRET')}
SERVICE_GOOGLE_REDIRECT_URI=${releaseRedirectUri || setting('SERVICE_GOOGLE_REDIRECT_URI', 'https://pdfit.io/api/auth/callback')}
SERVICE_BIND_ADDRESS=${releaseBindAddress || setting('SERVICE_BIND_ADDRESS', '127.0.0.1')}
SERVICE_PORT=${setting('SERVICE_PORT', '15202')}
SERVICE_MAX_UPLOAD_MB=${setting('SERVICE_MAX_UPLOAD_MB', '2048')}
PDFIT_PROXY_NETWORK=${setting('PDFIT_PROXY_NETWORK', 'm42-proxy')}
PDFIT_SERVICE_DOMAIN=${setting('PDFIT_SERVICE_DOMAIN', 'pdfit.io')}
BILLING_MOCK_ENABLED=${setting('BILLING_MOCK_ENABLED', 'false')}
PADDLE_ENVIRONMENT=${setting('PADDLE_ENVIRONMENT', 'production')}
PADDLE_CLIENT_TOKEN=${setting('PADDLE_CLIENT_TOKEN')}
PADDLE_PRICE_ID=${setting('PADDLE_PRICE_ID')}
PADDLE_API_KEY=${setting('PADDLE_API_KEY')}
PADDLE_WEBHOOK_SECRET=${setting('PADDLE_WEBHOOK_SECRET')}
SERVICE_AI_BASE_URL=${setting('SERVICE_AI_BASE_URL')}
SERVICE_AI_MODEL=${setting('SERVICE_AI_MODEL')}
SERVICE_AI_API_KEY=${setting('SERVICE_AI_API_KEY')}
YES24_API_KEY=${setting('YES24_API_KEY')}
SERVICE_SAMPLE_OWNER_USER_ID=${setting('SERVICE_SAMPLE_OWNER_USER_ID')}
SERVICE_SAMPLE_DRIVE_ID=${setting('SERVICE_SAMPLE_DRIVE_ID')}
SERVICE_SAMPLE_FOLDER_ID=${setting('SERVICE_SAMPLE_FOLDER_ID')}
SERVICE_SAMPLE_CLIENT_EMAIL=${setting('SERVICE_SAMPLE_CLIENT_EMAIL')}
SERVICE_SAMPLE_PRIVATE_KEY=${setting('SERVICE_SAMPLE_PRIVATE_KEY')}
SERVICE_SAMPLE_CACHE_TTL_SECONDS=${setting('SERVICE_SAMPLE_CACHE_TTL_SECONDS', '300')}
`;
write(settingsFilename, settingsContent);
write('PDFit-Service-Settings.txt', settingsContent);

write('Caddyfile', `
{\$PDFIT_SERVICE_DOMAIN:pdfit.io} {
  reverse_proxy pdfit-service:15202
}
`);

write('install.ps1', `
param([switch]$CheckOnly)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$bundleRoot = $PSScriptRoot
$envPath = Join-Path $bundleRoot '${settingsFilename}'
$visibleSettingsPath = Join-Path $bundleRoot 'PDFit-Service-Settings.txt'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker Desktop 또는 Docker Engine을 먼저 설치해 주세요.'
}
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker가 실행 중인지 확인해 주세요.' }
$dockerArchitecture = (docker version --format '{{.Server.Arch}}').Trim()
$imageFilename = switch ($dockerArchitecture) {
  'amd64' { '${imageFilename}' }
  'arm64' { '${arm64ImageFilename}' }
  default { throw "지원하지 않는 Docker 아키텍처입니다: $dockerArchitecture" }
}
$imagePath = Join-Path $bundleRoot $imageFilename
if (-not (Test-Path -LiteralPath $imagePath)) { throw "현재 컴퓨터용 Docker 이미지가 없습니다: $imageFilename" }

function Read-Settings([string]$path) {
  $result = @{}
  if (Test-Path -LiteralPath $path) {
    Get-Content -LiteralPath $path | ForEach-Object {
      if ($_ -match '^([^#=]+)=(.*)$') { $result[$matches[1].Trim()] = $matches[2].Trim() }
    }
  }
  return $result
}
$settings = Read-Settings $envPath
$requiredKeys = @('SERVICE_GOOGLE_CLIENT_ID', 'SERVICE_GOOGLE_CLIENT_SECRET', 'SERVICE_GOOGLE_REDIRECT_URI')
if ((($requiredKeys | Where-Object { -not $settings[$_] -or $settings[$_] -eq 'CHANGE_ME' }).Count -gt 0) -and (Test-Path -LiteralPath $visibleSettingsPath)) {
  $visibleSettings = Read-Settings $visibleSettingsPath
  $visibleSettingsReady = ($requiredKeys | Where-Object { -not $visibleSettings[$_] -or $visibleSettings[$_] -eq 'CHANGE_ME' }).Count -eq 0
  if ($visibleSettingsReady) {
    if (Test-Path -LiteralPath $envPath) { Copy-Item -LiteralPath $envPath -Destination "$envPath.previous" -Force }
    Copy-Item -LiteralPath $visibleSettingsPath -Destination $envPath -Force
    $settings = Read-Settings $envPath
    Write-Host '서버 설정을 배포본의 pdfit.io 설정으로 적용했습니다.' -ForegroundColor Yellow
  }
}
if ((Test-Path -LiteralPath $visibleSettingsPath) -and (Test-Path -LiteralPath $envPath)) {
  $visibleSettings = Read-Settings $visibleSettingsPath
  $updates = @{}
  foreach ($key in $visibleSettings.Keys) {
    if ($key -eq 'SERVICE_GOOGLE_REDIRECT_URI') {
      if ($settings[$key] -ne $visibleSettings[$key]) { $updates[$key] = $visibleSettings[$key] }
    } elseif ((!$settings.ContainsKey($key) -or [string]::IsNullOrWhiteSpace($settings[$key])) -and $visibleSettings[$key]) {
      $updates[$key] = $visibleSettings[$key]
    }
  }
  if ($updates.Count -gt 0) {
    Copy-Item -LiteralPath $envPath -Destination "$envPath.previous" -Force
    $lines = [System.Collections.Generic.List[string]]::new()
    $lines.AddRange([string[]][System.IO.File]::ReadAllLines($envPath))
    foreach ($key in $updates.Keys) {
      $index = -1
      for ($lineIndex = 0; $lineIndex -lt $lines.Count; $lineIndex += 1) {
        if ($lines[$lineIndex] -match ('^' + [regex]::Escape($key) + '=')) { $index = $lineIndex; break }
      }
      $updatedLine = "$key=$($updates[$key])"
      if ($index -ge 0) { $lines[$index] = $updatedLine } else { $lines.Add($updatedLine) }
      $settings[$key] = $updates[$key]
    }
    [System.IO.File]::WriteAllLines($envPath, [string[]]$lines, [System.Text.UTF8Encoding]::new($false))
    Write-Host '기존 서버 설정을 보존하고 배포본의 새 설정과 OAuth 콜백을 반영했습니다.' -ForegroundColor Yellow
  }
}
foreach ($requiredKey in $requiredKeys) {
  if (-not $settings[$requiredKey] -or $settings[$requiredKey] -eq 'CHANGE_ME') {
    throw "${settingsFilename}의 $requiredKey 값을 먼저 입력해 주세요."
  }
}
try { [uri]$settings['SERVICE_GOOGLE_REDIRECT_URI'] | Out-Null } catch { throw 'SERVICE_GOOGLE_REDIRECT_URI가 올바른 URL이 아닙니다.' }
if ($settings['PADDLE_ENVIRONMENT'] -eq 'sandbox') {
  Write-Warning 'Paddle sandbox 설정입니다. 운영 결제에는 서버의 .env에 production용 Paddle 값이 필요합니다.'
}

$checksumLine = Get-Content -LiteralPath (Join-Path $bundleRoot 'SHA256SUMS') | Where-Object { $_ -match [regex]::Escape($imageFilename) } | Select-Object -First 1
if (-not $checksumLine) { throw "Docker 이미지 체크섬이 없습니다: $imageFilename" }
$expectedHash = ($checksumLine -split '\\s+')[0]
$actualHash = (Get-FileHash -LiteralPath $imagePath -Algorithm SHA256).Hash
if ($actualHash -ne $expectedHash) { throw 'Docker 이미지 체크섬이 일치하지 않습니다.' }

docker compose --project-name pdfit-service --env-file $envPath --file (Join-Path $bundleRoot 'docker-compose.yml') config --quiet
if ($LASTEXITCODE -ne 0) { throw 'Compose 구성 검사에 실패했습니다.' }
if ($CheckOnly) {
  Write-Host '설정, 스크립트, Docker 이미지 검사가 모두 통과했습니다.' -ForegroundColor Green
  exit 0
}

New-Item -ItemType Directory -Path (Join-Path $bundleRoot 'data') -Force | Out-Null
$proxyNetwork = if ($settings['PDFIT_PROXY_NETWORK']) { $settings['PDFIT_PROXY_NETWORK'] } else { 'm42-proxy' }
$existingProxyNetwork = docker network ls --filter "name=^$([regex]::Escape($proxyNetwork))$" --format '{{.Name}}' | Select-Object -First 1
if ($existingProxyNetwork -ne $proxyNetwork) {
  Write-Host "프록시 네트워크 '$proxyNetwork'를 생성하는 중..."
  docker network create $proxyNetwork | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '프록시 Docker 네트워크 생성에 실패했습니다.' }
}

Write-Host '[1/3] 서비스 이미지를 불러오는 중...'
docker load --input $imagePath
if ($LASTEXITCODE -ne 0) { throw 'Docker 이미지 불러오기에 실패했습니다.' }

Write-Host '[2/3] PDFit 서비스를 시작하는 중...'
docker compose --project-name pdfit-service --env-file $envPath --file (Join-Path $bundleRoot 'docker-compose.yml') up -d --force-recreate --remove-orphans
if ($LASTEXITCODE -ne 0) { throw 'PDFit 서비스 시작에 실패했습니다.' }

Write-Host '[3/3] 서비스 상태를 확인하는 중...'
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

$expectedRedirectUri = '${releaseRedirectUri || setting('SERVICE_GOOGLE_REDIRECT_URI', 'https://pdfit.io/api/auth/callback')}'
$containerRedirectLine = docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' pdfit-service-service-1 2>$null | Where-Object { $_ -like 'GOOGLE_REDIRECT_URI=*' } | Select-Object -First 1
$containerRedirectUri = if ($containerRedirectLine) { $containerRedirectLine.Substring('GOOGLE_REDIRECT_URI='.Length) } else { '' }
if ($containerRedirectUri -ne $expectedRedirectUri) {
  throw "컨테이너 OAuth 콜백 적용 실패: $containerRedirectUri"
}
Write-Host "OAuth 콜백 적용 확인: $containerRedirectUri" -ForegroundColor Green

$publicUri = [uri]$settings['SERVICE_GOOGLE_REDIRECT_URI']
$publicAddress = $publicUri.GetLeftPart([System.UriPartial]::Authority)
Write-Host "PDFit Service가 정상 실행 중입니다: $publicAddress" -ForegroundColor Green
`, { bom: true });

write('stop.ps1', `
$ErrorActionPreference = 'Stop'
docker compose --project-name pdfit-service --env-file (Join-Path $PSScriptRoot '${settingsFilename}') --file (Join-Path $PSScriptRoot 'docker-compose.yml') down
`, { bom: true });

write('logs.ps1', `
$ErrorActionPreference = 'Stop'
docker compose --project-name pdfit-service --env-file (Join-Path $PSScriptRoot '${settingsFilename}') --file (Join-Path $PSScriptRoot 'docker-compose.yml') logs --follow --tail 200 service
`, { bom: true });

if (crossPlatform) {
  write('install-macos.sh', `
#!/usr/bin/env bash
set -euo pipefail

bundle_root="$(cd "$(dirname "$0")" && pwd)"
env_path="$bundle_root/${settingsFilename}"
visible_settings_path="$bundle_root/PDFit-Service-Settings.txt"

if ! command -v docker >/dev/null 2>&1; then
  echo 'Docker Desktop을 먼저 설치해 주세요.' >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo 'Docker Desktop이 실행 중인지 확인해 주세요.' >&2
  exit 1
fi

read_setting() {
  awk -F= -v key="$1" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$2"
}

client_id="$(read_setting SERVICE_GOOGLE_CLIENT_ID "$env_path" 2>/dev/null || true)"
client_secret="$(read_setting SERVICE_GOOGLE_CLIENT_SECRET "$env_path" 2>/dev/null || true)"
if { [ -z "$client_id" ] || [ "$client_id" = 'CHANGE_ME' ] || [ -z "$client_secret" ] || [ "$client_secret" = 'CHANGE_ME' ]; } && [ -f "$visible_settings_path" ]; then
  ready_id="$(read_setting SERVICE_GOOGLE_CLIENT_ID "$visible_settings_path" 2>/dev/null || true)"
  ready_secret="$(read_setting SERVICE_GOOGLE_CLIENT_SECRET "$visible_settings_path" 2>/dev/null || true)"
  if [ -n "$ready_id" ] && [ "$ready_id" != 'CHANGE_ME' ] && [ -n "$ready_secret" ] && [ "$ready_secret" != 'CHANGE_ME' ]; then
    [ ! -f "$env_path" ] || cp "$env_path" "$env_path.previous"
    cp "$visible_settings_path" "$env_path"
    echo '빈 .env를 패키지의 준비된 설정으로 자동 복구했습니다.'
  fi
fi

for required_key in SERVICE_GOOGLE_CLIENT_ID SERVICE_GOOGLE_CLIENT_SECRET SERVICE_GOOGLE_REDIRECT_URI; do
  value="$(read_setting "$required_key" "$env_path" 2>/dev/null || true)"
  if [ -z "$value" ] || [ "$value" = 'CHANGE_ME' ]; then
    echo ".env의 $required_key 값을 확인해 주세요." >&2
    exit 1
  fi
done

docker_architecture="$(docker version --format '{{.Server.Arch}}')"
case "$docker_architecture" in
  amd64) image_filename='${imageFilename}' ;;
  arm64) image_filename='${arm64ImageFilename}' ;;
  *) echo "지원하지 않는 Docker 아키텍처입니다: $docker_architecture" >&2; exit 1 ;;
esac
image_path="$bundle_root/$image_filename"
[ -f "$image_path" ] || { echo "현재 Mac용 Docker 이미지가 없습니다: $image_filename" >&2; exit 1; }

expected_hash="$(grep -F " *$image_filename" "$bundle_root/SHA256SUMS" | awk '{print $1}' | head -n 1)"
actual_hash="$(shasum -a 256 "$image_path" | awk '{print toupper($1)}')"
[ -n "$expected_hash" ] && [ "$actual_hash" = "$expected_hash" ] || { echo 'Docker 이미지 체크섬이 일치하지 않습니다.' >&2; exit 1; }

proxy_network="$(read_setting PDFIT_PROXY_NETWORK "$env_path" 2>/dev/null || true)"
proxy_network="\${proxy_network:-m42-proxy}"
docker network inspect "$proxy_network" >/dev/null 2>&1 || docker network create "$proxy_network" >/dev/null

echo '[1/3] 서비스 이미지를 불러오는 중...'
docker load --input "$image_path"
echo '[2/3] PDFit 서비스를 시작하는 중...'
docker compose --project-name pdfit-service --env-file "$env_path" --file "$bundle_root/docker-compose.yml" config --quiet
docker compose --project-name pdfit-service --env-file "$env_path" --file "$bundle_root/docker-compose.yml" up -d --force-recreate --remove-orphans
echo '[3/3] 서비스 상태를 확인하는 중...'
container_id="$(docker compose --project-name pdfit-service --env-file "$env_path" --file "$bundle_root/docker-compose.yml" ps -q service)"
for attempt in $(seq 1 60); do
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
  [ "$health" != 'healthy' ] || { echo 'PDFit Service가 정상 실행 중입니다: https://pdfit.io'; exit 0; }
  [ "$health" != 'unhealthy' ] && [ "$health" != 'exited' ] || break
  sleep 2
done
docker compose --project-name pdfit-service --env-file "$env_path" --file "$bundle_root/docker-compose.yml" logs --tail 100 service
echo '서비스가 정상 상태가 되지 않았습니다.' >&2
exit 1
`);

  write('stop-macos.sh', `
#!/usr/bin/env bash
set -euo pipefail
bundle_root="$(cd "$(dirname "$0")" && pwd)"
docker compose --project-name pdfit-service --env-file "$bundle_root/${settingsFilename}" --file "$bundle_root/docker-compose.yml" down
`);

  write('logs-macos.sh', `
#!/usr/bin/env bash
set -euo pipefail
bundle_root="$(cd "$(dirname "$0")" && pwd)"
docker compose --project-name pdfit-service --env-file "$bundle_root/${settingsFilename}" --file "$bundle_root/docker-compose.yml" logs --follow --tail 200 service
`);
}

const platformInstallGuide = crossPlatform ? `
### Windows

1. Docker Desktop을 설치하고 Linux 컨테이너 모드로 실행합니다.
2. PowerShell에서 \`powershell -ExecutionPolicy Bypass -File .\\install.ps1\`을 실행합니다.

### macOS

1. Docker Desktop을 설치하고 실행합니다.
2. 터미널에서 압축 해제 폴더로 이동합니다.
3. \`bash ./install-macos.sh\`를 실행합니다.

Intel Mac은 amd64 이미지를, Apple Silicon Mac은 arm64 이미지를 설치기가 자동 선택합니다.
` : `
1. Docker Desktop을 설치하고 Linux 컨테이너 모드로 실행합니다.
2. PowerShell에서 \`powershell -ExecutionPolicy Bypass -File .\\install.ps1\`을 실행합니다.
`;

write('README.md', `
# PDFit Service ${version} 이식형 배포 패키지

이 ZIP은 ${crossPlatform ? 'Windows 11과 macOS' : 'Windows 서버'}의 Docker Desktop에서 PDFit 서비스와 내장 PostgreSQL을 실행합니다.
소스 저장소나 Node.js 설치는 필요하지 않으며, 사용자 PDF와 메타데이터는 Google Drive에 저장됩니다.
설치 절차는 서버 관리자만 수행합니다. Windows와 Mac 사용자는 별도 설치 없이 브라우저에서 \`https://pdfit.io\`로 접속합니다.

## 설치

1. ZIP을 쓰기 가능한 영문 경로에 완전히 압축 해제합니다.
${platformInstallGuide}

기존 서버를 업데이트할 때는 먼저 현재 \`.env\`를 별도 파일로 백업하세요.
ZIP 내용을 기존 서비스 폴더에 병합해 압축 해제한 다음, 백업한 \`.env\`를 복원하고 설치 스크립트를 실행하세요.
\`install.ps1\`은 기존 서버 설정을 유지하며 새 설정 중 빠진 값과 OAuth 콜백만 반영합니다.
서버의 \`data\`, \`caddy-config\`, \`caddy-data\`는 삭제하지 마세요.

서비스 주소와 OAuth 콜백은 \`https://pdfit.io\`로 준비되어 있습니다.
Windows와 Mac 사용자는 브라우저에서 이 HTTPS 주소로 접속하세요.
Google 로그인에는 이 도메인의 DNS와 HTTPS 프록시가 설치 서버를 향해야 합니다.
${suppliedSettings ? '포함된 Google OAuth 클라이언트에' : '설치 전에 `.env` 또는 `PDFit-Service-Settings.txt`에 Google OAuth 클라이언트 ID와 비밀값을 입력하세요. 해당 OAuth 클라이언트에'} \`https://pdfit.io/api/auth/callback\`이 승인된 리디렉션 URI로 등록되어 있어야 합니다.
${setting('PADDLE_ENVIRONMENT', 'production') === 'sandbox' ? '이 패키지의 Paddle 설정은 sandbox입니다. 실제 결제를 받으려면 서버의 `.env`에 production용 Paddle 값으로 교체한 후 설치하세요.' : ''}

\`PDFIT_PROXY_NETWORK=m42-proxy\`는 Nginx Proxy Manager 같은 Docker 프록시와 연결할
외부 네트워크 이름입니다. 설치 시 네트워크가 없으면 자동 생성합니다.

## 데이터와 운영

- 영구 데이터: 압축 해제 폴더의 \`data\` (삭제 전 백업 필요)
- Windows 로그/종료: \`powershell -ExecutionPolicy Bypass -File .\\logs.ps1\` / \`.\\stop.ps1\`
${crossPlatform ? '- macOS 로그/종료: `bash ./logs-macos.sh` / `bash ./stop-macos.sh`' : ''}
- 최대 업로드: 기본 2048MB, \`SERVICE_MAX_UPLOAD_MB\`로 조정 가능(최대 10240MB)

\`SERVICE_GOOGLE_CLIENT_SECRET\`은 저장된 Google refresh token 암호화에도 사용되므로
운영 시작 후 임의로 변경하지 마세요.
`, { bom: true });

try {
  run('docker', ['tag', sourceImage, releaseImage]);
  run('docker', ['save', '--output', imagePath, releaseImage]);
  if (crossPlatform) {
    if (releaseArm64ImageFile) {
      copyFileSync(resolve(releaseArm64ImageFile), arm64ImagePath);
    } else {
      run('docker', [
        'buildx', 'build',
        '--platform', 'linux/arm64',
        '--provenance=false',
        '--file', join(repositoryRoot, 'apps', 'service', 'docker', 'Dockerfile'),
        '--tag', releaseImage,
        '--output', `type=docker,dest=${arm64ImagePath}`,
        join(repositoryRoot, 'apps', 'service'),
      ]);
    }
  }
  const checksumLines = [`${sha256(imagePath)} *${imageFilename}`];
  if (crossPlatform) checksumLines.push(`${sha256(arm64ImagePath)} *${arm64ImageFilename}`);
  write('SHA256SUMS', `${checksumLines.join('\n')}\n`);

  const quote = (value) => `'${value.replaceAll("'", "''")}'`;
  const command = `Compress-Archive -Path ${quote(bundleRoot)} -DestinationPath ${quote(archivePath)} -CompressionLevel Optimal -Force`;
  run('powershell', ['-NoProfile', '-Command', command]);
  writeFileSync(checksumPath, `${sha256(archivePath)} *${basename(archivePath)}\n`, 'utf8');
  console.log(`Created ${archivePath}`);
  console.log(`Created ${checksumPath}`);
} finally {
  const safePrefix = resolve(tmpdir()).toLowerCase();
  if (resolve(stageRoot).toLowerCase().startsWith(safePrefix)) rmSync(stageRoot, { recursive: true, force: true });
}
