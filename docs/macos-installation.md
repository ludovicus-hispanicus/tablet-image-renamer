# macOS Installation Guide

## Download

1. Go to the [Releases page](https://github.com/ludovicus-hispanicus/tablet-image-renamer/releases)
2. Download the `.dmg` file (e.g., `Tablet.Image.Renamer-x.x.x-arm64.dmg`)

## Install

1. Open the downloaded `.dmg` file
2. Drag **Tablet Image Renamer** into the **Applications** folder

## Bypass macOS Gatekeeper

Since the app is not notarized with Apple, macOS will block it from opening. To allow it:

1. Open **Terminal** (search for "Terminal" in Spotlight)
2. Run the following command:
   ```bash
   xattr -cr "/Applications/Tablet Image Renamer.app"
   ```
3. Open the app normally from Applications

That's it. You only need to do this once per version.

## Troubleshooting

### App bounces in the dock but doesn't open

This means the signature is broken. Fix it by running these commands in Terminal:

```bash
# Remove the broken copy
sudo rm -rf "/Applications/Tablet Image Renamer.app"
```

Then re-download the DMG, open it, and drag the app to your **Desktop** first (not Applications):

```bash
# Remove quarantine and re-sign
xattr -rd com.apple.quarantine ~/Desktop/Tablet\ Image\ Renamer.app
codesign --force --deep --sign - ~/Desktop/Tablet\ Image\ Renamer.app
```

Now drag the app from your Desktop into Applications and open it.

### "Operation not permitted" when running xattr

Make sure you are running the command **after** dragging the app to Applications, and use `sudo` if needed:

```bash
sudo xattr -cr "/Applications/Tablet Image Renamer.app"
```

### Alternative: System Settings

Instead of using Terminal, you can try:

1. Open **System Settings** > **Privacy & Security**
2. Scroll down to the security section
3. Look for a message about "Tablet Image Renamer" being blocked
4. Click **Open Anyway**
