/**
 * Stateless Game Service Session Initializer & Reverse Proxy.
 *
 * Runs 100% in-memory at the Cloudflare edge PoP with zero Durable Object dependency.
 * Sessions and cookie jars are encrypted into authenticated AES-256-GCM cookies.
 */
import { Env } from '../types/env';
import {
    isStrictNintendoOrigin,
    classifyProxyTarget,
    SERVICE_QUIRKS,
    isZeldaNotesService,
    isSplatNet3Service,
    isSmashWorldService,
    isSplatNet2Service,
    isNookLinkService,
    SPLATNET3_RESOURCE_ORIGINS,
    NOOKLINK_WEB_API_ORIGIN,
    NOOKLINK_API_PATH,
    isServiceResourceOriginAllowed,
    isOriginWhitelisted,
    resolveAllowedOrigins
} from './service-policy';
import { lookupSplatNet3OperationName } from './splatnet3-queries';
import { CookieJar } from '../cookies/cookie-jar';
import { rewriteHtmlAssets } from '../webview/rewrite-html-assets';
import { generateBridgeSnippet } from '../webview/generate-bridge-snippet';
import {
    SealedGameSessionPayload,
    sealGameSessionCookie
} from '../http/request-cookies';

function browserCacheControl(request: Request, targetUrl: URL, upstream: Response, hasSetCookie: boolean): string {
    const method = request.method.toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return 'no-store';
    if (upstream.status !== 200 || hasSetCookie) return 'no-store';

    const path = targetUrl.pathname.toLowerCase();
    const contentType = (upstream.headers.get('Content-Type') || '').toLowerCase();

    // Documents and API/data responses stay dynamic by default.
    if (/text\/html|application\/xhtml\+xml/.test(contentType)) return 'no-store';

    // Content-hashed assets are safe to retain aggressively in the user's private cache.
    if (
        path.startsWith('/_next/static/') ||
        /[-.][a-f0-9]{8,}\.(?:js|mjs|css|woff2?|png|jpe?g|webp|avif|svg)$/i.test(path)
    ) {
        return 'private, max-age=604800, immutable';
    }

    // Images, fonts and media are reusable but may keep stable filenames, so avoid immutable.
    if (
        contentType.startsWith('image/') ||
        contentType.startsWith('font/') ||
        contentType.startsWith('audio/') ||
        contentType.startsWith('video/') ||
        /\.(?:png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp3|m4a|mp4|webm)$/i.test(path)
    ) {
        return 'private, max-age=86400';
    }

    // Ordinary JS/CSS bundles can be reused for a day.
    if (
        /javascript|ecmascript|text\/css/.test(contentType) ||
        /\.(?:js|mjs|css)$/i.test(path)
    ) {
        return 'private, max-age=86400';
    }

    // Locale files are static in practice, but keep a short TTL.
    if (
        contentType.includes('application/json') &&
        (path.includes('/locales/') || path.startsWith('/common/locales/'))
    ) {
        return 'private, max-age=3600';
    }

    return 'no-store';
}

export interface InitGameSessionParams {
    sessionId: string;
    serviceId: string | number;
    serviceUri?: string;
    whiteList?: string[];
    token: string;
    language?: string;
    country?: string;
}

export interface InitGameSessionResult {
    sessionId: string;
    expiresAt: number;
    initialWebviewUrl: string;
    initialPath: string;
    sealedCookie: string;
}

export async function initStatelessGameSession(
    params: InitGameSessionParams,
    env: Env
): Promise<InitGameSessionResult> {
    const serviceId = String(params.serviceId);
    const resolved = resolveAllowedOrigins(serviceId, params.serviceUri, params.whiteList);
    const language = params.language || 'en-US';
    const country = params.country || 'US';
    const expiresAt = Date.now() + 2 * 60 * 60 * 1000; // 2 hours
    const quirk = SERVICE_QUIRKS[serviceId];

    const cookieJar = new CookieJar();
    const initialTarget = new URL(resolved.initialUri);

    if (!initialTarget.searchParams.has('lang')) initialTarget.searchParams.set('lang', language);
    if (!initialTarget.searchParams.has('na_country')) initialTarget.searchParams.set('na_country', country);
    if (!initialTarget.searchParams.has('na_lang')) initialTarget.searchParams.set('na_lang', language);

    const appVersion = env.CORAL_VERSION || '3.4.1';
    const webviewUa = `Mozilla/5.0 (Linux; Android 10; Build/QP1A.190711.020; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/80.0.3987.162 Mobile Safari/537.36 com.nintendo.znca/${appVersion}`;

    let canonicalStartUrl = initialTarget;
    const isSmash = isSmashWorldService(serviceId, params.serviceUri);
    const isNookLinkServiceLaunch = isNookLinkService(serviceId, params.serviceUri);
    const isSplatNet2ServiceLaunch = isSplatNet2Service(serviceId, params.serviceUri);
    const nxapiWebServiceUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.3 Mobile/15E148 Safari/604.1';
    const effectiveBootstrapUa = (isSmash || isNookLinkServiceLaunch) ? nxapiWebServiceUa : webviewUa;

    const useBrowserBootstrap = isNookLinkServiceLaunch || isSmash || isSplatNet2ServiceLaunch;
    if (!useBrowserBootstrap) {
        try {
            const bootstrapResp = await fetch(canonicalStartUrl.toString(), {
                method: 'GET',
                headers: {
                    'x-gamewebtoken': params.token,
                    'x-appplatform': 'android',
                    'x-appcolorscheme': 'DARK',
                    'X-Requested-With': 'com.nintendo.znca',
                    'Accept-Language': language,
                    'User-Agent': effectiveBootstrapUa,
                    'Upgrade-Insecure-Requests': '1',
                    'dnt': '1',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
                },
                redirect: 'manual'
            });

            cookieJar.setCookiesFromResponse(bootstrapResp.headers, canonicalStartUrl);
            const isZelda = isZeldaNotesService(serviceId, params.serviceUri);
            const isSplatNet2 = isSplatNet2Service(serviceId, params.serviceUri);

            if (isSplatNet2) {
                canonicalStartUrl = new URL('/home' + canonicalStartUrl.search, canonicalStartUrl.origin);
            } else if (isZelda) {
                canonicalStartUrl = new URL('/title-select' + canonicalStartUrl.search, canonicalStartUrl.origin);
            } else {
                const bootLocation = bootstrapResp.headers.get('Location');
                const shouldPreserveExact = quirk?.preserveExactInitialUri === true;
                if (bootLocation && [301, 302, 303, 307, 308].includes(bootstrapResp.status) && !shouldPreserveExact) {
                    const redirectedUrl = new URL(bootLocation, canonicalStartUrl);
                    if (isOriginWhitelisted(redirectedUrl.origin, Array.from(resolved.allowedOrigins)) && isStrictNintendoOrigin(redirectedUrl.origin)) {
                        canonicalStartUrl = redirectedUrl;
                    }
                }
            }

            if (bootstrapResp.body) {
                try { await bootstrapResp.body.cancel(); } catch { }
            }
        } catch (e: any) {
            console.warn('[StatelessGameProxy] Initial bootstrap request warning:', e?.message || e);
        }
    }

    const sessionPayload: SealedGameSessionPayload = {
        v: 1,
        sessionId: params.sessionId,
        serviceId,
        serviceOrigin: resolved.primaryOrigin,
        serviceUri: resolved.initialUri,
        allowedOrigins: Array.from(resolved.allowedOrigins),
        gameWebToken: params.token,
        cookies: cookieJar.toJSON(),
        locale: { language, country },
        createdAt: Date.now(),
        expiresAt
    };

    const sealedCookie = await sealGameSessionCookie(sessionPayload, env);
    const initialWebviewUrl = `/api/nso/webview/${params.sessionId}/proxy?url=${encodeURIComponent(canonicalStartUrl.toString())}`;
    const initialPath = canonicalStartUrl.pathname + canonicalStartUrl.search + canonicalStartUrl.hash;

    return {
        sessionId: params.sessionId,
        expiresAt,
        initialWebviewUrl,
        initialPath,
        sealedCookie
    };
}

export interface ProxyStatelessGameResult {
    response: Response;
    updatedSession?: SealedGameSessionPayload;
}

export async function proxyStatelessGameRequest(
    request: Request,
    session: SealedGameSessionPayload,
    explicitUrl?: string,
    subPath?: string,
    env?: Env
): Promise<ProxyStatelessGameResult> {
    const isNookLinkProxySession = isNookLinkService(session.serviceId, session.serviceUri);
    let targetUrl: URL;
    if (explicitUrl) {
        try {
            targetUrl = new URL(explicitUrl);
        } catch {
            return { response: new Response('Invalid proxy target URL parameter.', { status: 400 }) };
        }
    } else if (!subPath || subPath === '/') {
        targetUrl = new URL(session.serviceOrigin);
    } else {
        const shouldUseNookLinkWebApi = isNookLinkProxySession && NOOKLINK_API_PATH.test(subPath);
        targetUrl = new URL(subPath, shouldUseNookLinkWebApi ? NOOKLINK_WEB_API_ORIGIN : session.serviceOrigin);
    }

    const fetchDest = (request.headers.get('Sec-Fetch-Dest') || '').toLowerCase();
    const isAllowedOrigin = isServiceResourceOriginAllowed(
        session.serviceId,
        session.serviceUri,
        targetUrl.origin,
        session.allowedOrigins,
        request.method,
        fetchDest
    );
    if (!isAllowedOrigin) {
        console.warn('[StatelessGameProxy:Blocked Origin]', {
            serviceId: session.serviceId,
            targetOrigin: targetUrl.origin,
            allowedOrigins: session.allowedOrigins
        });
        return { response: new Response('Destination origin is not allowed for this game session.', { status: 403 }) };
    }

    const isZelda = isZeldaNotesService(session.serviceId, session.serviceUri);
    const isSplatNet3 = isSplatNet3Service(session.serviceId, session.serviceUri);
    const isSplatNet2 = isSplatNet2Service(session.serviceId, session.serviceUri);
    const isSmash = isSmashWorldService(session.serviceId, session.serviceUri);
    const isNookLink = isNookLinkService(session.serviceId, session.serviceUri);

    if (isZelda && (targetUrl.pathname === '/' || targetUrl.pathname === '')) {
        const selectorUrl = new URL('/title-select' + targetUrl.search, targetUrl.origin);
        const proxiedLocation = `/api/nso/webview/${session.sessionId}/proxy?url=${encodeURIComponent(selectorUrl.toString())}`;
        return {
            response: new Response(null, {
                status: 302,
                headers: {
                    'Location': proxiedLocation,
                    'Cache-Control': 'no-store'
                }
            })
        };
    }

    const cookieJar = CookieJar.fromJSON(session.cookies || []);
    const isStaticAsset = targetUrl.pathname.startsWith('/_next/static/') ||
        targetUrl.pathname.startsWith('/_next/image') ||
        /\.(?:js|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|mp4|webm)$/i.test(targetUrl.pathname);

    const appVersion = env?.CORAL_VERSION || '3.4.1';
    const defaultUa = `Mozilla/5.0 (Linux; Android 10; Build/QP1A.190711.020; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/80.0.3987.162 Mobile Safari/537.36 com.nintendo.znca/${appVersion}`;

    const headers = new Headers();
    for (const [name, val] of request.headers) {
        const lower = name.toLowerCase();
        if (['host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor', 'x-nso-internal-session-auth'].includes(lower)) continue;
        headers.set(name, val);
    }

    if (isSmash || isNookLink) {
        const nxapiWebServiceUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.3 Mobile/15E148 Safari/604.1';
        headers.set('User-Agent', nxapiWebServiceUa);

        const clientHints = [
            'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'sec-ch-ua-platform-version',
            'sec-ch-ua-arch', 'sec-ch-ua-bitness', 'sec-ch-ua-full-version', 'sec-ch-ua-full-version-list',
            'sec-ch-ua-model', 'sec-ch-ua-wow64'
        ];
        for (const ch of clientHints) headers.delete(ch);

        if (isNookLink) {
            headers.delete('If-None-Match');
            headers.delete('If-Modified-Since');
        }
    }

    const cookies = cookieJar.getCookieHeader(targetUrl);
    headers.delete('Cookie');
    if (cookies) headers.set('Cookie', cookies);

    let isInitialNookLinkDocument = false;
    const hasSmashSessionBefore = isSmash && cookieJar.getCookies().some(c => c.name === 'super_smash_session' || c.name.includes('session'));
    const isInitialSmashDocument = Boolean(
        isSmash &&
        request.method === 'GET' &&
        targetUrl.origin === session.serviceOrigin &&
        (targetUrl.pathname === '/' || targetUrl.pathname === '') &&
        !hasSmashSessionBefore
    );
    const hasIksmSessionBefore = isSplatNet2 && cookieJar.getCookies().some(c => c.name === 'iksm_session');
    const isInitialSplatNet2Document = Boolean(
        isSplatNet2 &&
        request.method === 'GET' &&
        targetUrl.origin === session.serviceOrigin &&
        (targetUrl.pathname === '/' || targetUrl.pathname === '') &&
        !hasIksmSessionBefore
    );

    const clientGameWebToken = request.headers.get('X-GameWebToken') || request.headers.get('x-gamewebtoken');
    if (clientGameWebToken) {
        headers.set('X-GameWebToken', clientGameWebToken);
        headers.set('x-gamewebtoken', clientGameWebToken);
    } else if (isSplatNet3) {
        if (targetUrl.pathname === '/api/bullet_tokens' || targetUrl.pathname === '/api/primer_tokens') {
            if (session.gameWebToken) {
                headers.set('X-GameWebToken', session.gameWebToken);
                headers.set('x-gamewebtoken', session.gameWebToken);
            }
        }
    } else if (isZelda) {
        const hasZeldaSession = cookieJar.getCookies().some(c => c.name === 'a5_token' || c.name.includes('session'));
        if (!hasZeldaSession && !isStaticAsset && session.gameWebToken) {
            headers.set('X-GameWebToken', session.gameWebToken);
            headers.set('x-gamewebtoken', session.gameWebToken);
        }
    } else if (isSmash) {
        const hasSmashSession = cookieJar.getCookies().some(c => c.name === 'super_smash_session' || c.name.includes('session'));
        if (!hasSmashSession && !isStaticAsset && session.gameWebToken) {
            headers.set('X-GameWebToken', session.gameWebToken);
            headers.set('x-gamewebtoken', session.gameWebToken);
        }
        if (isInitialSmashDocument) {
            headers.set('x-appplatform', 'android');
            headers.set('x-appcolorscheme', 'DARK');
            headers.set('X-Requested-With', 'com.nintendo.znca');
            headers.set('Upgrade-Insecure-Requests', '1');
            headers.set('dnt', '1');
            headers.set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8');
            if (session.locale?.language) headers.set('Accept-Language', session.locale.language);
            for (const h of ['sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-user', 'priority']) {
                headers.delete(h);
            }
        }
    } else if (isNookLink) {
        const hasGToken = cookieJar.getCookies().some(c => c.name === '_gtoken');
        isInitialNookLinkDocument = request.method === 'GET' &&
            targetUrl.origin === session.serviceOrigin &&
            !targetUrl.pathname.startsWith('/api/') &&
            !hasGToken;

        if (isInitialNookLinkDocument && session.gameWebToken) {
            headers.delete('Cookie');
            headers.set('X-GameWebToken', session.gameWebToken);
            headers.set('x-gamewebtoken', session.gameWebToken);
            headers.set('x-appplatform', 'android');
            headers.set('x-appcolorscheme', 'DARK');
            headers.set('X-Requested-With', 'com.nintendo.znca');
            headers.set('dnt', '0');
            headers.set('x-isappanalyticsoptedin', 'false');
            if (session.locale?.language) headers.set('Accept-Language', session.locale.language);
        } else {
            headers.delete('X-GameWebToken');
            headers.delete('x-gamewebtoken');
        }
    } else {
        if (!isStaticAsset && session.gameWebToken) {
            headers.set('X-GameWebToken', session.gameWebToken);
            headers.set('x-gamewebtoken', session.gameWebToken);
        }
    }

    if (!isStaticAsset) {
        if (!headers.has('x-appplatform')) headers.set('x-appplatform', 'android');
        if (!headers.has('x-appcolorscheme')) headers.set('x-appcolorscheme', 'DARK');
        if (!headers.has('X-NACountry') && session.locale?.country) {
            headers.set('X-NACountry', session.locale.country);
        }
        if (!headers.has('Accept-Language') && session.locale?.language) {
            headers.set('Accept-Language', session.locale.language);
        }
        if (!headers.has('X-Requested-With')) {
            headers.set('X-Requested-With', 'com.nintendo.znca');
        }
    }

    if (!headers.has('User-Agent')) headers.set('User-Agent', defaultUa);

    if (isSmash || isNookLink) {
        const incomingOrigin = request.headers.get('Origin');
        if (incomingOrigin) headers.set('Origin', session.serviceOrigin);
        else headers.delete('Origin');

        const incomingReferer = request.headers.get('Referer');
        if (incomingReferer) headers.set('Referer', `${session.serviceOrigin}/`);
        else headers.delete('Referer');

        if (isInitialSmashDocument) {
            headers.delete('Origin');
            headers.delete('Referer');
        }
    } else if (isSplatNet3 && SPLATNET3_RESOURCE_ORIGINS.has(targetUrl.origin)) {
        headers.set('Origin', session.serviceOrigin);
        headers.set('Referer', `${session.serviceOrigin}/`);
    } else {
        headers.set('Origin', targetUrl.origin);
        headers.set('Referer', `${targetUrl.origin}/`);
    }

    let requestBodyBytes: Uint8Array | undefined = undefined;
    let splatnetGraphQlOp = 'unknown';
    let splatnetGraphQlHashPrefix = 'unknown';

    if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
        const rawBodyBuffer = await request.arrayBuffer();
        requestBodyBytes = new Uint8Array(rawBodyBuffer);

        if (isSplatNet3 && targetUrl.pathname === '/api/graphql') {
            try {
                const parsedJson = JSON.parse(new TextDecoder().decode(requestBodyBytes));
                const sha256Hash = parsedJson?.extensions?.persistedQuery?.sha256Hash;
                if (sha256Hash && typeof sha256Hash === 'string') {
                    splatnetGraphQlHashPrefix = sha256Hash.slice(0, 8);
                    splatnetGraphQlOp = lookupSplatNet3OperationName(sha256Hash);
                }
            } catch { }
        }
    }

    let upstream: Response;
    try {
        upstream = await fetch(targetUrl.toString(), {
            method: request.method,
            headers,
            body: ['GET', 'HEAD'].includes(request.method) ? undefined : requestBodyBytes,
            redirect: 'manual'
        });
    } catch (fetchErr: any) {
        console.warn('[StatelessGameProxy:FetchError]', {
            serviceId: session.serviceId,
            path: targetUrl.pathname,
            error: fetchErr?.message || fetchErr
        });
        return {
            response: new Response(JSON.stringify({ error: 'Upstream fetch failure', details: fetchErr?.message }), {
                status: 502,
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-store',
                    'X-NSO-Proxy-Error': 'upstream_fetch_exception'
                }
            })
        };
    }

    let updatedSession: SealedGameSessionPayload | undefined = undefined;
    const cookiesChanged = cookieJar.setCookiesFromResponse(upstream.headers, targetUrl);
    if (cookiesChanged) {
        session.cookies = cookieJar.toJSON();
        updatedSession = session;
    }

    if (isSplatNet3 && targetUrl.pathname === '/api/graphql') {
        try {
            const respText = await upstream.text();
            let respJson: any = null;
            try { respJson = JSON.parse(respText); } catch { }
            const errorsArr = Array.isArray(respJson?.errors) ? respJson.errors : [];
            for (const err of errorsArr) {
                const msg = String(err?.message || '');
                if (msg.includes('PersistedQuery') || msg.includes('persisted query') || msg.includes('not found') || msg.includes('not supported')) {
                    console.warn('[SplatNet3:PersistedQueryMismatch]', {
                        operation: splatnetGraphQlOp,
                        hash: splatnetGraphQlHashPrefix,
                        message: msg
                    });
                }
            }

            const responseHeaders = new Headers();
            for (const [name, value] of upstream.headers) {
                const lower = name.toLowerCase();
                if ([
                    'content-length', 'content-encoding', 'transfer-encoding', 'set-cookie',
                    'content-security-policy', 'content-security-policy-report-only', 'x-frame-options'
                ].includes(lower)) continue;
                responseHeaders.append(name, value);
            }
            responseHeaders.set('Cache-Control', 'no-store');

            return { response: new Response(respText, { status: upstream.status, headers: responseHeaders }), updatedSession };
        } catch (err: any) {
            return {
                response: new Response(JSON.stringify({ error: 'Upstream response read failure' }), {
                    status: 502,
                    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
                })
            };
        }
    }

    if (isInitialSplatNet2Document) {
        const hasIksmSessionAfter = cookieJar.getCookies().some(c => c.name === 'iksm_session');
        const upstreamHasRedirect = Boolean(upstream.headers.get('Location')) && [301, 302, 303, 307, 308].includes(upstream.status);
        if (hasIksmSessionAfter && !upstreamHasRedirect) {
            const homeUrl = new URL('/home' + targetUrl.search, targetUrl.origin);
            const proxiedHome = `/api/nso/webview/${session.sessionId}/proxy?url=${encodeURIComponent(homeUrl.toString())}`;
            try { if (upstream.body) await upstream.body.cancel(); } catch { }
            return {
                response: new Response(null, {
                    status: 302,
                    headers: {
                        'Location': proxiedHome,
                        'Cache-Control': 'no-store'
                    }
                }),
                updatedSession
            };
        }
    }

    const responseHeaders = new Headers();
    for (const [name, value] of upstream.headers) {
        const lower = name.toLowerCase();
        if ([
            'content-length', 'content-encoding', 'transfer-encoding', 'set-cookie',
            'content-security-policy', 'content-security-policy-report-only', 'x-frame-options'
        ].includes(lower)) continue;
        responseHeaders.append(name, value);
    }

    const rawSetCookies = (upstream.headers as any).getSetCookie ? (upstream.headers as any).getSetCookie() : [];
    if (Array.isArray(rawSetCookies) && rawSetCookies.length > 0) {
        for (const sc of rawSetCookies) {
            const cleaned = sc.replace(/Domain=[^;]+;?/gi, '')
                              .replace(/SameSite=[^;]+;?/gi, '')
                              .replace(/Secure;?/gi, '')
                              .replace(/;+/g, ';')
                              .trim();
            const browserCookie = `${cleaned}; Secure; SameSite=None; Partitioned; Path=/`;
            responseHeaders.append('Set-Cookie', browserCookie);
        }
    }

    const location = upstream.headers.get('Location');
    if (location) {
        try {
            const redirectTarget = new URL(location, targetUrl);
            const redirectAllowed = isServiceResourceOriginAllowed(
                session.serviceId,
                session.serviceUri,
                redirectTarget.origin,
                session.allowedOrigins,
                request.method,
                fetchDest
            ) && isStrictNintendoOrigin(redirectTarget.origin);

            if (redirectAllowed) {
                const proxiedLocation = `/api/nso/webview/${session.sessionId}/proxy?url=${encodeURIComponent(redirectTarget.toString())}`;
                responseHeaders.set('Location', proxiedLocation);
            } else {
                responseHeaders.delete('Location');
            }
        } catch {
            responseHeaders.delete('Location');
        }
    }

    const contentType = upstream.headers.get('Content-Type') || '';
    const isHtml = /text\/html|application\/xhtml\+xml/i.test(contentType);
    const isJs = /javascript|ecmascript|x-javascript/i.test(contentType) || targetUrl.pathname.endsWith('.js');

    responseHeaders.set(
        'Cache-Control',
        browserCacheControl(request, targetUrl, upstream, Array.isArray(rawSetCookies) && rawSetCookies.length > 0)
    );

    if (request.method === 'HEAD' || upstream.status === 204 || upstream.status === 304) {
        return { response: new Response(upstream.body, { status: upstream.status, headers: responseHeaders }), updatedSession };
    }

    // Zelda Notes Next.js hydration patches
    if (isZelda && isJs && (targetUrl.pathname.includes('/_next/static/chunks/') || targetUrl.pathname.endsWith('.js'))) {
        let jsText = await upstream.text();
        const targetCreateContext = 'let u=(0,r.createContext)(void 0),p=(0,r.createContext)(void 0);';
        if (jsText.includes(targetCreateContext)) {
            jsText = jsText.replace(
                targetCreateContext,
                'let _dUS={initialUserSettingsPromise:Promise.resolve({}),updatedUserSettings:{},updateUserSettings:()=>()=>Promise.resolve()};let u=(0,r.createContext)(_dUS),p=(0,r.createContext)(_dUS);'
            );
        }
        const targetFunctionH = 'function h(e){let{initialUserSettingsPromise:t,updatedUserSettings:l,updateUserSettings:i}=function(){let{titleInfo:e}=(0,o.D)();switch(e.id){case a.vI.id:return(0,r.use)(u);case a.Tb.id:return(0,r.use)(p);default:throw Error(e)}}(),s=(0,r.use)(t);return{userSettings:(0,n.A)({},s,l)[e],updateUserSettings:i(e)}}';
        if (jsText.includes(targetFunctionH)) {
            jsText = jsText.replace(
                targetFunctionH,
                'function h(e){let ctx=function(){try{let{titleInfo:e}=(0,o.D)();switch(e.id){case a.vI.id:return(0,r.use)(u)||(0,r.use)(p);case a.Tb.id:return(0,r.use)(p)||(0,r.use)(u);default:return(0,r.use)(u)||(0,r.use)(p)}}catch(_){}}()||{initialUserSettingsPromise:Promise.resolve({}),updatedUserSettings:{},updateUserSettings:()=>()=>Promise.resolve()};let{initialUserSettingsPromise:t,updatedUserSettings:l,updateUserSettings:i}=ctx,s;try{s=t?(0,r.use)(t):{}}catch(_){s={}}return{userSettings:(0,n.A)({},s,l)[e]||{},updateUserSettings:typeof i==="function"?i(e):(()=>Promise.resolve())}}'
            );
        }
        if (/=\(0,([a-zA-Z0-9_$]+)\.useState\)\(([a-zA-Z0-9_$]+)\.Tb\)/g.test(jsText)) {
            jsText = jsText.replace(
                /=\(0,([a-zA-Z0-9_$]+)\.useState\)\(([a-zA-Z0-9_$]+)\.Tb\)/g,
                '=(0,$1.useState)(()=>((typeof location!=="undefined"&&location.pathname.toLowerCase().includes("botw"))?$2.vI:$2.Tb))'
            );
        }
        if (/switch\(([a-zA-Z0-9_$]+)\.id\)\{case ([a-zA-Z0-9_$]+)\.vI\.id:return\(0,([a-zA-Z0-9_$]+)\.use\)\(([a-zA-Z0-9_$]+)\);case \2\.Tb\.id:return\(0,\3\.use\)\(([a-zA-Z0-9_$]+)\);default:throw Error\(\1\)\}/g.test(jsText)) {
            jsText = jsText.replace(
                /switch\(([a-zA-Z0-9_$]+)\.id\)\{case ([a-zA-Z0-9_$]+)\.vI\.id:return\(0,([a-zA-Z0-9_$]+)\.use\)\(([a-zA-Z0-9_$]+)\);case \2\.Tb\.id:return\(0,\3\.use\)\(([a-zA-Z0-9_$]+)\);default:throw Error\(\1\)\}/g,
                'switch($1.id){case $2.vI.id:return(0,$3.use)($4)||(0,$3.use)($5)||{initialUserSettingsPromise:Promise.resolve({}),updatedUserSettings:{},updateUserSettings:()=>()=>Promise.resolve()};case $2.Tb.id:return(0,$3.use)($5)||(0,$3.use)($4)||{initialUserSettingsPromise:Promise.resolve({}),updatedUserSettings:{},updateUserSettings:()=>()=>Promise.resolve()};default:throw Error($1)}'
            );
        }
        return { response: new Response(jsText, { status: upstream.status, headers: responseHeaders }), updatedSession };
    }

    if (isNookLink && isJs) {
        let jsText = await upstream.text();
        let replacements = 0;
        if (jsText.includes(NOOKLINK_WEB_API_ORIGIN)) {
            replacements = jsText.split(NOOKLINK_WEB_API_ORIGIN).length - 1;
            jsText = jsText.split(NOOKLINK_WEB_API_ORIGIN).join('');
        }
        if (replacements > 0) {
            responseHeaders.delete('ETag');
            responseHeaders.delete('Last-Modified');
        }
        return { response: new Response(jsText, { status: upstream.status, headers: responseHeaders }), updatedSession };
    }

    if (!isHtml) {
        return { response: new Response(upstream.body, { status: upstream.status, headers: responseHeaders }), updatedSession };
    }

    let htmlText = await upstream.text();
    if (isNookLink && htmlText.includes(NOOKLINK_WEB_API_ORIGIN)) {
        htmlText = htmlText.split(NOOKLINK_WEB_API_ORIGIN).join('');
        responseHeaders.delete('ETag');
        responseHeaders.delete('Last-Modified');
    }

    htmlText = rewriteHtmlAssets(
        htmlText,
        session.sessionId,
        session.serviceId,
        session.serviceUri,
        targetUrl.toString(),
        session.allowedOrigins
    );

    const bridgeInjection = generateBridgeSnippet(
        session.sessionId,
        session.serviceId,
        targetUrl.toString(),
        session.allowedOrigins
    );

    if (/<head[^>]*>/i.test(htmlText)) {
        htmlText = htmlText.replace(/<head[^>]*>/i, match => `${match}\n${bridgeInjection}`);
    } else {
        htmlText = `${bridgeInjection}\n${htmlText}`;
    }

    return { response: new Response(htmlText, { status: upstream.status, headers: responseHeaders }), updatedSession };
}
