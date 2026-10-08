# Security Policy

Keystone handles passwords, so security reports are taken seriously.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Use GitHub's private reporting instead: go to the **Security** tab of this repository and click **Report a vulnerability**. If that isn't available, contact the maintainer through the email listed on their GitHub profile.

Include, if you can:

- What the problem is and where it is
- Steps to reproduce it
- What an attacker could do with it

You can expect an acknowledgement of your report, and credit in the release notes if you'd like it.

## Supported versions

Only the latest release receives security fixes.

## Known limitations

- Keystone has **not** been independently audited.
- Releases are not yet code-signed, so Windows SmartScreen may warn on first run.
- If you lose your master password or your key file, your database cannot be recovered. If you use both, you need both.

Until an audit exists, think carefully before storing credentials for high-value accounts (banking, primary email) in Keystone.

## Verifying downloads

Always compare the SHA-256 checksum of the installer against the one published in the release notes (see the README).
