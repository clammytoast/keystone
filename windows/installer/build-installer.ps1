# Builds the Windows installer: dist\Keystone-Setup-<version>.exe (needs nothing but Windows).
# Run windows\build-windows.ps1 first (or pass -Rebuild) so Keystone.exe is current.
param([switch]$Rebuild)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$win = Split-Path $here -Parent
$root = Split-Path $win -Parent
$version = '1.0.0'
if ($Rebuild) { & (Join-Path $win 'build-windows.ps1') | Out-Null }
$payload = Join-Path $root 'Keystone.exe'
if (-not (Test-Path $payload)) { throw 'Keystone.exe not found - run windows\build-windows.ps1 first.' }
$ico = Join-Path $win 'Keystone.ico'
if (-not (Test-Path $ico)) { & (Join-Path $win 'make-icon.ps1') -Out $ico | Out-Null }
$dist = Join-Path $root 'dist'; New-Item -ItemType Directory -Force $dist | Out-Null
$out = Join-Path $dist "Keystone-Setup-$version.exe"

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
& $csc /nologo /target:winexe /optimize+ /debug- "/out:$out" "/win32icon:$ico" "/win32manifest:$(Join-Path $here 'setup.manifest')" `
  /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:Microsoft.CSharp.dll `
  "/resource:$payload,payload.Keystone.exe" "/resource:$(Join-Path $root 'THIRD_PARTY_NOTICES.md'),payload.notices.txt" (Join-Path $here 'Setup.cs')
if ($LASTEXITCODE -ne 0) { throw 'compile failed' }
'Built {0} ({1:N0} KB)' -f $out, ((Get-Item $out).Length / 1KB)
