# Assembles src/* into a single self-contained Keystone.html (no external files, no network).
$ErrorActionPreference = 'Stop'
$src = Join-Path $PSScriptRoot 'src'
$utf8 = New-Object System.Text.UTF8Encoding $false
function Read($n) { [IO.File]::ReadAllText((Join-Path $src $n), $utf8) }

$script = (@('kdbx.js', 'util.js', 'vault.js', 'app1.js', 'io.js', 'app2.js', 'app3.js', 'create.js', 'app4.js') | ForEach-Object { Read $_ }) -join "`n"
$script = "(() => {`n'use strict';`n" + $script + "`n})();"
$worker = Read 'worker.js'
if ($worker -match '</script') { throw 'worker.js must not contain </script' }
if ($script -match '</script') { throw 'app scripts must not contain </script' }

$html = Read 'index.html'
$html = $html.Replace('/*STYLE*/', (Read 'style.css')).Replace('/*WORKER*/', $worker).Replace('/*SCRIPT*/', $script)
New-Item -ItemType Directory -Force (Join-Path $PSScriptRoot 'build') | Out-Null
$out = Join-Path $PSScriptRoot 'build\Keystone.html'
[IO.File]::WriteAllText($out, $html, $utf8)
'Built {0} ({1:N0} KB)' -f $out, ((Get-Item $out).Length / 1KB)
