# Prints a normalised JSON view of a .kdbx as the real KeePass library reads it (used as ground truth).
param([string]$Path, [string]$Password, [string]$KeyFile, [string]$Out, [string]$KeePass = $env:KEEPASS_EXE)
$ErrorActionPreference = 'Stop'
if ($Password -eq '-') { $Password = '' }
if ($KeyFile -eq '-') { $KeyFile = '' }
[void][Reflection.Assembly]::LoadFrom((Resolve-Path $KeePass))
$ck = New-Object KeePassLib.Keys.CompositeKey
if ($Password) { $ck.AddUserKey((New-Object KeePassLib.Keys.KcpPassword($Password))) }
if ($KeyFile) { $ck.AddUserKey((New-Object KeePassLib.Keys.KcpKeyFile($KeyFile))) }
$db = New-Object KeePassLib.PwDatabase
$db.Open([KeePassLib.Serialization.IOConnectionInfo]::FromPath($Path), $ck, $null)
$hdr = [IO.File]::ReadAllBytes($Path)[0..11]
$ver = "{0}.{1}" -f ([BitConverter]::ToUInt16($hdr, 10)), ([BitConverter]::ToUInt16($hdr, 8))
$sha = [Security.Cryptography.SHA256]::Create()
$entries = @()
foreach ($e in $db.RootGroup.GetEntries($true)) {
    $f = [ordered]@{}
    foreach ($kv in ($e.Strings | Sort-Object Key)) { $f[$kv.Key] = $kv.Value.ReadString() }
    $b = [ordered]@{}
    foreach ($kv in ($e.Binaries | Sort-Object Key)) { $d = $kv.Value.ReadData(); $b[$kv.Key] = "{0}:{1}" -f $d.Length, ([BitConverter]::ToString($sha.ComputeHash($d)).Replace('-', '').Substring(0, 16)) }
    $hist = @(); foreach ($h in $e.History) { $hist += $h.Strings.ReadSafe('Password') + '/' + $h.Strings.ReadSafe('UserName') }
    $entries += [ordered]@{
        path = $e.ParentGroup.GetFullPath('/', $true)
        fields = $f
        binaries = $b
        tags = @($e.Tags | Sort-Object)
        history = $hist
        expires = $e.Expires
    }
}
$res = [ordered]@{
    version = $ver
    name = $db.Name
    kdf = $db.KdfParameters.KdfUuid.ToHexString()
    cipher = $db.DataCipherUuid.ToHexString()
    recycleBin = $db.RecycleBinUuid.ToHexString() -ne '00000000000000000000000000000000'
    groups = @($db.RootGroup.GetGroups($true) | % { $_.GetFullPath('/', $true) } | Sort-Object)
    entries = @($entries | Sort-Object { $_.path + '|' + $_.fields['Title'] + '|' + $_.fields['UserName'] })
}
$json = $res | ConvertTo-Json -Depth 8
if ($Out) { [IO.File]::WriteAllText($Out, $json, (New-Object Text.UTF8Encoding $false)) } else { $json }
$db.Close()
