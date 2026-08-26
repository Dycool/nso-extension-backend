/** Injected znca-js-api compatibility bridge for Nintendo game services. */
import { SERVICE_QUIRKS, isZeldaNotesService, isSplatNet3Service, isSmashWorldService, isSplatNet2Service, isNookLinkService } from '../services/service-policy';

export function generateBridgeSnippet(
    sessionId: string,
    serviceId: string,
    currentTargetUrl: string,
    allowedOriginsList: string[]
): string {
    const jsonSessionId = JSON.stringify(sessionId);
    const jsonServiceId = JSON.stringify(serviceId);
    const currentOrigin = new URL(currentTargetUrl).origin;
    const jsonOrigin = JSON.stringify(currentOrigin);
    const jsonTargetUrl = JSON.stringify(currentTargetUrl);
    const jsonAllowedOrigins = JSON.stringify(allowedOriginsList);
    const quirk = SERVICE_QUIRKS[serviceId];
    const customCss = quirk?.customCss ? quirk.customCss : '';

    return `<script id="nso-znca-bridge">
(()=>{
const sessionId = ${jsonSessionId};
const serviceId = ${jsonServiceId};
const currentUpstreamOrigin = ${jsonOrigin};
const currentUpstreamUrl = ${jsonTargetUrl};
const allowedOrigins = ${jsonAllowedOrigins};
const proxyBase = '/api/nso/webview/' + sessionId + '/proxy';

// --- Zelda Notes browser compatibility hints ---
if (${isZeldaNotesService(serviceId, currentTargetUrl) ? 'true' : 'false'}) {
    // Zelda's animated map repeatedly reads Canvas2D pixels with getImageData().
    // Tell Chromium up front that these contexts are readback-heavy instead of
    // letting it emit the willReadFrequently performance warning mid-animation.
    try {
        const nativeCanvasGetContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type, options) {
            if (String(type || '').toLowerCase() === '2d') {
                const nextOptions = options && typeof options === 'object'
                    ? Object.assign({}, options, { willReadFrequently: true })
                    : { willReadFrequently: true };
                return nativeCanvasGetContext.call(this, type, nextOptions);
            }
            return nativeCanvasGetContext.call(this, type, options);
        };
    } catch(e) {}

    // Dynamic Zelda images can also opt into lazy loading after hydration.
    // Keep the behavior consistent with the HTML rewrite above.
    try {
        const loadingDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'loading');
        if (loadingDescriptor && loadingDescriptor.get && loadingDescriptor.set) {
            Object.defineProperty(HTMLImageElement.prototype, 'loading', {
                configurable: true,
                enumerable: loadingDescriptor.enumerable,
                get: function() { return loadingDescriptor.get.call(this); },
                set: function(value) {
                    const normalized = String(value || '').toLowerCase() === 'lazy' ? 'eager' : value;
                    return loadingDescriptor.set.call(this, normalized);
                }
            });
        }

        const nativeSetAttribute = Element.prototype.setAttribute;
        Element.prototype.setAttribute = function(name, value) {
            if (this instanceof HTMLImageElement && String(name).toLowerCase() === 'loading' && String(value).toLowerCase() === 'lazy') {
                return nativeSetAttribute.call(this, name, 'eager');
            }
            return nativeSetAttribute.call(this, name, value);
        };
    } catch(e) {}
}

// --- Early nxapi-compatible WebService environment shim ---
if (${(isSmashWorldService(serviceId, currentTargetUrl) || isNookLinkService(serviceId, currentTargetUrl)) ? 'true' : 'false'}) {
    const NXAPI_WEBSERVICE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.3 Mobile/15E148 Safari/604.1';
    try {
        Object.defineProperty(Navigator.prototype, 'userAgent', {
            configurable: true,
            enumerable: true,
            get: function() { return NXAPI_WEBSERVICE_UA; }
        });
    } catch (e) {
        try {
            Object.defineProperty(navigator, 'userAgent', {
                configurable: true,
                enumerable: true,
                get: function() { return NXAPI_WEBSERVICE_UA; }
            });
        } catch(e2) {}
    }

    try { delete Navigator.prototype.userAgentData; } catch(e) {}
    try { delete navigator.userAgentData; } catch(e) {}
    if ('userAgentData' in navigator) {
        try {
            Object.defineProperty(Navigator.prototype, 'userAgentData', {
                configurable: true,
                enumerable: true,
                get: function() { return undefined; }
            });
        } catch(e) {
            try {
                Object.defineProperty(navigator, 'userAgentData', {
                    configurable: true,
                    enumerable: true,
                    get: function() { return undefined; }
                });
            } catch(e2) {}
        }
    }
}

// --- NookLink passive touch listener compatibility ---
if (${isNookLinkService(serviceId, currentTargetUrl) ? 'true' : 'false'}) {
    try {
        const nativeAddEventListener = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function(type, listener, options) {
            if (String(type || '').toLowerCase() === 'touchstart') {
                const hasPassiveOption = Boolean(
                    options &&
                    typeof options === 'object' &&
                    Object.prototype.hasOwnProperty.call(options, 'passive')
                );
                const explicitlyPassive = hasPassiveOption && options.passive === true;

                // Some NookLink libraries explicitly pass { passive: false } even for
                // observation-only touchstart handlers. That still triggers Chromium's
                // scroll-blocking violation. Respect explicit passive:true, but inspect
                // every other handler before deciding whether false can be upgraded.
                if (!explicitlyPassive) {
                    let callsPreventDefault = false;
                    try {
                        const candidate = typeof listener === 'function'
                            ? listener
                            : (listener && typeof listener.handleEvent === 'function' ? listener.handleEvent : null);
                        const source = candidate ? Function.prototype.toString.call(candidate) : '';
                        callsPreventDefault = source.includes('preventDefault');
                    } catch(e) {}

                    // Only preserve a non-passive listener when its own implementation
                    // actually cancels the touch. Otherwise normalize even an explicit
                    // passive:false registration to passive:true.
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
    } catch(e) {}
}

// --- Smash World router alignment & dynamic asset proxying ---
if (${isSmashWorldService(serviceId, currentTargetUrl) ? 'true' : 'false'}) {
    try {
        if (window.history && window.history.replaceState) {
            // React Router v4 expects the native WebView document path to be '/'.
            window.history.replaceState(null, '', '/');
        }
    } catch(e) {}

    // Smash dynamically creates script/link elements. Keep those resource URLs
    // inside the authenticated Worker session without the old diagnostic probes.
    try {
        const origScriptSrcDesc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
        if (origScriptSrcDesc && origScriptSrcDesc.set) {
            Object.defineProperty(HTMLScriptElement.prototype, 'src', {
                configurable: true,
                enumerable: true,
                get: function() { return origScriptSrcDesc.get.call(this); },
                set: function(val) {
                    return origScriptSrcDesc.set.call(this, toProxiedUrl(val));
                }
            });
        }

        const origLinkHrefDesc = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, 'href');
        if (origLinkHrefDesc && origLinkHrefDesc.set) {
            Object.defineProperty(HTMLLinkElement.prototype, 'href', {
                configurable: true,
                enumerable: true,
                get: function() { return origLinkHrefDesc.get.call(this); },
                set: function(val) {
                    return origLinkHrefDesc.set.call(this, toProxiedUrl(val));
                }
            });
        }

        const origSetAttribute = Element.prototype.setAttribute;
        Element.prototype.setAttribute = function(name, val) {
            const lower = String(name).toLowerCase();
            if (this.tagName === 'SCRIPT' && lower === 'src') {
                return origSetAttribute.call(this, name, toProxiedUrl(val));
            }
            if (this.tagName === 'LINK' && lower === 'href') {
                return origSetAttribute.call(this, name, toProxiedUrl(val));
            }
            return origSetAttribute.call(this, name, val);
        };
    } catch(e) {}
}

function isAllowedClientOrigin(origin) {
    try {
        const targetHost = new URL(origin).hostname.toLowerCase();
        for (const allowed of allowedOrigins) {
            let allowedHost = '';
            try {
                allowedHost = allowed.startsWith('http') ? new URL(allowed).hostname.toLowerCase() : String(allowed).toLowerCase();
            } catch(e) {
                allowedHost = String(allowed).toLowerCase();
                if (allowedHost.startsWith('https://')) allowedHost = allowedHost.slice(8);
                else if (allowedHost.startsWith('http://')) allowedHost = allowedHost.slice(7);
            }
            if (allowedHost.startsWith('*.')) {
                const suffix = allowedHost.slice(2);
                if (targetHost === suffix || targetHost.endsWith('.' + suffix)) return true;
            } else if (allowedHost.startsWith('.')) {
                const suffix = allowedHost.slice(1);
                if (targetHost === suffix || targetHost.endsWith('.' + suffix)) return true;
            } else if (targetHost === allowedHost) {
                return true;
            }
        }

        // Smash's static/content CDN is a subresource exception, not a navigation exception.
        if (${isSmashWorldService(serviceId, currentTargetUrl) ? 'true' : 'false'} && origin === 'https://www-aaaba-lp1-hac.cdn.nintendo.net') {
            return true;
        }

        // SplatNet 3 Room Creation authenticates and queries a second Nintendo API
        // origin. Rewrite these browser fetches back through this session proxy so
        // the page never performs a direct Worker-origin -> usagi CORS request.
        if (${isSplatNet3Service(serviceId, currentTargetUrl) ? 'true' : 'false'} && origin === 'https://api.lp1.usagi.srv.nintendo.net') {
            return true;
        }

        // NookLink may be served from dpl.sd... while catalog XHRs target web.sd... .
        // Rewrite both exact sibling origins through this session proxy so the
        // browser never attempts a direct Worker-origin -> Nintendo CORS request.
        if (${isNookLinkService(serviceId, currentTargetUrl) ? 'true' : 'false'} && (
            origin === 'https://web.sd.lp1.acbaa.srv.nintendo.net' ||
            origin === 'https://dpl.sd.lp1.acbaa.srv.nintendo.net'
        )) {
            return true;
        }
    } catch(e) {}
    return false;
}

function toProxiedUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
    try {
        let parsed;
        if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
            parsed = new URL(rawUrl);
        } else if (rawUrl.startsWith('//')) {
            parsed = new URL(location.protocol + rawUrl);
        } else if (rawUrl.startsWith('/')) {
            parsed = new URL(rawUrl, currentUpstreamOrigin);
        } else {
            parsed = new URL(rawUrl, currentUpstreamUrl);
        }

        // Catalog requests are frequently root-relative. When NookLink was launched
        // from dpl.sd..., resolve those API paths to the canonical web.sd... API host.
        // Also repair URLs built by the SPA from the browser-visible Worker origin.
        if (${isNookLinkService(serviceId, currentTargetUrl) ? 'true' : 'false'} &&
            /^\\/api\\/sd\\/v1(?:\\/|$)/.test(parsed.pathname) &&
            (parsed.origin === location.origin ||
             (rawUrl.startsWith('/') && parsed.origin === 'https://dpl.sd.lp1.acbaa.srv.nintendo.net'))) {
            parsed = new URL(parsed.pathname + parsed.search + parsed.hash, 'https://web.sd.lp1.acbaa.srv.nintendo.net');
        }

        if (isAllowedClientOrigin(parsed.origin)) {
            const proxiedUrl = location.origin + proxyBase + '?url=' + encodeURIComponent(parsed.toString());
            if (${isNookLinkService(serviceId, currentTargetUrl) ? 'true' : 'false'} && parsed.pathname.startsWith('/api/sd/v1/')) {
                
            }
            return proxiedUrl;
        }
    } catch(e) {}
    return rawUrl;
}

function isTrackingUrl(urlStr) {
    if (!urlStr || typeof urlStr !== 'string') return false;
    try {
        const u = new URL(urlStr, location.href);
        const host = u.hostname.toLowerCase();
        return host.includes('google-analytics.com') ||
               host.includes('doubleclick.net') ||
               host.includes('googletagmanager.com') ||
               host.includes('googleads');
    } catch(e) {
        return false;
    }
}

// Global GA/GTM stubs so scripts calling ga(...) or gtag(...) never fail
window.ga = window.ga || function() { (window.ga.q = window.ga.q || []).push(arguments); };
window.ga.l = +new Date;
window.gtag = window.gtag || function() { (window.dataLayer = window.dataLayer || []).push(arguments); };

// Stub script loading for tracking/analytics to prevent ad-blocker connection refused errors in console
try {
    const scriptSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
    if (scriptSrcDescriptor && scriptSrcDescriptor.set) {
        const originalSet = scriptSrcDescriptor.set;
        Object.defineProperty(HTMLScriptElement.prototype, 'src', {
            configurable: true,
            enumerable: scriptSrcDescriptor.enumerable,
            get: function() { return scriptSrcDescriptor.get ? scriptSrcDescriptor.get.call(this) : this.getAttribute('src'); },
            set: function(val) {
                if (isTrackingUrl(String(val || ''))) {
                    return originalSet.call(this, 'data:text/javascript;charset=utf-8,window.ga=window.ga||function(){};window.gtag=window.gtag||function(){};');
                }
                return originalSet.call(this, val);
            }
        });
    }
} catch(e) {}

// Fix YouTube embed origin parameter so postMessage matches recipient window origin
try {
    const iframeSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
    if (iframeSrcDescriptor && iframeSrcDescriptor.set) {
        const originalIframeSet = iframeSrcDescriptor.set;
        Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
            configurable: true,
            enumerable: iframeSrcDescriptor.enumerable,
            get: function() { return iframeSrcDescriptor.get ? iframeSrcDescriptor.get.call(this) : this.getAttribute('src'); },
            set: function(val) {
                let urlStr = String(val || '');
                if (urlStr.includes('youtube.com/embed/') || urlStr.includes('youtube-nocookie.com/embed/')) {
                    try {
                        const u = new URL(urlStr, location.href);
                        if (u.searchParams.has('origin')) {
                            u.searchParams.set('origin', location.origin);
                            urlStr = u.toString();
                        }
                    } catch(e) {}
                }
                return originalIframeSet.call(this, urlStr);
            }
        });
    }
} catch(e) {}

try {
    const nativeSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, value) {
        if (this instanceof HTMLIFrameElement && String(name).toLowerCase() === 'src') {
            let urlStr = String(value || '');
            if (urlStr.includes('youtube.com/embed/') || urlStr.includes('youtube-nocookie.com/embed/')) {
                try {
                    const u = new URL(urlStr, location.href);
                    if (u.searchParams.has('origin')) {
                        u.searchParams.set('origin', location.origin);
                        urlStr = u.toString();
                    }
                } catch(e) {}
            }
            return nativeSetAttribute.call(this, name, urlStr);
        }
        if (this instanceof HTMLScriptElement && String(name).toLowerCase() === 'src' && isTrackingUrl(String(value || ''))) {
            return nativeSetAttribute.call(this, name, 'data:text/javascript;charset=utf-8,window.ga=window.ga||function(){};window.gtag=window.gtag||function(){};');
        }
        return nativeSetAttribute.call(this, name, value);
    };
} catch(e) {}

// Guard postMessage from embedded widgets (e.g. YouTube player API)
try {
    const nativePostMessage = Window.prototype.postMessage;
    Window.prototype.postMessage = function(message, targetOrigin, transfer) {
        try {
            return nativePostMessage.call(this, message, targetOrigin, transfer);
        } catch(e) {
            if (e && (e.name === 'SecurityError' || String(e.message || '').includes('target origin provided'))) {
                return;
            }
            throw e;
        }
    };
} catch(e) {}


const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
    try {
        const rawUrl = typeof input === 'string' ? input : (input instanceof Request ? input.url : '');
        if (isTrackingUrl(rawUrl)) {
            return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        if (typeof input === 'string') {
            return nativeFetch(toProxiedUrl(input), init);
        } else if (input instanceof Request) {
            return nativeFetch(new Request(toProxiedUrl(input.url), input), init);
        }
    } catch(e) {}
    return nativeFetch(input, init);
};

const nativeXhrOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    try {
        if (isTrackingUrl(String(url || ''))) {
            this._isTracking = true;
        }
        return nativeXhrOpen.call(this, method, toProxiedUrl(String(url)), ...rest);
    } catch(e) {
        return nativeXhrOpen.call(this, method, url, ...rest);
    }
};

const nativeXhrSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function(...args) {
    if (this._isTracking) {
        Object.defineProperty(this, 'status', { value: 200, writable: true, configurable: true });
        Object.defineProperty(this, 'responseText', { value: '{}', writable: true, configurable: true });
        Object.defineProperty(this, 'readyState', { value: 4, writable: true, configurable: true });
        setTimeout(() => {
            if (typeof this.onreadystatechange === 'function') this.onreadystatechange(new Event('readystatechange'));
            if (typeof this.onload === 'function') this.onload(new ProgressEvent('load'));
        }, 0);
        return;
    }
    return nativeXhrSend.apply(this, args);
};


let requestCounter = 0;
const pendingCallbacks = new Map();

window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'NSO_RECEIVE_GAME_WEB_TOKEN') {
        const token = data.token || null;
        
        if (typeof window.znca?._private?.func_1d5e === 'function') {
            try {
                window.znca._private.func_1d5e(token);
                
            } catch(e) {
                console.warn('[znca-js-api:bridge] func_1d5e callback error:', e);
            }
        }
        if (typeof window.onGameWebTokenReceive === 'function') {
            try {
                window.onGameWebTokenReceive(token);
                
            } catch(e) {
                console.warn('[znca-js-api:bridge] onGameWebTokenReceive callback error:', e);
            }
        }
        if (data.requestId && pendingCallbacks.has(data.requestId)) {
            const cb = pendingCallbacks.get(data.requestId);
            pendingCallbacks.delete(data.requestId);
            try { cb(token); } catch(e) {}
        }
    }
});

function postBridgeMessage(type, payload = {}) {
    try {
        window.parent.postMessage({ type, sessionId, serviceId, ...payload }, '*');
    } catch(e) {}
}

const TOURNAMENT_MANAGER_BROWSER_URL = 'https://c.nintendo.com/splatoon3-tournament';
const IS_SPLATNET3_WEBVIEW = ${isSplatNet3Service(serviceId, currentTargetUrl) ? 'true' : 'false'};
const nativeWindowOpen = typeof window.open === 'function' ? window.open.bind(window) : null;

function getTournamentManagerExternalUrl(rawUrl) {
    if (!rawUrl || !IS_SPLATNET3_WEBVIEW) return null;

    try {
        let candidate = new URL(String(rawUrl), currentUpstreamUrl);

        // Nintendo links may already have been rewritten through our Worker proxy.
        if (
            candidate.origin === location.origin &&
            candidate.pathname.includes('/api/nso/webview/') &&
            candidate.pathname.includes('/proxy')
        ) {
            const wrappedUrl = candidate.searchParams.get('url');
            if (wrappedUrl) candidate = new URL(wrappedUrl);
        }

        const hostname = candidate.hostname.toLowerCase();
        const path = candidate.pathname.toLowerCase();

        if (
            candidate.protocol === 'https:' &&
            hostname === 'c.nintendo.com' &&
            (path === '/splatoon3-tournament' || path.startsWith('/splatoon3-tournament/'))
        ) {
            return TOURNAMENT_MANAGER_BROWSER_URL;
        }
    } catch(e) {}

    return null;
}

let lastTournamentOpenTime = 0;
function openTournamentManagerOutsideWebView(source) {
    if (!IS_SPLATNET3_WEBVIEW) return null;

    const now = Date.now();
    if (now - lastTournamentOpenTime < 1500) {
        return null;
    }
    lastTournamentOpenTime = now;

    postBridgeMessage('NSO_OPEN_EXTERNAL_BROWSER', {
        url: TOURNAMENT_MANAGER_BROWSER_URL
    });

    return true;
}



if (IS_SPLATNET3_WEBVIEW) {
    // Do NOT touch click events. Let SplatNet/React process the Tournament Manager
    // button exactly as Nintendo intended. We only cancel the resulting navigation
    // once it is actually headed into the Tournament Manager browser site.
    try {
        if (window.navigation && typeof window.navigation.addEventListener === 'function') {
            window.navigation.addEventListener('navigate', (event) => {
                const destinationUrl =
                    event &&
                    event.destination &&
                    event.destination.url;

                if (!getTournamentManagerExternalUrl(destinationUrl)) return;

                

                if (event.cancelable) {
                    event.preventDefault();
                    openTournamentManagerOutsideWebView('navigation-api');

                    // SplatNet has already moved into its internal /tournament route
                    // before this cross-document navigation is emitted. Reloading here would
                    // simply reload /tournament and immediately trigger Tournament Manager
                    // again, creating an infinite loop.
                    //
                    // Instead, replace the embedded document with this session's proxied
                    // SplatNet root. This clears the abandoned Next/React loading state AND
                    // guarantees we do not boot back into /tournament?path=/.
                    setTimeout(() => {
                        try {
                            const rootTarget = new URL('/', currentUpstreamUrl);
                            const rootProxy =
                                '/api/nso/webview/' +
                                encodeURIComponent(sessionId) +
                                '/proxy?url=' +
                                encodeURIComponent(rootTarget.toString());

                            

                            window.location.replace(rootProxy);
                        } catch(e) {
                            console.warn('[TournamentManager:ReturnToSplatNetRoot] failed');
                        }
                    }, 0);
                }
            });
        }
    } catch(e) {
        console.warn('[TournamentManager:NavigationAPI] hook failed');
    }

    // If Nintendo explicitly uses window.open for this destination, preserve that
    // behavior while forcing the canonical external browser URL.
    try {
        if (nativeWindowOpen) {
            window.open = function(url, target, features) {
                if (getTournamentManagerExternalUrl(url)) {
                    
                    return openTournamentManagerOutsideWebView('window.open');
                }
                return nativeWindowOpen(url, target, features);
            };
        }
    } catch(e) {}


}

const api = {
    func_272e: function() {
        const reqId = 'req_' + (++requestCounter) + '_' + Date.now();
        
        postBridgeMessage('NSO_REQUEST_GAME_WEB_TOKEN', { requestId: reqId, isZelda: true });
    },
    func_2644: function(data) {
        try {
            const parsed = typeof data === 'string' ? JSON.parse(data) : data;
            const pattern = String(parsed?.pattern ?? '0');
            
            if (navigator.vibrate) {
                if (pattern === '0') navigator.vibrate([15]);
                else if (pattern === '1') navigator.vibrate([15, 50, 15]);
                else if (pattern === '2') navigator.vibrate([40, 60, 40]);
            }
        } catch(e) {}
    },
    requestGameWebToken: function() {
        const reqId = 'req_' + (++requestCounter) + '_' + Date.now();
        
        postBridgeMessage('NSO_REQUEST_GAME_WEB_TOKEN', { requestId: reqId, isZelda: false });
    },
    restorePersistentData: function() {
        
        const key = 'nso_persist_' + serviceId;
        let val = '';
        if (${isZeldaNotesService(serviceId, currentTargetUrl) ? 'true' : 'false'}) {
            // Zelda Notes: Always return empty string to force the game selector on boot
            val = '';
        } else {
            val = localStorage.getItem(key);
            if (val === null || val === undefined) val = '';
        }

        let attempts = 0;
        const deliver = () => {
            let delivered = false;
            if (typeof window.onPersistentDataRestore === 'function') {
                try {
                    window.onPersistentDataRestore.call(null, String(val ?? ''));
                    delivered = true;
                } catch(e) {}
            }
            if (typeof window.znca?._private?.onPersistentDataRestore === 'function') {
                try {
                    window.znca._private.onPersistentDataRestore(String(val ?? ''));
                    delivered = true;
                } catch(e) {}
            }
            if (delivered) {
                
                return;
            }
            if (++attempts < 50) {
                setTimeout(deliver, 20);
            } else {
                console.warn('[NookLinkBridge] onPersistentDataRestore callback never registered');
            }
        };
        setTimeout(deliver, 0);
    },
    storePersistentData: function(val) {
        
        const key = 'nso_persist_' + serviceId;
        localStorage.setItem(key, String(val ?? ''));
        let attempts = 0;
        const deliver = () => {
            let delivered = false;
            if (typeof window.onPersistentDataStore === 'function') {
                try {
                    window.onPersistentDataStore.call(null, '');
                    delivered = true;
                } catch(e) {}
            }
            if (typeof window.znca?._private?.onPersistentDataStore === 'function') {
                try {
                    window.znca._private.onPersistentDataStore('');
                    delivered = true;
                } catch(e) {}
            }
            if (delivered) {
                
                return;
            }
            if (++attempts < 50) {
                setTimeout(deliver, 20);
            }
        };
        setTimeout(deliver, 0);
    },
    copyToClipboard: function(val) {
        
        if (navigator.clipboard) navigator.clipboard.writeText(String(val)).catch(()=>{});
        postBridgeMessage('NSO_COPY_TO_CLIPBOARD', { text: String(val) });
    },
    completeLoading: function() {
        
        postBridgeMessage('NSO_COMPLETE_LOADING');
    },
    closeWebView: function() {
        
        postBridgeMessage('NSO_CLOSE_WEBVIEW');
    },
    reloadExtension: function() {
        // NO-OP per nxapi znca-js-api specification: must NEVER call location.reload() or trigger navigation
        
    },
    clearUnreadFlag: function() {
        
        postBridgeMessage('NSO_CLEAR_UNREAD');
    },
    openExternalBrowser: function(url) {
        try {
            const u = new URL(url);
            if (['http:', 'https:'].includes(u.protocol)) {
                // Keep query/fragment out of logs because app links can carry state.
                
                postBridgeMessage('NSO_OPEN_EXTERNAL_BROWSER', { url: u.href });
                window.open(u.href, '_blank');
            }
        } catch(e) {}
    },
    invokeNativeShare: function(data) {
        try {
            
            const p = JSON.parse(data);
            if (navigator.share) navigator.share({ text: p.text || '', url: p.image_url || undefined }).catch(()=>{});
            postBridgeMessage('NSO_NATIVE_SHARE', p);
        } catch(e) {}
    },
    invokeNativeShareUrl: function(data) {
        try {
            
            const p = JSON.parse(data);
            if (navigator.share) navigator.share({ text: p.text || '', url: p.url || undefined }).catch(()=>{});
            postBridgeMessage('NSO_NATIVE_SHARE_URL', p);
        } catch(e) {}
    },
    downloadImages: function(imagesJson) {
        try {
            
            const list = JSON.parse(imagesJson);
            for (const item of (Array.isArray(list) ? list : [])) {
                const a = document.createElement('a');
                a.href = item;
                a.download = '';
                a.target = '_blank';
                a.click();
            }
        } catch(e) {}
    },
    sendMessage: function(data) {
        let msgType = '';
        try {
            const parsed = typeof data === 'string' ? JSON.parse(data) : data;
            msgType = parsed?.type || '';
        } catch(e) {}
        
        postBridgeMessage('NSO_SEND_MESSAGE', { data });
    },
    openQRCodeReader: function(data) {
        
        postBridgeMessage('NSO_OPEN_QR_CODE_READER', { data });
    },
    closeQRCodeReader: function() {
        
        postBridgeMessage('NSO_CLOSE_QR_CODE_READER');
    },
    openQRCodeReaderFromPhotoLibrary: function(data) {
        
        postBridgeMessage('NSO_OPEN_QR_CODE_READER_FROM_PHOTO_LIBRARY', { data });

        if (!${isNookLinkService(serviceId, currentTargetUrl) ? 'true' : 'false'}) return;

        // NookLink calls this bridge method before assigning window.onQRCodeRead.
        // Opening the file input synchronously preserves the user's activation; the
        // selected image is decoded later and delivered as the native binary QR payload.
        const previous = window.__nsoNookPhotoQrSession;
        if (previous && previous.input && previous.input.parentNode) {
            previous.closed = true;
            previous.input.parentNode.removeChild(previous.input);
        }

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.multiple = true;
        input.setAttribute('aria-hidden', 'true');
        input.style.position = 'fixed';
        input.style.left = '-10000px';
        input.style.top = '-10000px';
        input.style.width = '1px';
        input.style.height = '1px';
        input.style.opacity = '0';

        const session = { input: input, closed: false };
        window.__nsoNookPhotoQrSession = session;

        const cleanup = () => {
            if (input.parentNode) input.parentNode.removeChild(input);
            if (window.__nsoNookPhotoQrSession === session) {
                window.__nsoNookPhotoQrSession = null;
            }
        };

        const getDecoder = () => {
            if (typeof window.jsQR === 'function') return Promise.resolve(window.jsQR);
            if (window.__nsoJsQrLoader) return window.__nsoJsQrLoader;

            window.__nsoJsQrLoader = new Promise((resolve, reject) => {
                const existing = document.getElementById('nso-jsqr-decoder');
                if (existing) {
                    existing.addEventListener('load', () => {
                        if (typeof window.jsQR === 'function') resolve(window.jsQR);
                        else reject(new Error('jsQR loaded without exposing window.jsQR'));
                    }, { once: true });
                    existing.addEventListener('error', () => reject(new Error('jsQR failed to load')), { once: true });
                    return;
                }

                const script = document.createElement('script');
                script.id = 'nso-jsqr-decoder';
                script.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
                script.referrerPolicy = 'no-referrer';
                script.onload = () => {
                    if (typeof window.jsQR === 'function') resolve(window.jsQR);
                    else reject(new Error('jsQR loaded without exposing window.jsQR'));
                };
                script.onerror = () => reject(new Error('jsQR failed to load'));
                (document.head || document.documentElement).appendChild(script);
            }).catch(err => {
                window.__nsoJsQrLoader = null;
                throw err;
            });

            return window.__nsoJsQrLoader;
        };

        const imageDataFromFile = async (file) => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) throw new Error('Canvas 2D context is unavailable');

            let source;
            let sourceWidth = 0;
            let sourceHeight = 0;
            let objectUrl = null;

            try {
                if (typeof createImageBitmap === 'function') {
                    source = await createImageBitmap(file);
                    sourceWidth = source.width;
                    sourceHeight = source.height;
                } else {
                    objectUrl = URL.createObjectURL(file);
                    source = await new Promise((resolve, reject) => {
                        const img = new Image();
                        img.onload = () => resolve(img);
                        img.onerror = () => reject(new Error('Selected image could not be decoded'));
                        img.src = objectUrl;
                    });
                    sourceWidth = source.naturalWidth || source.width;
                    sourceHeight = source.naturalHeight || source.height;
                }

                if (!sourceWidth || !sourceHeight) throw new Error('Selected image has invalid dimensions');

                // Keep large phone photos manageable while retaining enough QR detail.
                const maxDimension = 3000;
                const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
                canvas.width = Math.max(1, Math.round(sourceWidth * scale));
                canvas.height = Math.max(1, Math.round(sourceHeight * scale));
                ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
                return ctx.getImageData(0, 0, canvas.width, canvas.height);
            } finally {
                if (source && typeof source.close === 'function') {
                    try { source.close(); } catch(e) {}
                }
                if (objectUrl) URL.revokeObjectURL(objectUrl);
            }
        };

        const bytesToBase64 = (bytes) => {
            let binary = '';
            const view = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes || []);
            const chunkSize = 0x8000;
            for (let i = 0; i < view.length; i += chunkSize) {
                binary += String.fromCharCode.apply(null, view.subarray(i, i + chunkSize));
            }
            return btoa(binary);
        };

        const getProSheetIndex = (bytes) => {
            if (!bytes || bytes.length !== 563) return null;
            const c0 = bytes[0];
            const c1 = bytes[1];
            const c2 = bytes[2];
            if (
                (c0 >> 4) === 3 &&
                (c1 >> 4) === 3 &&
                (c2 & 0x0f) === 4 &&
                bytes[3] === 0x02 &&
                bytes[4] === 0x1c
            ) {
                const index = c0 & 0x0f;
                return index >= 0 && index <= 3 ? index : null;
            }
            return null;
        };

        const waitForQrCallback = async () => {
            for (let i = 0; i < 100; i++) {
                if (typeof window.onQRCodeRead === 'function') return window.onQRCodeRead;
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            return null;
        };

        input.addEventListener('cancel', () => {
            cleanup();
        }, { once: true });

        input.addEventListener('change', async () => {
            const files = Array.from(input.files || []);
            if (!files.length) {
                cleanup();
                return;
            }

            try {
                const decoder = await getDecoder();
                const decoded = [];

                for (const file of files) {
                    if (session.closed) break;
                    const imageData = await imageDataFromFile(file);
                    const result = decoder(imageData.data, imageData.width, imageData.height, {
                        inversionAttempts: 'attemptBoth'
                    });
                    if (!result || !result.binaryData) {
                        throw new Error('No QR code found in selected image: ' + (file.name || 'unnamed image'));
                    }
                    const bytes = Uint8Array.from(result.binaryData);
                    decoded.push({
                        payload: bytesToBase64(bytes),
                        proSheetIndex: getProSheetIndex(bytes)
                    });
                }

                // For ACNL Pro designs, users can select all four QR images at once.
                // Sort recognized Pro sheets by their embedded 0..3 index before delivery.
                if (decoded.length > 1 && decoded.every(item => item.proSheetIndex !== null)) {
                    decoded.sort((a, b) => a.proSheetIndex - b.proSheetIndex);
                }

                const callback = await waitForQrCallback();
                if (!callback) throw new Error('NookLink did not register window.onQRCodeRead');

                for (const item of decoded) {
                    if (session.closed) break;
                    callback(item.payload);
                    await Promise.resolve();
                }

                
            } catch(err) {
                console.warn('[NookLinkBridge] photo-library QR decode failed', err);
                const callback = await waitForQrCallback();
                if (!session.closed && callback) {
                    try { callback(); } catch(e) {}
                }
            } finally {
                cleanup();
            }
        }, { once: true });

        (document.body || document.documentElement).appendChild(input);
        input.click();
    },
    closeQRCodeReaderFromPhotoLibrary: function() {
        
        const session = window.__nsoNookPhotoQrSession;
        if (session) {
            session.closed = true;
            if (session.input && session.input.parentNode) {
                session.input.parentNode.removeChild(session.input);
            }
            window.__nsoNookPhotoQrSession = null;
        }
        postBridgeMessage('NSO_CLOSE_QR_CODE_READER_FROM_PHOTO_LIBRARY');
    },
    openQRCodeReaderForCheckin: function(data) {
        if (!${isSplatNet3Service(serviceId, currentTargetUrl) ? 'true' : 'false'}) {
            
            return;
        }

        let options = {};
        try {
            options = typeof data === 'string' ? JSON.parse(data) : (data || {});
        } catch(e) {}

        const source = options && options.source === 'photo_library'
            ? 'photo_library'
            : 'camera';

        

        // Cancel/replace any stale browser-side scanner session.
        const previous = window.__nsoSplatNetCheckinQrSession;
        if (previous) {
            previous.closed = true;
            if (previous.input && previous.input.parentNode) {
                previous.input.parentNode.removeChild(previous.input);
            }
        }

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.multiple = false;
        input.setAttribute('aria-hidden', 'true');

        // On phones/tablets this asks for the rear camera when SplatNet requests
        // source="camera". Desktop Chromium naturally falls back to a file picker,
        // which still makes the check-in flow usable without native Coral APIs.
        if (source === 'camera') {
            input.setAttribute('capture', 'environment');
        }

        input.style.position = 'fixed';
        input.style.left = '-10000px';
        input.style.top = '-10000px';
        input.style.width = '1px';
        input.style.height = '1px';
        input.style.opacity = '0';

        const session = {
            input,
            source,
            closed: false,
            completed: false
        };
        window.__nsoSplatNetCheckinQrSession = session;

        const cleanup = () => {
            if (input.parentNode) input.parentNode.removeChild(input);
            if (window.__nsoSplatNetCheckinQrSession === session) {
                window.__nsoSplatNetCheckinQrSession = null;
            }
        };

        const waitForCallback = async () => {
            for (let i = 0; i < 200; i++) {
                if (typeof window.onQRCodeReadForCheckin === 'function') {
                    return window.onQRCodeReadForCheckin;
                }
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            return null;
        };

        const deliver = async (status, text) => {
            if (session.closed || session.completed) return false;

            const callback = await waitForCallback();
            if (!callback || session.closed || session.completed) {
                console.warn('[SplatNet3QR] onQRCodeReadForCheckin callback was not registered');
                return false;
            }

            session.completed = true;
            const result = JSON.stringify({
                status,
                text: status === 'SUCCEEDED' ? String(text || '') : null
            });

            try {
                callback.call(null, result);
                
                return true;
            } catch(err) {
                console.warn('[SplatNet3QR] callback failed', err);
                return false;
            }
        };

        const getDecoder = () => {
            // Reuse the exact same global/cache that the latest NookLink
            // photo-library implementation uses.
            if (typeof window.jsQR === 'function') return Promise.resolve(window.jsQR);
            if (window.__nsoJsQrLoader) return window.__nsoJsQrLoader;

            window.__nsoJsQrLoader = new Promise((resolve, reject) => {
                const existing = document.getElementById('nso-jsqr-decoder');
                if (existing) {
                    if (typeof window.jsQR === 'function') {
                        resolve(window.jsQR);
                        return;
                    }

                    existing.addEventListener('load', () => {
                        if (typeof window.jsQR === 'function') resolve(window.jsQR);
                        else reject(new Error('jsQR loaded without exposing window.jsQR'));
                    }, { once: true });
                    existing.addEventListener(
                        'error',
                        () => reject(new Error('jsQR failed to load')),
                        { once: true }
                    );
                    return;
                }

                const script = document.createElement('script');
                script.id = 'nso-jsqr-decoder';
                script.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
                script.referrerPolicy = 'no-referrer';
                script.onload = () => {
                    if (typeof window.jsQR === 'function') resolve(window.jsQR);
                    else reject(new Error('jsQR loaded without exposing window.jsQR'));
                };
                script.onerror = () => reject(new Error('jsQR failed to load'));
                (document.head || document.documentElement).appendChild(script);
            }).catch(err => {
                window.__nsoJsQrLoader = null;
                throw err;
            });

            return window.__nsoJsQrLoader;
        };

        const imageDataFromFile = async (file) => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) throw new Error('Canvas 2D context is unavailable');

            let sourceImage;
            let sourceWidth = 0;
            let sourceHeight = 0;
            let objectUrl = null;

            try {
                if (typeof createImageBitmap === 'function') {
                    sourceImage = await createImageBitmap(file);
                    sourceWidth = sourceImage.width;
                    sourceHeight = sourceImage.height;
                } else {
                    objectUrl = URL.createObjectURL(file);
                    sourceImage = await new Promise((resolve, reject) => {
                        const img = new Image();
                        img.onload = () => resolve(img);
                        img.onerror = () => reject(new Error('Selected image could not be decoded'));
                        img.src = objectUrl;
                    });
                    sourceWidth = sourceImage.naturalWidth || sourceImage.width;
                    sourceHeight = sourceImage.naturalHeight || sourceImage.height;
                }

                if (!sourceWidth || !sourceHeight) {
                    throw new Error('Selected image has invalid dimensions');
                }

                // Same upper bound used by the current NookLink implementation.
                const maxDimension = 3000;
                const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
                canvas.width = Math.max(1, Math.round(sourceWidth * scale));
                canvas.height = Math.max(1, Math.round(sourceHeight * scale));
                ctx.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);

                return ctx.getImageData(0, 0, canvas.width, canvas.height);
            } finally {
                if (sourceImage && typeof sourceImage.close === 'function') {
                    try { sourceImage.close(); } catch(e) {}
                }
                if (objectUrl) URL.revokeObjectURL(objectUrl);
            }
        };

        const bytesToBase64 = (bytes) => {
            let binary = '';
            const view = bytes instanceof Uint8Array
                ? bytes
                : Uint8Array.from(bytes || []);
            const chunkSize = 0x8000;

            for (let i = 0; i < view.length; i += chunkSize) {
                binary += String.fromCharCode.apply(
                    null,
                    view.subarray(i, i + chunkSize)
                );
            }

            return btoa(binary);
        };

        input.addEventListener('cancel', async () => {
            try {
                await deliver('CANCELLED', null);
            } finally {
                cleanup();
            }
        }, { once: true });

        input.addEventListener('change', async () => {
            const file = input.files && input.files[0];

            if (!file) {
                try {
                    await deliver('CANCELLED', null);
                } finally {
                    cleanup();
                }
                return;
            }

            try {
                const decoder = await getDecoder();
                if (session.closed) return;

                const imageData = await imageDataFromFile(file);
                if (session.closed) return;

                const result = decoder(
                    imageData.data,
                    imageData.width,
                    imageData.height,
                    { inversionAttempts: 'attemptBoth' }
                );

                if (!result || !result.binaryData || !result.binaryData.length) {
                    throw new Error('No QR code found in selected image');
                }

                const payload = bytesToBase64(
                    Uint8Array.from(result.binaryData)
                );

                await deliver('SUCCEEDED', payload);
            } catch(err) {
                console.warn('[SplatNet3QR] QR decode failed', err);
                await deliver('ERROR', null);
            } finally {
                cleanup();
            }
        }, { once: true });

        (document.body || document.documentElement).appendChild(input);

        try {
            // Must stay synchronous with SplatNet's bridge call so browsers accept
            // the picker/camera invocation as user initiated.
            input.click();
        } catch(err) {
            console.warn('[SplatNet3QR] picker could not be opened', err);
            deliver('ERROR', null).finally(cleanup);
        }
    }
};

window.jsBridge = api;
Object.assign(window, api);

const IS_NOOKLINK_READY_SERVICE = ${isNookLinkService(serviceId, currentTargetUrl) ? 'true' : 'false'};
const IS_SPLATNET2_READY_SERVICE = ${isSplatNet2Service(serviceId, currentTargetUrl) ? 'true' : 'false'};
const IS_SMASH_READY_SERVICE = ${isSmashWorldService(serviceId, currentTargetUrl) ? 'true' : 'false'};
let nsoServiceReadySent = false;

function signalNsoServiceReady(source) {
    if (nsoServiceReadySent) return;
    nsoServiceReadySent = true;
    
    postBridgeMessage('NSO_COMPLETE_LOADING', { source: source || 'service-ready' });
}

function onNsoDomReady(callback) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', callback, { once: true });
    } else {
        queueMicrotask(callback);
    }
}

if (IS_NOOKLINK_READY_SERVICE) {
    window.addEventListener('error', (e) => {
        console.warn('[NookLinkJsError]', {
            message: e.message,
            script: e.filename ? new URL(e.filename, location.href).pathname : 'inline',
            line: e.lineno,
            column: e.colno,
            errorName: e.error ? e.error.name : 'Error'
        });
    });
    window.addEventListener('unhandledrejection', (e) => {
        console.warn('[NookLinkUnhandledRejection]', { reason: String(e.reason) });
    });
    onNsoDomReady(() => {
        
        // NookLink predates completeLoading(). Its native-visible shell is ready at
        // DOMContentLoaded; its API/profile calls continue underneath just like the app.
        signalNsoServiceReady('nooklink-domcontentloaded');
    });
}

if (IS_SPLATNET2_READY_SERVICE) {
    onNsoDomReady(() => {
        let upstreamPath = '';
        try { upstreamPath = new URL(currentUpstreamUrl).pathname; } catch(e) {}
        // The root bootstrap response is consumed by the Worker and redirected to /home,
        // so the first browser-rendered SplatNet 2 document is the native home screen.
        if (upstreamPath === '/home' || upstreamPath.startsWith('/home/')) {
            signalNsoServiceReady('splatnet2-home-domcontentloaded');
        }
    });
}

if (IS_SMASH_READY_SERVICE) {
    onNsoDomReady(() => {
        let observer = null;
        const checkSmashReady = () => {
            if (nsoServiceReadySent) {
                try { observer?.disconnect(); } catch(e) {}
                return true;
            }
            const root = document.getElementById('content') || document.getElementById('root') || document.getElementById('app');
            if (!root || root.children.length === 0) return false;
            const textLength = String(root.innerText || '').trim().length;
            const hasInteractiveUi = Boolean(root.querySelector('img,button,a,nav,main,section,article,[role="button"],[role="link"]'));
            if (textLength < 8 && !hasInteractiveUi) return false;
            
            signalNsoServiceReady('smash-react-rendered');
            try { observer?.disconnect(); } catch(e) {}
            return true;
        };

        if (!checkSmashReady() && typeof MutationObserver === 'function') {
            observer = new MutationObserver(checkSmashReady);
            observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
            // These are checks, not artificial loading delays; MutationObserver remains
            // authoritative and normally fires as soon as React paints meaningful UI.
            setTimeout(checkSmashReady, 250);
            setTimeout(checkSmashReady, 750);
            setTimeout(checkSmashReady, 1500);
        }
    });
}

const baseReset = 'html, body { margin: 0 !important; padding: 0 !important; width: 100% !important; }';
const combinedCss = baseReset + (${JSON.stringify(customCss)} ? ' ' + ${JSON.stringify(customCss)} : '');
const s = document.createElement('style');
s.textContent = combinedCss;
document.head ? document.head.appendChild(s) : document.addEventListener('DOMContentLoaded', () => document.head.appendChild(s));
})();
</script>`;
}
