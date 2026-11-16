# Starts the SMB TCP proxy used by the pdfit-usbshare1 CIFS volume.
# Reads PDFIT_SMB_HOST / PDFIT_SMB_PROXY_PORT from the repository .env. No-op when the port is already open.
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env'
$cfg = @{}
if (Test-Path $envFile) {
  Get-Content $envFile -Encoding UTF8 | ForEach-Object {
    if ($_ -match '^\s*(PDFIT_SMB_HOST|PDFIT_SMB_PROXY_PORT)\s*=\s*(.*?)\s*$') { $cfg[$Matches[1]] = $Matches[2] }
  }
}
$smbHost = $cfg['PDFIT_SMB_HOST']
$port = if ($cfg['PDFIT_SMB_PROXY_PORT']) { $cfg['PDFIT_SMB_PROXY_PORT'] } else { '1445' }
if (-not $smbHost) { exit 0 }
if (Get-NetTCPConnection -LocalPort ([int]$port) -State Listen -ErrorAction SilentlyContinue) { exit 0 }
Start-Process -FilePath node -WindowStyle Hidden -ArgumentList @(
  (Join-Path $PSScriptRoot 'smb-tcp-proxy.mjs'),
  '--target-host', $smbHost, '--target-port', '445', '--listen-port', $port)
