/**
 * Comprehensive Native ZNCA compatibility bridge injected into Nintendo Game Service WebViews.
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
        jsBridge?: any;
        ga?: any;
        gtag?: any;
        dataLayer?: any;
        onPersistentDataRestore?: (val: string) => void;
        onPersistentDataStore?: (val: string) => void;
        onGameWebTokenReceive?: (token: string | null) => void;
        onQRCodeRead?: (payload?: string) => void;
        onQRCodeReadForCheckin?: (resultJson: string) => void;
        jsQR?: any;
        __nsoJsQrLoader?: Promise<any> | null;
        __nsoNookPhotoQrSession?: any;
        __nsoSplatNetCheckinQrSession?: any;
        znca?: any;
        navigation?: any;
    }
}

(function installZncaNativeBridge() {
    if (window.__NSO_ZNCA_BRIDGE_INSTALLED__) return;
    window.__NSO_ZNCA_BRIDGE_INSTALLED__ = true;

    const currentUrl = location.href;
    const isSplatoon2 = location.hostname.includes('splatoon2.nintendo.net');
    const isSmash = location.hostname.includes('smashbros.nintendo.net') || location.hostname.includes('aaaba');
    const isNookLink = location.hostname.includes('acbaa.srv.nintendo.net');
    const isZelda = location.hostname.includes('87abc152') || currentUrl.includes('zelda') || currentUrl.includes('znotes');
    const isSplatNet3 = location.hostname.includes('av5ja.srv.nintendo.net') || location.hostname.includes('usagi.srv.nintendo.net');

    // Extract or infer serviceId
    let serviceId = 'generic';
    if (isSplatNet3) serviceId = '4834290508791808';
    else if (isNookLink) serviceId = '4953919198265344';
    else if (isZelda) serviceId = '5935781783175168';
    else if (isSplatoon2) serviceId = '5741031244955648';
    else if (isSmash) serviceId = '5598642853249024';

    // ---------------------------------------------------------------------------
    // 1. Zelda Notes Canvas & Image Optimizations
    // ---------------------------------------------------------------------------
    if (isZelda) {
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

        try {
            const loadingDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'loading');
            if (loadingDesc && loadingDesc.get && loadingDesc.set) {
                Object.defineProperty(HTMLImageElement.prototype, 'loading', {
                    configurable: true,
                    enumerable: loadingDesc.enumerable,
                    get: function() { return loadingDesc.get?.call(this); },
                    set: function(val) {
                        const normalized = String(val || '').toLowerCase() === 'lazy' ? 'eager' : val;
                        return loadingDesc.set?.call(this, normalized);
                    }
                });
            }
        } catch (_) {}
    }

    // ---------------------------------------------------------------------------
    // 2. Smash World Router Reset & Passive Touch Normalization
    // ---------------------------------------------------------------------------
    if (isSmash) {
        try {
            if (window.history && window.history.replaceState) {
                window.history.replaceState(null, '', '/');
            }
        } catch (_) {}
    }

    if (isNookLink || isSmash) {
        try {
            const nativeAddEventListener = EventTarget.prototype.addEventListener;
            EventTarget.prototype.addEventListener = function(type: string, listener: any, options?: any) {
                if (String(type || '').toLowerCase() === 'touchstart') {
                    const hasPassiveOption = Boolean(
                        options && typeof options === 'object' && Object.prototype.hasOwnProperty.call(options, 'passive')
                    );
                    const explicitlyPassive = hasPassiveOption && options.passive === true;
                    if (!explicitlyPassive) {
                        let callsPreventDefault = false;
                        try {
                            const candidate = typeof listener === 'function'
                                ? listener
                                : (listener && typeof listener.handleEvent === 'function' ? listener.handleEvent : null);
                            const source = candidate ? Function.prototype.toString.call(candidate) : '';
                            callsPreventDefault = source.includes('preventDefault');
                        } catch (_) {}

                        if (!callsPreventDefault) {
                            if (options == null || typeof options === 'boolean') {
                                options = { capture: options === true, passive: true };
                            } else {
                                options = Object.assign({}, options, { passive: true });
                            }
                        }
                    }
                }
                return nativeAddEventListener.call(this, type, listener, options);
            };
        } catch (_) {}
    }

    // ---------------------------------------------------------------------------
    // 3. Analytics & Tracking Stubs (Prevent ad-blocker / connection refused console noise)
    // ---------------------------------------------------------------------------
    function isTrackingUrl(urlStr: string): boolean {
        if (!urlStr || typeof urlStr !== 'string') return false;
        try {
            const host = new URL(urlStr, location.href).hostname.toLowerCase();
            return host.includes('google-analytics.com') ||
                host.includes('doubleclick.net') ||
                host.includes('googletagmanager.com') ||
                host.includes('googleads');
        } catch (_) {
            return false;
        }
    }

    window.ga = window.ga || function() { (window.ga.q = window.ga.q || []).push(arguments); };
    window.gtag = window.gtag || function() { (window.dataLayer = window.dataLayer || []).push(arguments); };

    // ---------------------------------------------------------------------------
    // 4. Fetch & XHR Interception (Tracking block & SplatNet 2 legacy API graceful fallback)
    // ---------------------------------------------------------------------------
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const rawUrl = typeof input === 'string' ? input : (input instanceof Request ? input.url : input.toString());

        if (isTrackingUrl(rawUrl)) {
            return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        // SplatNet 2 legacy route graceful handling (festivals ended & legacy stage stats)
        if (isSplatoon2) {
            try {
                const targetUrl = new URL(rawUrl, location.href);
                if (targetUrl.pathname === '/api/festivals/active') {
                    // Splatfests ended permanently; return empty festival list without doomed network request
                    return new Response(JSON.stringify({ festivals: [] }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
                if (targetUrl.pathname === '/api/data/stages') {
                    // Legacy stage stats endpoint decommissioned on Nintendo servers; return empty stages
                    return new Response(JSON.stringify({ stages: [] }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
            } catch (_) {}
        }

        return nativeFetch(input, init);
    };

    // ---------------------------------------------------------------------------
    // 5. Message Passing & znca Bridge Implementation
    // ---------------------------------------------------------------------------
    let requestCounter = 0;
    const pendingCallbacks = new Map<string, (token: string | null) => void>();

    function postBridgeMessage(type: string, payload: Record<string, any> = {}) {
        try {
            window.parent.postMessage({ type, serviceId, ...payload }, '*');
        } catch (_) {}
    }

    window.addEventListener('message', (event) => {
        const data = event.data;
        if (!data || typeof data !== 'object') return;

        if (data.type === 'NSO_RECEIVE_GAME_WEB_TOKEN') {
            const token = data.token || null;
            if (typeof window.znca?._private?.func_1d5e === 'function') {
                try { window.znca._private.func_1d5e(token); } catch (_) {}
            }
            if (typeof window.onGameWebTokenReceive === 'function') {
                try { window.onGameWebTokenReceive(token); } catch (_) {}
            }
            if (data.requestId && pendingCallbacks.has(data.requestId)) {
                const cb = pendingCallbacks.get(data.requestId);
                pendingCallbacks.delete(data.requestId);
                try { cb?.(token); } catch (_) {}
            }
        }
    });

    const TOURNAMENT_MANAGER_BROWSER_URL = 'https://c.nintendo.com/splatoon3-tournament';

    // SplatNet 3 Tournament Manager navigation interception
    if (isSplatNet3) {
        try {
            if (window.navigation && typeof window.navigation.addEventListener === 'function') {
                window.navigation.addEventListener('navigate', (event: any) => {
                    const destinationUrl = event?.destination?.url || '';
                    if (destinationUrl.includes('c.nintendo.com/splatoon3-tournament')) {
                        if (event.cancelable) {
                            event.preventDefault();
                            postBridgeMessage('NSO_OPEN_EXTERNAL_BROWSER', { url: TOURNAMENT_MANAGER_BROWSER_URL });
                            window.open(TOURNAMENT_MANAGER_BROWSER_URL, '_blank');
                            setTimeout(() => {
                                try { window.location.replace('/'); } catch (_) {}
                            }, 0);
                        }
                    }
                });
            }
        } catch (_) {}
    }

    const api = {
        func_272e: function() {
            const reqId = `req_${++requestCounter}_${Date.now()}`;
            postBridgeMessage('NSO_REQUEST_GAME_WEB_TOKEN', { requestId: reqId, isZelda: true });
        },
        func_2644: function(data: any) {
            try {
                const parsed = typeof data === 'string' ? JSON.parse(data) : data;
                const pattern = String(parsed?.pattern ?? '0');
                if (navigator.vibrate) {
                    if (pattern === '0') navigator.vibrate([15]);
                    else if (pattern === '1') navigator.vibrate([15, 50, 15]);
                    else if (pattern === '2') navigator.vibrate([40, 60, 40]);
                }
            } catch (_) {}
        },
        requestGameWebToken: function() {
            const reqId = `req_${++requestCounter}_${Date.now()}`;
            postBridgeMessage('NSO_REQUEST_GAME_WEB_TOKEN', { requestId: reqId, isZelda: false });
        },
        restorePersistentData: function() {
            const key = `nso_persist_${serviceId}`;
            let val = isZelda ? '' : (localStorage.getItem(key) || '');
            let attempts = 0;
            const deliver = () => {
                let delivered = false;
                if (typeof window.onPersistentDataRestore === 'function') {
                    try { window.onPersistentDataRestore.call(null, val); delivered = true; } catch (_) {}
                }
                if (typeof window.znca?._private?.onPersistentDataRestore === 'function') {
                    try { window.znca._private.onPersistentDataRestore(val); delivered = true; } catch (_) {}
                }
                if (!delivered && ++attempts < 50) {
                    setTimeout(deliver, 20);
                }
            };
            setTimeout(deliver, 0);
        },
        storePersistentData: function(val: any) {
            const key = `nso_persist_${serviceId}`;
            localStorage.setItem(key, String(val ?? ''));
            let attempts = 0;
            const deliver = () => {
                let delivered = false;
                if (typeof window.onPersistentDataStore === 'function') {
                    try { window.onPersistentDataStore.call(null, ''); delivered = true; } catch (_) {}
                }
                if (typeof window.znca?._private?.onPersistentDataStore === 'function') {
                    try { window.znca._private.onPersistentDataStore(''); delivered = true; } catch (_) {}
                }
                if (!delivered && ++attempts < 50) {
                    setTimeout(deliver, 20);
                }
            };
            setTimeout(deliver, 0);
        },
        copyToClipboard: function(val: any) {
            const text = String(val ?? '');
            if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(text).catch(() => {});
            }
            postBridgeMessage('NSO_COPY_TO_CLIPBOARD', { text });
        },
        completeLoading: function() {
            postBridgeMessage('NSO_COMPLETE_LOADING');
        },
        closeWebView: function() {
            postBridgeMessage('NSO_CLOSE_WEBVIEW');
        },
        reloadExtension: function() {
            // NO-OP per nxapi znca specification
        },
        clearUnreadFlag: function() {
            postBridgeMessage('NSO_CLEAR_UNREAD');
        },
        openExternalBrowser: function(url: string) {
            try {
                const u = new URL(url);
                if (['http:', 'https:'].includes(u.protocol)) {
                    postBridgeMessage('NSO_OPEN_EXTERNAL_BROWSER', { url: u.href });
                    window.open(u.href, '_blank', 'noopener,noreferrer');
                }
            } catch (_) {}
        },
        invokeNativeShare: function(data: any) {
            try {
                const p = typeof data === 'string' ? JSON.parse(data) : (data || {});
                if (navigator.share) navigator.share({ text: p.text || '', url: p.image_url || undefined }).catch(() => {});
                postBridgeMessage('NSO_NATIVE_SHARE', p);
            } catch (_) {}
        },
        invokeNativeShareUrl: function(data: any) {
            try {
                const p = typeof data === 'string' ? JSON.parse(data) : (data || {});
                if (navigator.share) navigator.share({ text: p.text || '', url: p.url || undefined }).catch(() => {});
                postBridgeMessage('NSO_NATIVE_SHARE_URL', p);
            } catch (_) {}
        },
        downloadImages: function(imagesJson: any) {
            try {
                const list = typeof imagesJson === 'string' ? JSON.parse(imagesJson) : imagesJson;
                for (const item of (Array.isArray(list) ? list : [])) {
                    const a = document.createElement('a');
                    a.href = item;
                    a.download = '';
                    a.target = '_blank';
                    a.click();
                }
            } catch (_) {}
        },
        sendMessage: function(data: any) {
            postBridgeMessage('NSO_SEND_MESSAGE', { data });
        }
    };

    // Native WebKit postMessage bridge handler
    const webkitHandler = {
        postMessage: function(msg: any) {
            let parsed = msg;
            if (typeof msg === 'string') {
                try { parsed = JSON.parse(msg); } catch (_) {}
            }
            const action = parsed?.action || parsed?.type || 'unknown';
            const data = parsed?.data || parsed?.payload || parsed;

            try {
                window.parent.postMessage({
                    type: 'NSO_ZNCA_BRIDGE_EVENT',
                    action,
                    payload: data
                }, '*');
            } catch (_) {}

            if (typeof (api as any)[action] === 'function') {
                (api as any)[action](data);
            } else if (action === 'requestOpenUrl' || action === 'requestOpenUrlInExternalBrowser') {
                const target = data?.url || data?.target || data;
                if (target) api.openExternalBrowser(String(target));
            } else if (action === 'copyToClipboard') {
                const text = data?.text || data?.string || String(data || '');
                api.copyToClipboard(text);
            }
        }
    };

    if (!window.webkit) window.webkit = {};
    if (!window.webkit.messageHandlers) window.webkit.messageHandlers = {};
    window.webkit.messageHandlers.invokeMethod = webkitHandler;
    window.invokeMethod = function(action: string, data: any) {
        webkitHandler.postMessage({ action, data });
    };

    window.jsBridge = api;
    Object.assign(window, api);

    // ---------------------------------------------------------------------------
    // 6. DOM Ready Signals
    // ---------------------------------------------------------------------------
    let readySent = false;
    function signalReady(src: string) {
        if (readySent) return;
        readySent = true;
        postBridgeMessage('NSO_COMPLETE_LOADING', { source: src });
    }

    function onDomReady(cb: () => void) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', cb, { once: true });
        } else {
            queueMicrotask(cb);
        }
    }

    if (isSplatoon2) {
        onDomReady(() => {
            if (location.pathname === '/home' || location.pathname.startsWith('/home/')) {
                signalReady('splatnet2-home-domcontentloaded');
            }
        });
    }

    if (isNookLink) {
        onDomReady(() => signalReady('nooklink-domcontentloaded'));
    }

    if (isSmash) {
        onDomReady(() => {
            const checkSmash = () => {
                const root = document.getElementById('content') || document.getElementById('root') || document.getElementById('app');
                if (root && root.children.length > 0) {
                    signalReady('smash-react-rendered');
                    return true;
                }
                return false;
            };
            if (!checkSmash() && typeof MutationObserver === 'function') {
                const observer = new MutationObserver(() => {
                    if (checkSmash()) observer.disconnect();
                });
                observer.observe(document.documentElement, { childList: true, subtree: true });
                setTimeout(checkSmash, 500);
            }
        });
    }
})();

export {};
