/** HTML resource URL rewriting for the authenticated game-service proxy. */
import { isOriginWhitelisted, isSmashWorldService, isZeldaNotesService } from '../services/service-policy';

const GAME_SCRIPT_CACHE_VERSION = '20260817-v1';

export function rewriteHtmlAssets(
    html: string,
    sessionId: string,
    serviceId: string,
    serviceUri: string | undefined,
    currentTargetUrl: string,
    allowedOrigins: string[]
): string {
    const currentOrigin = new URL(currentTargetUrl).origin;
    const proxyBase = `/api/nso/webview/${sessionId}/proxy`;
    const stableAssetBase = `/api/nso/webview-static/${encodeURIComponent(String(serviceId))}`;
    const isZelda = isZeldaNotesService(serviceId, serviceUri || currentTargetUrl);
    const isSmash = isSmashWorldService(serviceId, serviceUri || currentTargetUrl);
    let directResourceCount = 0;

    function resolveUpstreamUrl(urlStr: string): URL | null {
        if (!urlStr || typeof urlStr !== 'string') return null;
        const trimmed = urlStr.trim();
        if (
            trimmed.startsWith('/api/nso/webview/') ||
            trimmed.startsWith('/api/nso/webview-static/') ||
            trimmed.startsWith('data:') ||
            trimmed.startsWith('javascript:') ||
            trimmed.startsWith('#') ||
            trimmed.startsWith('mailto:') ||
            trimmed.startsWith('blob:') ||
            trimmed.startsWith('tel:')
        ) return null;

        try {
            if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return new URL(trimmed);
            if (trimmed.startsWith('//')) return new URL('https:' + trimmed);
            if (trimmed.startsWith('/')) return new URL(trimmed, currentOrigin);
            return new URL(trimmed, currentTargetUrl);
        } catch {
            return null;
        }
    }

    function isNintendoUrl(parsed: URL): boolean {
        const hostname = parsed.hostname.toLowerCase();
        return hostname.endsWith('.srv.nintendo.net') || hostname.endsWith('.nintendo.net') || hostname.endsWith('.nintendo.com');
    }

    function toBrowserUrl(urlStr: string): string {
        const parsed = resolveUpstreamUrl(urlStr);
        if (!parsed) return urlStr;

        if (isOriginWhitelisted(parsed.origin, allowedOrigins) || isNintendoUrl(parsed)) {
            return `${proxyBase}?url=${encodeURIComponent(parsed.toString())}`;
        }
        return urlStr;
    }

    function staticPathMarker(parsed: URL): boolean {
        const pathname = parsed.pathname.toLowerCase();
        return pathname.includes('/_next/static/') || pathname.includes('/static/') || pathname.includes('/assets/');
    }

    function hashedBasename(parsed: URL): boolean {
        const basename = parsed.pathname.toLowerCase().slice(parsed.pathname.lastIndexOf('/') + 1);
        return /(?:^|[._-])[a-f0-9]{8,}(?:[._-]|$)/i.test(basename);
    }

    function reusableScriptPath(parsed: URL): boolean {
        const pathname = parsed.pathname.toLowerCase();
        if (!(pathname.endsWith('.js') || pathname.endsWith('.mjs') || pathname.includes('/_next/static/chunks/'))) return false;
        if (staticPathMarker(parsed)) return true;
        const basename = pathname.slice(pathname.lastIndexOf('/') + 1);
        return hashedBasename(parsed) || /(?:^|[._-])chunk(?:[._-]|$)/i.test(basename);
    }

    function reusableImagePath(parsed: URL): boolean {
        const pathname = parsed.pathname.toLowerCase();
        if (!/\.(?:png|jpe?g|webp|gif|svg|ico|avif)$/i.test(pathname)) return false;
        return staticPathMarker(parsed) || hashedBasename(parsed) || parsed.hostname.toLowerCase().includes('.cdn.nintendo.net');
    }

    function stableAssetUrl(parsed: URL): string {
        return `${stableAssetBase}?v=${encodeURIComponent(GAME_SCRIPT_CACHE_VERSION)}&url=${encodeURIComponent(parsed.toString())}`;
    }

    function toStableScriptUrl(urlStr: string): string | null {
        const parsed = resolveUpstreamUrl(urlStr);
        if (!parsed || parsed.protocol !== 'https:' || !isNintendoUrl(parsed) || !reusableScriptPath(parsed)) return null;
        return stableAssetUrl(parsed);
    }

    function escapeHtmlAttribute(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    /**
     * Direct bypass is deliberately limited to ordinary <img> resources and icons.
     * A direct image receives crossorigin=anonymous so it either remains canvas-safe
     * or fails CORS and triggers the authenticated Worker fallback. Clearly static
     * fallback images use a session-independent browser cache key, so the first failed
     * direct attempt still preserves compatibility while later game launches can reuse
     * the already-proxied image without another Worker/DO request.
     *
     * Zelda stays entirely proxied because its map is known to be readback-heavy.
     * Stylesheets, audio/video/source and executable scripts keep a same-origin Worker
     * path unless separately handled by the stable patched-script cache.
     */
    function canLoadDirect(tagName: string, attrName: string, parsed: URL, tag: string): boolean {
        if (isZelda || parsed.protocol !== 'https:' || !isNintendoUrl(parsed)) return false;

        const tagLower = tagName.toLowerCase();
        const attrLower = attrName.toLowerCase();
        if (tagLower === 'img' && attrLower === 'src') return true;

        if (tagLower === 'link' && attrLower === 'href') {
            const rel = /\brel\s*=\s*(["'])([^"']+)\1/i.exec(tag)?.[2]?.toLowerCase() || '';
            return /(^|\s)(icon|apple-touch-icon)(\s|$)/.test(rel);
        }

        return false;
    }

    function directWithFallback(tagName: string, attrName: string, tag: string, rawUrl: string): { url: string; fallback?: string } {
        const parsed = resolveUpstreamUrl(rawUrl);
        if (!parsed || !canLoadDirect(tagName, attrName, parsed, tag)) return { url: toBrowserUrl(rawUrl) };

        directResourceCount++;
        const fallback = reusableImagePath(parsed)
            ? stableAssetUrl(parsed)
            : `${proxyBase}?url=${encodeURIComponent(parsed.toString())}`;
        return {
            url: parsed.toString(),
            fallback
        };
    }

    // Smash's production bundle occasionally passes URL objects to fetch(), and can
    // also construct absolute URLs from the browser-visible Worker origin. The main
    // bridge handles strings/Request instances, so normalize those two remaining
    // cases before Smash's own scripts execute. Keep this scoped to Smash World.
    const smashCompatScript = isSmash ? `<script id="nso-smash-browser-compat">
(()=>{
    const upstreamOrigin = ${JSON.stringify(currentOrigin)};
    const upstreamUrl = ${JSON.stringify(currentTargetUrl)};
    const proxyBase = ${JSON.stringify(proxyBase)};

    function smashProxyUrl(raw) {
        if (!raw) return raw;
        try {
            const text = raw instanceof URL ? raw.toString() : String(raw);
            if (!text) return raw;
            let parsed = new URL(text, upstreamUrl);

            // Already inside this authenticated session proxy.
            if (parsed.origin === location.origin && parsed.pathname.startsWith(proxyBase)) {
                return parsed.toString();
            }

            // Code running in the proxied document sees workers.dev as location.origin.
            // Translate URLs built from that synthetic origin back to Smash's real origin.
            if (parsed.origin === location.origin) {
                parsed = new URL(parsed.pathname + parsed.search + parsed.hash, upstreamOrigin);
            }

            const host = parsed.hostname.toLowerCase();
            const isNintendo = host.endsWith('.nintendo.net') || host.endsWith('.nintendo.com');
            if (!isNintendo) return text;

            return location.origin + proxyBase + '?url=' + encodeURIComponent(parsed.toString());
        } catch(e) {
            return raw;
        }
    }

    try {
        const bridgedFetch = window.fetch.bind(window);
        window.fetch = function(input, init) {
            try {
                if (typeof input === 'string' || input instanceof URL) {
                    return bridgedFetch(smashProxyUrl(input), init);
                }
                if (input instanceof Request) {
                    const nextUrl = smashProxyUrl(input.url);
                    if (String(nextUrl) !== input.url) {
                        return bridgedFetch(new Request(String(nextUrl), input), init);
                    }
                }
            } catch(e) {}
            return bridgedFetch(input, init);
        };
    } catch(e) {}

    // Smash registers observation-only touchstart handlers as non-passive. Upgrade
    // only handlers that do not call preventDefault(), preserving cancellable touch
    // behavior while avoiding Chromium's scroll-blocking violation warning.
    try {
        const nativeAddEventListener = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function(type, listener, options) {
            if (String(type || '').toLowerCase() === 'touchstart') {
                let callsPreventDefault = false;
                try {
                    const candidate = typeof listener === 'function'
                        ? listener
                        : (listener && typeof listener.handleEvent === 'function' ? listener.handleEvent : null);
                    const source = candidate ? Function.prototype.toString.call(candidate) : '';
                    callsPreventDefault = source.includes('preventDefault');
                } catch(e) {}

                if (!callsPreventDefault) {
                    if (options == null || typeof options === 'boolean') {
                        options = { capture: options === true, passive: true };
                    } else if (typeof options === 'object' && options.passive !== true) {
                        options = Object.assign({}, options, { passive: true });
                    }
                }
            }
            return nativeAddEventListener.call(this, type, listener, options);
        };
    } catch(e) {}
})();
</script>` : '';

    // Avoid rewriting <base href>, because changing the document base to a proxy URL corrupts
    // relative routing/public-path calculations. Rewrite only concrete load/navigation elements.
    let rewritten = html.replace(/<(script|link|img|source|video|audio|form|a)\b[^>]*>/gi, tag => {
        const tagName = /^<([a-z0-9]+)/i.exec(tag)?.[1] || '';
        const fallbacks: Array<{ attr: string; url: string }> = [];
        let out = tag.replace(/\b(src|href|action|poster)=(["'])([^"']+)\2/gi, (match, attr, quote, val) => {
            if (attr.toLowerCase() === 'href' && (val.startsWith('#') || val.startsWith('javascript:') || val.startsWith('mailto:') || val.startsWith('tel:'))) {
                return match;
            }

            // Scripts keep the exact authenticated proxy/patching path on their first
            // load, but versioned static bundles use a session-independent browser cache
            // key. Non-static scripts deliberately stay on the old per-session route.
            if (tagName.toLowerCase() === 'script' && attr.toLowerCase() === 'src') {
                const stableScript = toStableScriptUrl(val);
                if (stableScript) return `${attr}=${quote}${escapeHtmlAttribute(stableScript)}${quote}`;
            }

            const resolved = directWithFallback(tagName, attr, tag, val);
            if (resolved.fallback) fallbacks.push({ attr: attr.toLowerCase(), url: resolved.fallback });
            return `${attr}=${quote}${escapeHtmlAttribute(resolved.url)}${quote}`;
        });

        // Attach an authenticated fallback. Static image fallbacks use a stable URL
        // that the browser may privately reuse across later launches; non-static
        // resources retain the exact old session-specific proxy URL.
        if (fallbacks.length && !/\bdata-nso-proxy-fallback=/i.test(out)) {
            const fallback = fallbacks[0];
            const attrs = ` data-nso-proxy-fallback="${escapeHtmlAttribute(fallback.url)}" data-nso-proxy-attr="${fallback.attr}"`;
            out = out.replace(/\s*\/?>(?=$)/, match => `${attrs}${match}`);
        }
        if (fallbacks.length && !/\bcrossorigin\s*=/i.test(out)) {
            out = out.replace(/\s*\/?>(?=$)/, match => ` crossorigin="anonymous"${match}`);
        }

        // Zelda Notes' pages are small, and Edge logs an Intervention when the
        // app's explicit lazy images defer load events. Keep this scoped to Zelda.
        if (isZelda && /^<img\b/i.test(out)) {
            out = out.replace(/\sloading=(["'])lazy\1/gi, (_match, quote) => ` loading=${quote}eager${quote}`);
        }

        return out;
    });

    // Resource-error events do not bubble, so use a capture listener. It retries a
    // failed direct Nintendo image/icon exactly once through an authenticated Worker
    // route. Successful CORS-safe direct loads never touch Cloudflare at all.
    const staticFallbackScript = directResourceCount > 0 ? `<script id="nso-static-resource-fallback">
(()=>{
    window.addEventListener('error', event => {
        const element = event && event.target;
        if (!element || !element.dataset) return;
        const fallback = element.dataset.nsoProxyFallback;
        const attr = element.dataset.nsoProxyAttr;
        if (!fallback || !attr || element.dataset.nsoProxyRetried === '1') return;
        element.dataset.nsoProxyRetried = '1';
        try {
            if (attr === 'href') element.href = fallback;
            else element.src = fallback;
        } catch(e) {}
    }, true);
})();
</script>` : '';

    const earlyScripts = `${staticFallbackScript}${smashCompatScript}`;
    if (earlyScripts) {
        if (/<head[^>]*>/i.test(rewritten)) {
            rewritten = rewritten.replace(/<head[^>]*>/i, match => `${match}\n${earlyScripts}`);
        } else {
            rewritten = `${earlyScripts}\n${rewritten}`;
        }
    }

    return rewritten;
}
