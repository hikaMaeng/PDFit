param([Parameter(Mandatory = $true)][string]$PublicKeyPath)
$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this script as Administrator on the PDFit server PC.'
}

$raw = (Get-Content -LiteralPath $PublicKeyPath -Raw).Trim()
if ($raw -notmatch '^ssh-ed25519 [A-Za-z0-9+/=]+(?: [A-Za-z0-9_.@-]+)?$') {
  throw 'The client public key is invalid.'
}
$publicKeyBytes = ($raw -split ' ')[1]
$authorizedKeys = 'C:\ProgramData\ssh\administrators_authorized_keys'
$existing = if (Test-Path -LiteralPath $authorizedKeys) { Get-Content -LiteralPath $authorizedKeys -Raw } else { '' }
if ($existing.Contains($publicKeyBytes)) {
  Write-Host 'This client key is already authorized.'
  exit 0
}

$entry = 'restrict,port-forwarding,permitopen="127.0.0.1:15202",command="exit" ' + $raw
[System.IO.File]::AppendAllText($authorizedKeys, [Environment]::NewLine + $entry + [Environment]::NewLine, [System.Text.Encoding]::ASCII)
Write-Host 'The client may now open only the PDFit localhost tunnel through SSH.'
