# Compatibility tests

Keystone's promise is that it reads and writes the same files as KeePass. These tests check that against the **real KeePass library** instead of against Keystone's own idea of the format.

You need a copy of **KeePass 2.x** (the portable version is fine). Only its `KeePass.exe` .NET assembly is used, through PowerShell; nothing from it is copied into this repository. Tested with KeePass 2.61.

```powershell
$env:KEEPASS_EXE = 'C:\path\to\KeePass.exe'

# 1. Make test databases with KeePass: Argon2d, Argon2id, AES-KDF, KDBX 3.1 and 4,
#    AES and ChaCha20, password / key file / both, three kinds of key file,
#    attachments, history, tags, unicode, a Recycle Bin.   (-> tests\fixtures, git-ignored)
powershell -ExecutionPolicy Bypass -File tests\makefixtures.ps1

# 2. Record what KeePass itself reads from each of them.
powershell -ExecutionPolicy Bypass -File tests\make-expected.ps1

# 3. Serve the harness and open it in Edge or Chrome
powershell -ExecutionPolicy Bypass -File tests\serve.ps1
#    http://127.0.0.1:8787/t/core.html   ->  "ALL 8 PASSED"
```

The page opens every fixture with Keystone's code and compares every group, entry, field, tag, attachment checksum and history item with KeePass's own reading.

## The other direction: KeePass opens what Keystone writes

`tests/web/lib2.js` contains `runWriteTest`, which opens a fixture, edits it through Keystone's vault code (change, add, move, delete, attachments), saves, and uploads the bytes to `tests/out/` through the test server. Then:

```powershell
powershell -ExecutionPolicy Bypass -File tests\dump.ps1 -Path tests\out\w1.kdbx -Password 'correct horse' -KeyFile tests\fixtures\test.keyx
```

prints what KeePass reads from Keystone's file; it must match what Keystone had in memory.

## What is not covered by automatic tests

The Windows host, the installer, USB detection and the screens are tested by hand (and with scripted drives via `KEYSTONE_FAKE_DRIVES`, see [docs/architecture.md](../docs/architecture.md)). Contributions that add automated coverage are welcome.
