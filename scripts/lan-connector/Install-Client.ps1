$ErrorActionPreference = 'Stop'

$ssh = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
$keygen = Join-Path $env:WINDIR 'System32\OpenSSH\ssh-keygen.exe'
if (-not (Test-Path -LiteralPath $ssh) -or -not (Test-Path -LiteralPath $keygen)) {
  throw 'Windows OpenSSH Client is required. Install it from Windows Optional Features.'
}

$source = Split-Path -Parent $MyInvocation.MyCommand.Path
$homeDir = Join-Path $env:LOCALAPPDATA 'PDFitLAN'
$key = Join-Path $homeDir 'id_ed25519'
$publicKey = "$key.pub"
$runner = Join-Path $homeDir 'RunTunnel.ps1'
$knownHosts = Join-Path $homeDir 'known_hosts'
$publicKeyCopy = Join-Path ([Environment]::GetFolderPath('Desktop')) 'PDFit-LAN-public-key.txt'
$startup = [Environment]::GetFolderPath('Startup')
$startupScript = Join-Path $startup 'PDFit-LAN-Tunnel.vbs'

New-Item -ItemType Directory -Path $homeDir -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $source 'RunTunnel.ps1') -Destination $runner -Force
Copy-Item -LiteralPath (Join-Path $source 'known_hosts') -Destination $knownHosts -Force

if (-not (Test-Path -LiteralPath $key)) {
  & $keygen -q -t ed25519 -N '""' -f $key -C "pdfit-lan-$env:COMPUTERNAME"
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the SSH key.' }
}

$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $key /inheritance:r /grant:r ('*' + $sid + ':(F)') | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict the SSH private key permissions.' }

$keyText = (Get-Content -LiteralPath $publicKey -Raw).Trim()
if ($keyText -notmatch '^ssh-ed25519 [A-Za-z0-9+/=]+(?: .*)?$') { throw 'The generated public key is invalid.' }
Set-Content -LiteralPath $publicKeyCopy -Value $keyText -Encoding ascii

$startupContent = @'
Set shell = CreateObject("WScript.Shell")
script = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\PDFitLAN\RunTunnel.ps1"
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & script & """", 0, False
'@
Set-Content -LiteralPath $startupScript -Value $startupContent -Encoding ascii
& wscript.exe $startupScript

Write-Host 'The SSH tunnel will start automatically when you sign in to Windows.'
Write-Host "Public key: $publicKeyCopy"
Write-Host 'Send the contents of that public-key file to the PDFit administrator once.'
Write-Host 'After the key is approved, open http://localhost:15202 in your browser.'
