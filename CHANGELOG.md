# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/), and the project uses [semantic versioning](https://semver.org/).

## [1.0.0] — 2026-10-08

First public release.

### Added
- Open, edit and save KeePass 2 databases (KDBX 3 and 4; AES-256 and ChaCha20; AES-KDF, Argon2d and Argon2id).
- Unlock with a master password, a key file (`.keyx` / `.key`), or both, remembered per database.
- **Create a new database** from the first screen: name, location, password and/or key file (create or choose one), and a security level. New databases use Argon2id and AES-256 and start with Personal, Work and Finance groups and a welcome entry.
- USB-drive support: Keystone finds the database and its key file on connected drives, recognises your drive by its volume identity (not its drive letter), reacts to plugging in and removing drives, and can lock when the drive is removed.
- Groups, tags, search, custom fields, attachments, one-time codes (TOTP), entry history with restore, Recycle Bin with Undo, drag-and-drop to move entries, expiry dates.
- Password generator and strength estimate; change master password / key file; create new key file.
- Clipboard cleared automatically and excluded from Windows clipboard history; auto-lock when idle and when Windows locks; window hidden from screenshots.
- Safe saving: atomic writes, verification before and after, offer of a backup before the first save of a session, warning when the file changed on disk.
- Windows installer (per user, no administrator rights needed) with Start menu entry, optional desktop shortcut and "Open with Keystone" for `.kdbx` files, and a clean uninstaller.
- Compatibility tests against the real KeePass 2.61 library.

### Known limitations
- Windows only. Not code-signed. No Twofish, Windows-account keys, auto-type or plugins. See [SECURITY.md](SECURITY.md).
