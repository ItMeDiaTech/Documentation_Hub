# Code Signing — Documentation Hub

Status: deferred. The auto-updater currently verifies update integrity via
SHA512 hash only. Signed MSIs are not produced. This document captures the
path to enabling signing when an EV/OV certificate is acquired.

## What you need

- An EV (Extended Validation) code-signing certificate from a trusted CA
  (Sectigo, DigiCert, GlobalSign, Certum). EV is required to bypass Windows
  SmartScreen on first install without reputation accumulation. OV (Standard)
  works but starts with zero reputation.
- The certificate as a `.pfx` (PKCS#12) file. Hardware tokens (USB dongle) are
  required for EV; the build environment must have the token attached, or
  the cert must be exported via cloud-signing service (Azure Code Signing,
  SignServer).

## Wiring electron-builder

Update `package.json` `build.win`:
```json
{
  "certificateFile": "${env:CERT_FILE}",
  "certificatePassword": "${env:CERT_PASS}",
  "signingHashAlgorithms": ["sha256"]
}
```
For Azure Code Signing: use `azureSignOptions` instead of `certificateFile`.

## GitHub Actions

Add secrets to the repo:
- `CERT_FILE_BASE64` — base64-encoded .pfx
- `CERT_PASS` — password for the .pfx

In `.github/workflows/build.yml`, before electron-builder runs:
```yaml
- name: Decode cert
  run: |
    echo "${{ secrets.CERT_FILE_BASE64 }}" | base64 --decode > cert.pfx
    echo "CERT_FILE=$PWD/cert.pfx" >> $GITHUB_ENV
    echo "CERT_PASS=${{ secrets.CERT_PASS }}" >> $GITHUB_ENV
```

## Local dev testing (self-signed)

For dev only, generate a self-signed cert with `New-SelfSignedCertificate`
(PowerShell), export to .pfx, point `CERT_FILE` at it. Installs will still
prompt SmartScreen but the signing pipeline is exercised end-to-end.

## Verification

After signing, `signtool verify /pa Documentation-Hub-<version>.msi` reports
the certificate chain. Sign manually once with a fresh cert before
committing CI changes — proves the cert is valid.
