# SunoDownloader

A Firefox browser extension for downloading music from [Suno.com](https://suno.com).

## Installation

### From Mozilla Add-ons
Install directly from the Firefox Add-ons store.

### Manual Installation
1. Clone this repository
2. Open Firefox and navigate to `about:debugging`
3. Click "This Firefox" → "Load Temporary Add-on"
4. Select `manifest.json` or the newest zip file

## Development

### Prerequisites
- Node.js
- web-ext (`npm install -g web-ext`)

### Commands
```bash
# Run extension in Firefox
web-ext run --source-dir . --start-url https://suno.com

# Build extension
web-ext build --source-dir . --artifacts-dir ./web-ext-artifacts

# Lint extension
web-ext lint --source-dir .