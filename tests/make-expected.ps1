# Reads every generated fixture with the real KeePass library and stores what it sees next to the file (*.expected.json).
param([string]$KeePass = $env:KEEPASS_EXE)
$fx = Join-Path $PSScriptRoot 'fixtures'
$cases = @(
  @('argon2d-aes-pwkey', 'correct horse', 'test.keyx'), @('argon2id-chacha-pw', 'pässwörd-ünï', '-'), @('aeskdf-pw', 'legacy', '-'),
  @('aeskdf-v3', 'legacy', '-'), @('argon2d-keyonly', '-', 'test.keyx'), @('argon2d-default', 'correct horse', 'test.keyx'),
  @('keyfile-v1xml', 'pw', 'v1.xml.key'), @('keyfile-arbitrary', 'pw', 'arbitrary.key'))
foreach ($c in $cases) {
  $kf = '-'; if ($c[2] -ne '-') { $kf = Join-Path $fx $c[2] }
  & (Join-Path $PSScriptRoot 'dump.ps1') -Path (Join-Path $fx "$($c[0]).kdbx") -Password $c[1] -KeyFile $kf -Out (Join-Path $fx "$($c[0]).expected.json") -KeePass $KeePass
  "{0}: ok" -f $c[0]
}