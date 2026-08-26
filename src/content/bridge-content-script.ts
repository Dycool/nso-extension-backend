/**
 * Native ZNCA compatibility bridge injected into Nintendo Game Service WebViews.
 * Runs at document_start in world: 'MAIN'.
 */

declare global {
    interface Window {
        __NSO_ZNCA_BRIDGE_INSTALLED__?: boolean;
        webkit?: {
            messageHandlers?: {
                invokeMethod?: {
                    postMessage: (msg: any) => void;
                };
            };
        };
        invokeMethod?: (action: string, data: any) => void;
    }
}

(function installZncaNativeBridge() {
    if (window.__NSO_ZNCA_BRIDGE_INSTALLED__) return;
    window.__NSO_ZNCA_BRIDGE_INSTALLED__ = true;

    // --- Zelda Notes Canvas Optimization ---
    try {
        const nativeCanvasGetContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(this: HTMLCanvasElement, type: any, options?: any): any {
            if (String(type || '').toLowerCase() === '2d') {
                const nextOptions = options && typeof options === 'object'
                    ? Object.assign({}, options, { willReadFrequently: true })
                    : { willReadFrequently: true };
                return (nativeCanvasGetContext as any).call(this, type, nextOptions);
            }
            return (nativeCanvasGetContext as any).call(this, type, options);
        };
    } catch (_) {}

    // --- Message passing bridge to parent WebApp ---
    function sendBridgeEventToHost(action: string, payload: any = {}) {
        try {
            window.parent.postMessage({
                type: 'NSO_ZNCA_BRIDGE_EVENT',
                action,
                payload
            }, '*');
        } catch (_) {}
    }

    // --- Native znca WebKit Message Handler Shim ---
    const bridgeHandler = {
        postMessage: function(msg: any) {
            let parsed = msg;
            if (typeof msg === 'string') {
                try { parsed = JSON.parse(msg); } catch (_) {}
            }
            const action = parsed?.action || parsed?.type || 'unknown';
            const data = parsed?.data || parsed?.payload || parsed;

            if (action === 'requestOpenUrl' || action === 'requestOpenUrlInExternalBrowser') {
                const targetUrl = data?.url || data?.target || data;
                if (targetUrl && typeof targetUrl === 'string') {
                    window.open(targetUrl, '_blank', 'noopener,noreferrer');
                }
            } else if (action === 'copyToClipboard') {
                const text = data?.text || data?.string || String(data || '');
                if (navigator.clipboard?.writeText) {
                    navigator.clipboard.writeText(text).catch(() => {});
                }
            }

            sendBridgeEventToHost(action, data);
        }
    };

    if (!window.webkit) window.webkit = {};
    if (!window.webkit.messageHandlers) window.webkit.messageHandlers = {};
    window.webkit.messageHandlers.invokeMethod = bridgeHandler;
    window.invokeMethod = function(action: string, data: any) {
        bridgeHandler.postMessage({ action, data });
    };

    // Notify ready
    sendBridgeEventToHost('bridgeReady', { url: location.href });
})();

export {};
