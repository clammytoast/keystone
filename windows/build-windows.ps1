# Builds the standalone Keystone.exe: web UI -> Keystone.html -> embedded into a native host. Needs nothing but Windows.
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$root = Split-Path $here -Parent
$lib = Join-Path $here 'lib'
$out = Join-Path $root 'Keystone.exe'

& (Join-Path $root 'build.ps1') | Out-Null                                   # src/* -> Keystone.html
$ico = Join-Path $here 'Keystone.ico'
if (-not (Test-Path $ico)) { & (Join-Path $here 'make-icon.ps1') -Out $ico | Out-Null }

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }

$res = @(
  @((Join-Path $root 'build\Keystone.html'), 'Keystone.html'),
  @((Join-Path $lib 'Microsoft.Web.WebView2.Core.dll'), 'Microsoft.Web.WebView2.Core.dll'),
  @((Join-Path $lib 'Microsoft.Web.WebView2.WinForms.dll'), 'Microsoft.Web.WebView2.WinForms.dll'),
  @((Join-Path $lib 'WebView2Loader.x64.dll'), 'WebView2Loader.x64.dll'),
  @((Join-Path $lib 'WebView2Loader.x86.dll'), 'WebView2Loader.x86.dll'),
  @((Join-Path $lib 'WebView2Loader.arm64.dll'), 'WebView2Loader.arm64.dll'))
$args = @('/nologo', '/target:winexe', '/optimize+', '/debug-', "/out:$out", "/win32icon:$ico", "/win32manifest:$(Join-Path $here 'app.manifest')",
  '/r:System.dll', '/r:System.Core.dll', '/r:System.Drawing.dll', '/r:System.Windows.Forms.dll', '/r:System.Web.Extensions.dll',
  "/r:$(Join-Path $lib 'Microsoft.Web.WebView2.Core.dll')", "/r:$(Join-Path $lib 'Microsoft.Web.WebView2.WinForms.dll')")
foreach ($r in $res) { $args += "/resource:$($r[0]),$($r[1])" }
$args += (Join-Path $here 'Program.cs')
& $csc @args
if ($LASTEXITCODE -ne 0) { throw 'compile failed' }
'Built {0} ({1:N0} KB)' -f $out, ((Get-Item $out).Length / 1KB)
