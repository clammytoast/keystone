param([string]$KeePass = $env:KEEPASS_EXE)
$ErrorActionPreference = 'Stop'
# Generates test databases with the real KeePass library (KeePass.exe from a KeePass 2.x install; the .NET assembly is all that is used).
if (-not $KeePass -or -not (Test-Path $KeePass)) { throw 'Pass -KeePass <path to KeePass.exe> or set $env:KEEPASS_EXE' }
$sp = Split-Path -Parent $MyInvocation.MyCommand.Path
$fx = Join-Path $sp 'fixtures'
New-Item -ItemType Directory -Force $fx | Out-Null
[void][Reflection.Assembly]::LoadFrom((Resolve-Path $KeePass))
Add-Type -AssemblyName System.Core

function MkPS($v, $prot = $false) { New-Object KeePassLib.Security.ProtectedString($prot, [string]$v) }

function New-Entry($group, $title, $user, $pass, $url, $notes) {
    $e = New-Object KeePassLib.PwEntry($true, $true)
    $e.Strings.Set('Title', (MkPS $title))
    $e.Strings.Set('UserName', (MkPS $user))
    $e.Strings.Set('Password', (MkPS $pass $true))
    $e.Strings.Set('URL', (MkPS $url))
    $e.Strings.Set('Notes', (MkPS $notes))
    $group.AddEntry($e, $true)
    return $e
}

function Build($name, $kdf, $cipher, $password, $keyfile, $mem, $iter) {
    $path = Join-Path $fx "$name.kdbx"
    if (Test-Path $path) { Remove-Item $path }
    $ck = New-Object KeePassLib.Keys.CompositeKey
    if ($password) { $ck.AddUserKey((New-Object KeePassLib.Keys.KcpPassword($password))) }
    if ($keyfile) { $ck.AddUserKey((New-Object KeePassLib.Keys.KcpKeyFile($keyfile))) }
    $db = New-Object KeePassLib.PwDatabase
    $db.New([KeePassLib.Serialization.IOConnectionInfo]::FromPath($path), $ck)
    $db.Name = "Fixture $name"
    $k = [KeePassLib.Cryptography.KeyDerivation.KdfPool]::Get($kdf)
    $p = $k.GetDefaultParameters()
    if ($kdf -like 'Argon2*') {
        if ($mem) { $p.SetUInt64('M', [uint64]$mem) }
        if ($iter) { $p.SetUInt64('I', [uint64]$iter) }
    } else {
        if ($iter) { $p.SetUInt64('R', [uint64]$iter) }
    }
    $db.KdfParameters = $p
    if ($cipher -eq 'chacha') { $db.DataCipherUuid = (New-Object KeePassLib.PwUuid(,[byte[]](0xd6,0x03,0x8a,0x2b,0x8b,0x6f,0x4c,0xb5,0xa5,0x24,0x33,0x9a,0x31,0xdb,0xb5,0x9a))) }
    $root = $db.RootGroup
    $root.Name = 'Root'
    $web = New-Object KeePassLib.PwGroup($true, $true, 'Web', [KeePassLib.PwIcon]::World)
    $root.AddGroup($web, $true)
    $soc = New-Object KeePassLib.PwGroup($true, $true, 'Social ✓', [KeePassLib.PwIcon]::Folder)
    $web.AddGroup($soc, $true)
    $bank = New-Object KeePassLib.PwGroup($true, $true, 'Banking', [KeePassLib.PwIcon]::Folder)
    $root.AddGroup($bank, $true)
    $bin = New-Object KeePassLib.PwGroup($true, $true, 'Recycle Bin', [KeePassLib.PwIcon]::TrashBin)
    $root.AddGroup($bin, $true)
    $db.RecycleBinEnabled = $true
    $db.RecycleBinUuid = $bin.Uuid

    $e1 = New-Entry $web 'GitHub' 'octocat' 'p@ss&<w>"rd''1' 'https://github.com' "Line1`nLine2 — ünïcödé 🔐"
    $e1.Strings.Set('API Token', (MkPS 'ghp_SECRET_TOKEN_123' $true))
    $e1.Strings.Set('Recovery', (MkPS 'plain custom field'))
    $e1.AddTag('work'); $e1.AddTag('dev')
    $e1.Strings.Set('otp', (MkPS 'otpauth://totp/GitHub:octocat?secret=JBSWY3DPEHPK3PXP&period=30&digits=6&issuer=GitHub' $true))
    $e1.Binaries.Set('hello.txt', (New-Object KeePassLib.Security.ProtectedBinary($false, [Text.Encoding]::UTF8.GetBytes('Hello attachment ✓'))))
    # history: create a backup then modify
    $e1.CreateBackup($null)
    $e1.Strings.Set('Password', (MkPS 'p@ss&<w>"rd''2' $true))
    $e1.CreateBackup($null)
    $e1.Strings.Set('UserName', (MkPS 'octocat2'))

    $e2 = New-Entry $soc 'Mastodon' 'me@example.social' 'mast0don-pw' 'https://mastodon.social' ''
    $e2.Expires = $true; $e2.ExpiryTime = [DateTime]::UtcNow.AddDays(-3)
    $e3 = New-Entry $bank 'My Bank' '12345678' 'bank-PIN-9876' 'https://bank.example' 'Security question: first pet'
    $e3.Strings.Set('Security Answer', (MkPS 'Rex' $true))
    $big = New-Object byte[] 300000; (New-Object Random 42).NextBytes($big)
    $e3.Binaries.Set('random.bin', (New-Object KeePassLib.Security.ProtectedBinary($false, $big)))
    $e3.Binaries.Set('secret.bin', (New-Object KeePassLib.Security.ProtectedBinary($true, [byte[]](1,2,3,4,5))))
    $e4 = New-Entry $bin 'Old deleted thing' 'olduser' 'oldpass' '' ''
    $e5 = New-Entry $root '' 'no-title-user' '' '' ''
    $e6 = New-Entry $root 'Empty-password entry' '' '' '' 'notes only'
    $db.Save($null)
    $db.Close()
    return $path
}

# 1. Argon2d, AES cipher, password + key file (like the user's setup)
$kf = Join-Path $fx 'test.keyx'
if (Test-Path $kf) { Remove-Item $kf }
[void][KeePassLib.Keys.KcpKeyFile]::Create($kf, $null)
Build 'argon2d-aes-pwkey' 'Argon2d' 'aes' 'correct horse' $kf 8388608 3 | Out-Null
# 2. Argon2id, ChaCha20, password only, 2 lanes default parallelism, 16 MiB
Build 'argon2id-chacha-pw' 'Argon2id' 'chacha' 'pässwörd-ünï' $null 16777216 2 | Out-Null
# 3. AES-KDF (usually KDBX 3.1) password only
Build 'aeskdf-pw' 'AES-KDF' 'aes' 'legacy' $null 0 123456 | Out-Null
# 4. key file only
Build 'argon2d-keyonly' 'Argon2d' 'aes' $null $kf 4194304 2 | Out-Null
# 5. Default argon2 settings (realistic perf), password + key
Build 'argon2d-default' 'Argon2d' 'aes' 'correct horse' $kf 0 0 | Out-Null
# 6. Other key file flavours
$k1 = Join-Path $fx 'v1.xml.key'
$bytes = New-Object byte[] 32; (New-Object Random 7).NextBytes($bytes)
Set-Content -Encoding UTF8 $k1 ('<?xml version="1.0" encoding="utf-8"?><KeyFile><Meta><Version>1.00</Version></Meta><Key><Data>' + [Convert]::ToBase64String($bytes) + '</Data></Key></KeyFile>')
[IO.File]::WriteAllText((Join-Path $fx 'arbitrary.key'), 'this is just some arbitrary file contents, hashed with sha256')
Build 'keyfile-v1xml' 'Argon2d' 'aes' 'pw' $k1 4194304 2 | Out-Null
Build 'keyfile-arbitrary' 'Argon2d' 'aes' 'pw' (Join-Path $fx 'arbitrary.key') 4194304 2 | Out-Null
Get-ChildItem $fx | Select Name, Length | Format-Table | Out-String

# 7. KDBX 3.1 (the older format): re-save the AES-KDF database with the file version forced
$ck3 = New-Object KeePassLib.Keys.CompositeKey; $ck3.AddUserKey((New-Object KeePassLib.Keys.KcpPassword('legacy')))
$db3 = New-Object KeePassLib.PwDatabase
$db3.Open([KeePassLib.Serialization.IOConnectionInfo]::FromPath((Join-Path $fx 'aeskdf-pw.kdbx')), $ck3, $null)
$db3.Name = 'Fixture aeskdf-v3'
$kx = New-Object KeePassLib.Serialization.KdbxFile($db3)
[KeePassLib.Serialization.KdbxFile].GetProperty('ForceVersion', [Reflection.BindingFlags]'Instance,Public,NonPublic').SetValue($kx, [uint32]0x00030001)
$fs3 = [IO.File]::Create((Join-Path $fx 'aeskdf-v3.kdbx'))
$kx.Save($fs3, $null, [KeePassLib.Serialization.KdbxFormat]::Default, $null)
$fs3.Close(); $db3.Close()
Get-ChildItem $fx | Select Name, Length | Format-Table | Out-String