<p align="center">
  <img src="icons/icon128.png" alt="NSO Extension Backend icon" width="128" height="128">
</p>

# NSO Extension Backend

**Local zero-worker companion and direct connection engine for the [Nintendo Switch Online WebApp](https://dycool.github.io/nso-webapp).**

⚡ **Zero-server backend** — Connects directly from the browser background service worker to Nintendo APIs and nxapi with no remote proxy relay.

🛡️ **DeclarativeNetRequest header injection** — Dynamically strips `X-Frame-Options` and `Content-Security-Policy` from Nintendo domains and injects `X-GameWebToken` headers into Game Web Service iframe requests (NookLink, SplatNet 3, Smash World, etc.).

🌉 **Native znca mobile bridge** — Injects the Nintendo Switch App JavaScript bridge (`window.webkit.messageHandlers.invokeMethod`) in `world: "MAIN"` at `document_start` so Game Web Services function seamlessly.

🔍 **Automatic WebApp detection** — The WebApp (`https://dycool.github.io/nso-webapp` or `localhost`) automatically detects the extension on startup via `externally_connectable` with a deterministic Extension ID (`bjcigdmffhlolfpaocccgclocgdnenfc`).

🚀 **Cross-browser support** — Manifest V3 extension compatible with Google Chrome, Microsoft Edge, Brave, and other Chromium-based browsers.

> **Pre-packaged Extension Available!**
> Download `nso-extension-backend.zip` from the **[Releases](https://github.com/Dycool/nso-extension-backend/releases)** page.

---

## 🚀 Quick Start

### Drag & Drop Installation (.zip Release)
1. Download `nso-extension-backend.zip` from the **[Releases](https://github.com/Dycool/nso-extension-backend/releases)** page.
2. Open your browser and navigate to:
   * **Chrome / Brave**: `chrome://extensions`
   * **Edge**: `edge://extensions`
3. Toggle **Developer mode** in the top-right corner to **ON**.
4. Drag and drop `nso-extension-backend.zip` directly onto the extensions page.
5. Open or refresh the **[NSO WebApp](https://dycool.github.io/nso-webapp)** (or `http://localhost:8080`).

---

## 🔨 Building from Source

Requires **Node.js 20+** and **npm**.

```bash
# Clone the repository
git clone https://github.com/Dycool/nso-extension-backend.git
cd nso-extension-backend

# Install dependencies
npm install

# Build the extension into dist/
npm run build

# Or build and create a release .zip package
npm run package
```

### Loading Unpacked in Browser
1. In `chrome://extensions` or `edge://extensions`, enable **Developer mode**.
2. Click **Load unpacked** and select the [`dist/`](dist) folder in this repository.
3. Open the **[NSO WebApp](https://dycool.github.io/nso-webapp)**.

---

## 📜 Development Scripts

| Command | Description |
| :--- | :--- |
| `npm run build` | Compiles TypeScript and bundles scripts with `esbuild` into `dist/`. |
| `npm run package` | Builds the extension and packages `nso-extension-backend.zip` with POSIX-compliant paths. |
| `npm run dev` | Starts `esbuild` watch mode for live extension development. |
| `npm test` | Runs the automated test suite verifying manifest, rules, and background handlers. |
| `npm run typecheck` | Validates TypeScript types (`tsc --noEmit`). |

---

## 🔐 Privacy & Security

* **Local Request Handling**: Authentication tokens and Nintendo Coral network traffic never leave your computer to third-party proxy servers.
* **Ephemeral Memory**: The extension does not store passwords or OAuth refresh secrets to disk. Short-lived session credentials are held in memory and cleared on sign-out.
* **Granular Host Permissions**: Network access is scoped strictly to official Nintendo endpoints (`*.nintendo.net`, `*.nintendo.com`, `accounts.nintendo.com`) and the public nxapi attestation API (`*.fancy.org.uk`).

---

## 📄 License & Nintendo Notice

The project's original source code is available under the [MIT License](LICENSE).

This is an unofficial interoperability project and is not affiliated with, endorsed by, sponsored by, or approved by Nintendo. Nintendo, Nintendo Switch, Nintendo Switch Online, and related names, logos, game-service content, and APIs remain the property of their respective owners.
