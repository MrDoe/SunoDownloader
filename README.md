# SunoDownloader

A browser extension for downloading music from [Suno.com](https://suno.com). Compatible with both **Chrome** and **Firefox**.

## Installation

### Chrome

#### From Chrome Web Store
*(Coming soon)*

#### Manual Installation (Developer Mode)
1. Clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the repository folder (which contains `manifest.json`)

### Firefox

#### From Mozilla Add-ons
Install directly from the Firefox Add-ons store.

#### Manual Installation
1. Clone this repository
2. Copy `manifest-firefox.json` to `manifest.json` (overwriting the Chrome version)
   ```bash
   cp manifest-firefox.json manifest.json
   ```
3. Open Firefox and navigate to `about:debugging`
4. Click "This Firefox" → "Load Temporary Add-on"
5. Select `manifest.json` or the newest zip file

## Development

### Prerequisites
- Node.js
- web-ext (`npm install -g web-ext`)

### Commands

#### For Firefox Development
```bash
# Copy Firefox manifest
cp manifest-firefox.json manifest.json

# Run extension in Firefox
web-ext run --source-dir . --start-url https://suno.com

# Build extension for Firefox
web-ext build --source-dir . --artifacts-dir ./web-ext-artifacts

# Lint extension
web-ext lint --source-dir .
```

#### For Chrome Development
```bash
# Copy Chrome manifest
cp manifest-chrome.json manifest.json

# Then load the extension in Chrome via chrome://extensions/
# (Enable "Developer mode" and click "Load unpacked")
```

## Browser Compatibility

The extension uses a cross-browser compatible approach:
- **Manifest files**: Separate manifest files for Chrome (`manifest-chrome.json`) and Firefox (`manifest-firefox.json`)
- **API compatibility**: Uses the `browser`/`chrome` API polyfill pattern for cross-browser support
- **Default manifest**: The repository's `manifest.json` is configured for Chrome by default