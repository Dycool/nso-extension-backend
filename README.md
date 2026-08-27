# NSO Extension Backend

Manifest V3 browser extension serving as a 100% local, direct connection backend for the **[Nintendo Switch Online WebApp](https://dycool.github.io/nso-webapp)**.

---

## Overview

The extension enables the WebApp to run all Nintendo Switch Online web traffic directly from your PC to Nintendo servers without requiring an external proxy server.

### Key Features
* **Direct Local Connection**: Network requests and authentication are handled entirely within the browser's background service worker directly to Nintendo APIs (`api-lp1.znc.srv.nintendo.net`, `accounts.nintendo.com`) and nxapi (`fancy.org.uk`).
* **DeclarativeNetRequest Header Injection**: Dynamically strips `X-Frame-Options` & `Content-Security-Policy` from Nintendo domains and injects `X-GameWebToken` headers into Game Web Service iframe requests (NookLink, SplatNet 3, Smash World, etc.).
* **Native znca Mobile Bridge (`world: "MAIN"`)**: Injects the Nintendo Switch App JavaScript bridge (`window.webkit.messageHandlers.invokeMethod`) at `document_start` so Game Web Services work seamlessly in standard browser environments.
* **Automatic WebApp Detection**: The WebApp (`https://dycool.github.io` or `localhost`) detects the extension automatically on load via `externally_connectable` with a deterministic Extension ID (`bjcigdmffhlolfpaocccgclocgdnenfc`).

---

## Installation

### Method 1: Drag & Drop (.zip Release)
1. Download the latest `nso-extension-backend.zip` from the **[Releases](https://github.com/Dycool/nso-extension-backend/releases)** page.
2. Open Chrome, Edge, or Brave and navigate to:
   * `chrome://extensions` (Chrome/Brave) or `edge://extensions` (Edge)
3. Toggle **Developer mode** in the top-right corner to **ON**.
4. Drag and drop `nso-extension-backend.zip` directly onto the extensions page.
5. Refresh the [NSO WebApp](https://dycool.github.io/nso-webapp) (or `http://localhost:8080`).

### Method 2: Build & Load Unpacked
1. Clone the repository and install dependencies:
   ```bash
   git clone https://github.com/Dycool/nso-extension-backend.git
   cd nso-extension-backend
   npm install
   npm run build
   ```
2. Open `chrome://extensions` or `edge://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the `dist/` folder.
4. Refresh the [NSO WebApp](https://dycool.github.io/nso-webapp).

---

## Verification

Once installed, check the browser console in the WebApp:
```text
[backend:extension] Connected to browser extension backend (v1.0.0)
```
*(Or in your selected language, e.g. `[backend:extension] Ligado ao backend da extensão do navegador (v1.0.0)`)*

Under **Settings ➔ Other ➔ Proxy Settings**, the status will display:
```text
🟢 NSO Extension
All network traffic and authentication are handled entirely locally on your PC directly to Nintendo.
```

---

## Development & Scripts

| Command | Description |
| :--- | :--- |
| `npm run build` | Compiles TypeScript and bundles with `esbuild` into `dist/`. |
| `npm run package` | Builds the extension and packages `nso-extension-backend.zip` with POSIX forward-slash paths. |
| `npm run dev` | Starts `esbuild` watch mode for live extension development. |
| `npm test` | Builds the bundle and executes the automated test suite. |
| `npm run typecheck` | Validates TypeScript types (`tsc --noEmit`). |

---

## License

MIT License.
