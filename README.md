# SunoDownloader

A browser extension for downloading music from [Suno.com](https://suno.com). Compatible with both **Chrome** and **Firefox**.

## Repository Structure

This repository contains two separate plugin directories:

- **`firefox-plugin/`** - Firefox extension with Firefox-specific manifest
- **`chrome-plugin/`** - Chrome extension with Chrome-specific manifest

Each directory is a complete, standalone extension ready to be loaded in its respective browser.

## Installation

### Chrome

#### From Chrome Web Store
*(Coming soon)*

#### Manual Installation (Developer Mode)
1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `chrome-plugin` directory from this repository

### Firefox

#### From Mozilla Add-ons
Install directly from the Firefox Add-ons store.

#### Manual Installation (Developer Mode)
1. Open Firefox and navigate to `about:debugging`
2. Click "This Firefox" → "Load Temporary Add-on"
3. Select the `manifest.json` file from the `firefox-plugin` directory

## Development

### Chrome Development

Navigate to the `chrome-plugin` directory and load it in Chrome:

```bash
cd chrome-plugin
# Then load via chrome://extensions/ (Developer mode -> Load unpacked)
```

### Firefox Development

Navigate to the `firefox-plugin` directory:

```bash
cd firefox-plugin

# Run extension in Firefox
web-ext run --source-dir . --start-url https://suno.com

# Build extension package
web-ext build --source-dir . --artifacts-dir ./web-ext-artifacts

# Lint extension
web-ext lint --source-dir .
```

**Prerequisites for Firefox development:**
- Node.js
- web-ext: `npm install -g web-ext`

## Browser Compatibility

Both versions use the same codebase with browser-specific manifests:
- **JavaScript files**: Cross-browser compatible using the `browser`/`chrome` API polyfill pattern
- **Manifest files**: Separate manifests optimized for each browser
  - Firefox: Uses `background.scripts` and includes `browser_specific_settings`
  - Chrome: Uses `background.service_worker`

## License

MIT License - see LICENSE file for details
