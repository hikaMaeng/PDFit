$ErrorActionPreference = 'Stop'
$homeDir = Join-Path $env:LOCALAPPDATA 'PDFitLAN'
$ssh = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
$key = Join-Path $homeDir 'id_ed25519'
$knownHosts = Join-Path $homeDir 'known_hosts'
$log = Join-Path $homeDir 'tunnel.log'

while ($true) {
  try {
    if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 1048576) {
      Clear-Content -LiteralPath $log
    }
    & $ssh -N -T -i $key -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$knownHosts" -o ExitOnForwardFailure=yes -o ConnectTimeout=5 -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L 127.0.0.1:15202:127.0.0.1:15202 kazak@192.168.0.5 2>> $log
  } catch {
    Add-Content -LiteralPath $log -Value "$(Get-Date -Format o) $($_.Exception.Message)"
  }
  Start-Sleep -Seconds 10
}
