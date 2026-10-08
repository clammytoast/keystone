# Keystone

A free, open-source password manager and generator for Windows, built on the KeePass database format.

Keystone stores your passwords in one encrypted database and generates strong, random ones for you, so you can use a different password on every account without having to remember them all.

> **Status:** early release. Keystone has not had an independent security audit. Read [SECURITY.md](SECURITY.md) before trusting it with important accounts.

## Features

- **KeePass-compatible:** uses the same database format and encryption as KeePass, and can import existing KeePass databases
- **Flexible unlock:** protect your database with a master password, a `.keyx` key file, or both together
- **Password generator:** create strong random passwords with adjustable length and character sets
- **Categories and search:** organize your entries and find them fast
- **Copy to clipboard:** copied passwords are automatically removed from the clipboard after a time you choose
- **Auto-lock:** Keystone locks itself so your database isn't left open
- **Local storage:** everything is kept in a single `database.kdbx` file on your computer, with no account or sign-up
- **Open source:** anyone can read the code and see what it does

## Install

**Requirements:** Windows with the Microsoft Edge WebView2 Runtime (already installed on most up-to-date systems).

1. Go to the [**Releases**](../../releases/latest) page.
2. Download `Keystone-Setup-1.0.0.exe` from the latest release.
3. Run the installer and follow the steps.

### Verify your download (recommended)

Because this is a password manager, check that the file you downloaded is the one published here. Each release lists a SHA-256 checksum. In PowerShell:

```powershell
Get-FileHash .\Keystone-Setup-1.0.0.exe -Algorithm SHA256
```

The output must match the checksum in the release notes. If it doesn't, do not run the file.

### Windows SmartScreen warning

Windows may show "Windows protected your PC" the first time you run the installer, because the app isn't code-signed yet. If you've verified the checksum above, click **More info**, then **Run anyway**.

## Usage

1. Open Keystone from the Start menu.
2. Create a new database and choose how to protect it: a master password, a `.keyx` key file, or both.
3. Add entries, or use the generator to create a new password.
4. Already use KeePass? Import your existing `.kdbx` database.

### Back up and don't lose your keys

- **If you lose your master password or your key file, your saved passwords cannot be recovered.** If you use both, you need both.
- Keep a backup of your `database.kdbx` file and store your `.keyx` key file somewhere safe, separate from the database.

## Build from source

Keystone is built with HTML, CSS and JavaScript, running inside a native WebView2 window.

```text
Source code coming soon.
```

Build instructions will be added here once the source is published.

## Contributing

Bug reports, ideas and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

To report a security vulnerability, please follow [SECURITY.md](SECURITY.md) and do **not** open a public issue.

## License

Released under the [MIT License](LICENSE).
