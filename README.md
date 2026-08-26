# NSO WebApp Extension Companion

Manifest V3 browser extension serving as a 100% local, zero-worker backend for the **Nintendo Switch Online WebApp** (https://dycool.github.io/nso-webapp).

## Overview

The extension eliminates the need for an external Cloudflare Worker by running all CORS bypasses, Nintendo OAuth integrations, nxapi attestations, and DeclarativeNetRequest header shims locally inside the browser.

### Key Features
* **Zero-Server Backend**: Connects directly from the browser background service worker to Nintendo APIs and nxapi (`fancy.org.uk`).
* **DeclarativeNetRequest Header Injection**: Strips `X-Frame-Options` & `Content-Security-Policy` from Nintendo domains and injects `X-GameWebToken` dynamically into iframe game requests.
* **Native znca Bridge Injected at `document_start`**: Shims the Nintendo Switch App mobile bridge (`window.webkit.messageHandlers.invokeMethod`) in `world: "MAIN"`.
* **Automatic WebApp Detection**: The WebApp (`dycool.github.io` or `localhost`) automatically detects the extension on load. If the extension is present, all traffic routes through it with zero server dependencies.

## Installation / Loading in Browser

1. Build the extension:
   ```bash
   npm install
   npm run build
   ```
2. Open Chrome / Edge / Brave and navigate to:
   `chrome://extensions`
3. Enable **Developer mode** (toggle in top-right corner).
4. Click **Load unpacked** and select the `dist/` folder in this repository.
5. Open `https://dycool.github.io/nso-webapp` (or `http://localhost:8080`).
6. Check the browser console to see the active green badge:
   > `[NSO WebApp] Backend: Browser Extension (Zero-Worker) ⚡ (v1.0.0)`

## Development Scripts

* `npm run build`: Compile TypeScript and bundle with `esbuild` into `dist/`.
* `npm run dev`: Watch mode for automatic rebuilds during extension development.
* `npm test`: Run automated extension test suite.
