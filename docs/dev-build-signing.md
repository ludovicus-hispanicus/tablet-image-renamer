# macOS Build Signing (Developer Notes)

## The Problem

macOS Gatekeeper blocks unsigned apps downloaded from the internet. When an app has no signature, users can bypass this with `xattr -cr`. However, if the app has a **partial or broken signature**, macOS rejects it entirely and `xattr -cr` is not enough — the app silently refuses to launch ("bounces" in the dock).

## Current Solution: Ad-hoc Signing in CI

We use ad-hoc code signing in the GitHub Actions release workflow. This means:

1. **`"identity": null`** in `package.json` mac build config — tells electron-builder to skip its own signing attempt (which would fail without a real certificate and leave a broken partial signature)
2. **`codesign --force --deep --sign -`** step in the workflow — applies a clean ad-hoc signature after electron-builder packages the app but before the DMG is created

This ensures the app ships with a valid (though not Apple-verified) signature, so users only need `xattr -cr` to open it.

### Relevant files

- `package.json` — `build.mac.identity: null`
- `.github/workflows/release.yml` — "Ad-hoc codesign (macOS)" step

## Why Not Just Ship Unsigned?

electron-builder's default behavior is to attempt signing on macOS. Without `"identity": null`, it may produce a partial signature depending on the CI environment. A partial signature is worse than no signature — macOS will silently kill the process with:

```
kernel: (AppleSystemPolicy) ASP: Security policy would not allow process
```

And `spctl --assess` will report:

```
code has no resources but signature indicates they must be present
```

## Future: Proper Code Signing and Notarization

To eliminate the `xattr -cr` step entirely, you would need:

1. **Apple Developer account** ($99/year) — https://developer.apple.com/programs/
2. **Developer ID Application certificate** — generated in the Apple Developer portal
3. **GitHub Secrets** to add:
   - `CSC_LINK` — base64-encoded .p12 certificate
   - `CSC_KEY_PASSWORD` — certificate password
   - `APPLE_ID` — Apple ID email
   - `APPLE_APP_SPECIFIC_PASSWORD` — generated at https://appleid.apple.com/account/manage
   - `APPLE_TEAM_ID` — your team ID from the developer portal
4. **Update `package.json`**:
   ```json
   "mac": {
     "target": ["dmg"],
     "category": "public.app-category.productivity",
     "hardenedRuntime": true,
     "gatekeeperAssess": false,
     "entitlements": "build/entitlements.mac.plist",
     "entitlementsInherit": "build/entitlements.mac.plist"
   },
   "afterSign": "scripts/notarize.js"
   ```
5. **Create notarization script** (`scripts/notarize.js`) using `@electron/notarize`
6. **Remove** the ad-hoc codesign step from the workflow (electron-builder will handle signing with the real certificate)

## Debugging macOS Launch Issues

If a user reports the app won't open on macOS:

```bash
# Check if Gatekeeper is blocking it
log show --predicate 'eventMessage contains "Tablet Image Renamer"' --last 5m

# Check signature status
spctl --assess --verbose "/Applications/Tablet Image Renamer.app"

# Run from terminal to see crash output
"/Applications/Tablet Image Renamer.app/Contents/MacOS/Tablet Image Renamer" 2>&1
```
