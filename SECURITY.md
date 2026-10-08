# Security

Keystone stores people's passwords, so security reports are taken seriously.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

- Use **Report a vulnerability** on the repository's **Security** tab (private reporting), or
- if that is not available, email the maintainer at the address on their [GitHub profile](https://github.com/clammytoast).

A useful report says what the problem is and where, how to reproduce it, and what an attacker could do with it. You will get an acknowledgement, and credit in the release notes if you want it. Please give a reasonable time to fix the problem before you publish details.

## Supported versions

Only the latest release receives security fixes.

## Status: not audited

**Keystone has not been independently audited.** It is an early release. Think carefully before storing credentials for high-value accounts (banking, your main email), keep a backup of your database, and prefer a long, unique master password, ideally with a key file as well.

## How Keystone protects your data

- **Format and cryptography.** Keystone reads and writes the standard KeePass database format. Hashing, HMAC and AES-CBC use the browser engine's built-in Web Crypto API. ChaCha20, Salsa20, AES-KDF, BLAKE2b and Argon2 are implemented in the project's own JavaScript and are checked against published test vectors and against databases written by the real KeePass 2.61 library (see `tests/`).
- **New databases** use Argon2id (64 MiB, 2 passes by default; 128 MiB, 3 passes at the "Stronger" level) and AES-256, with HMAC-protected blocks, as KDBX 4 specifies. Random values (salts, keys, key files, generated passwords) come from the browser engine's cryptographic random generator.
- **No network.** The interface is one embedded page. Its Content-Security-Policy forbids every network connection (`connect-src 'none'`), the host serves nothing but that page, blocks navigation away from it, denies all permission requests and cancels downloads. Links you click open in your normal browser. Keystone has no telemetry, update check, or account.
- **Isolated engine.** The interface runs in Microsoft's WebView2 (the Chromium engine that ships with Windows), with developer tools, browser shortcuts, autofill and password saving switched off. Keystone does not bundle Chromium: Microsoft updates it.
- **Decrypted data stays in memory.** Keystone never writes decrypted passwords to disk. Saves write the encrypted file through a temporary file in the same folder, verify it, then swap it in; if that is not possible on the drive's file system, it overwrites in place and verifies the result.
- **Verified saves.** Before anything is written, Keystone decrypts its own output and compares it with what is open; after writing it reads the file back. A failed check writes nothing.
- **Clipboard.** Copied secrets are marked to stay out of Windows clipboard history and cloud clipboard, and are cleared after a delay (20 seconds by default) only if the clipboard still holds what Keystone put there.
- **Locking.** Keystone locks after 10 idle minutes (configurable), when Windows locks, and optionally when the USB drive holding the database is removed. Locking drops the database and wipes the clipboard.
- **Screenshots.** The window is excluded from screenshots and screen sharing by default (a Windows display-affinity setting).

## What Keystone writes to disk

| Where | What |
|---|---|
| Your database file (and key file, if you ask Keystone to create one) | Your encrypted data |
| Next to the database, if backups are on | `Name (backup yyyy-mm-dd hhmm).kdbx`, an encrypted copy; the newest 10 are kept |
| `%LOCALAPPDATA%\Keystone\` | Settings, the remembered database's location and its drive's volume serial number (no passwords, no key material), WebView2's profile, and a copy of Microsoft's `WebView2Loader.dll` |
| `%TEMP%\Keystone-Setup.log` | The installer's log |

## Known limitations

These are inherent to what Keystone is, not bugs to report, but you should know them:

- **Memory.** While a database is unlocked its contents exist in memory as ordinary JavaScript strings, which cannot be reliably erased. Anyone who can read your computer's memory, a hibernation file or a crash dump while it is unlocked could recover them.
- **Malware.** Nothing here protects against software already running on your computer with your privileges (keyloggers, screen readers, malicious browser extensions installed elsewhere).
- **Clipboard.** During the seconds before it is cleared, any program can read what you copied.
- **Screenshot protection** is best-effort and does not stop a camera or malware.
- **Unsigned releases.** Keystone is not code-signed, so Windows cannot show who published it. Verify the SHA-256 checksum from the release notes before running an installer, and download only from this repository's Releases.
- **Speed.** Key derivation runs in JavaScript, roughly two to three times slower than KeePass's native code. A database made in KeePass with very expensive settings opens slowly here, and Argon2 memory settings of several GiB cannot be used.
- **File format upgrade.** Saving a KDBX 3 file converts it to KDBX 4.
- **Lost passwords.** If you lose your master password (or key file), nobody can recover the database. If you use both, you need both.
- **No audit, limited review.** The cryptographic code has not been reviewed by outside experts.
