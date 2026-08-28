/**
 * Game Service WebView Session Handlers.
 */
import { resolveAllowedOrigins, isNookLinkService, isZeldaNotesService, isSplatNet2Service } from '../services/service-policy';
import { updateGameSessionDnrRules, clearGameSessionDnrRules } from '../dnr/dnr-manager';
import { CookieJar } from '../proxy/cookie-jar';

const ZELDA_DOMAIN = 'api.lp1.87abc152.srv.nintendo.net';
const ZELDA_DOT_DOMAIN = '.api.lp1.87abc152.srv.nintendo.net';

/**
 * Generates a random browser-fingerprint-like alphanumeric string.
 */
function generateBrowserFingerprint(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    const arr = new Uint8Array(19);
    crypto.getRandomValues(arr);
    for (let i = 0; i < arr.length; i++) {
        result += chars[arr[i] % chars.length];
    }
    return result;
}

/**
 * Injects cookies captured from a background prewarm response into Chrome's cookie store
 * with SameSite: no_restriction so they are attached on cross-site iframe requests.
 */
async function injectJarCookies(
    jar: CookieJar,
    baseUrl: string,
    hostDomain: string
): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.cookies) return;

    const twoYearsFromNow = Math.floor(Date.now() / 1000) + 2 * 365 * 24 * 60 * 60;
    const dotDomain = '.' + hostDomain;

    const bootstrapCookies = jar.getCookies();
    for (const cookie of bootstrapCookies) {
        const domain = cookie.hostOnly ? hostDomain : dotDomain;
        const expiry = cookie.expires
            ? Math.floor(cookie.expires / 1000)
            : twoYearsFromNow;

        try {
            await chrome.cookies.set({
                url: baseUrl,
                name: cookie.name,
                value: cookie.value,
                domain: domain,
                path: cookie.path || '/',
                secure: true,
                sameSite: 'no_restriction',
                httpOnly: cookie.httpOnly,
                expirationDate: expiry
            });
        } catch (_) {}

        try {
            const altDomain = domain === hostDomain ? dotDomain : hostDomain;
            await chrome.cookies.set({
                url: baseUrl,
                name: cookie.name,
                value: cookie.value,
                domain: altDomain,
                path: cookie.path || '/',
                secure: true,
                sameSite: 'no_restriction',
                httpOnly: cookie.httpOnly,
                expirationDate: expiry
            });
        } catch (_) {}
    }
}

/**
 * Injects Zelda Notes auth cookies directly into the browser's cookie store
 * via chrome.cookies.set().
 */
async function injectZeldaCookies(
    jar: CookieJar,
    targetUrl: URL,
    language: string,
    country: string
): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.cookies) return;

    const twoYearsFromNow = Math.floor(Date.now() / 1000) + 2 * 365 * 24 * 60 * 60;
    const baseUrl = `https://${ZELDA_DOMAIN}/`;

    // Helper to set a single cookie with correct cross-site attributes
    async function setCookie(
        name: string,
        value: string,
        domain: string,
        httpOnly: boolean = false,
        expirationDate?: number
    ): Promise<void> {
        try {
            await chrome.cookies.set({
                url: baseUrl,
                name,
                value,
                domain,
                path: '/',
                secure: true,
                sameSite: 'no_restriction',
                httpOnly,
                expirationDate: expirationDate || twoYearsFromNow
            });
        } catch (_) {}
    }

    // 1. Inject all cookies captured from the Nintendo bootstrap response
    const bootstrapCookies = jar.getCookies();
    for (const cookie of bootstrapCookies) {
        const domain = cookie.hostOnly ? ZELDA_DOMAIN : ZELDA_DOT_DOMAIN;
        const expiry = cookie.expires
            ? Math.floor(cookie.expires / 1000)
            : twoYearsFromNow;
        await setCookie(cookie.name, cookie.value, domain, cookie.httpOnly, expiry);

        if (cookie.name === 'a5_token' || cookie.name === 'na_country' || cookie.name === 'lang') {
            const altDomain = domain === ZELDA_DOMAIN ? ZELDA_DOT_DOMAIN : ZELDA_DOMAIN;
            await setCookie(cookie.name, cookie.value, altDomain, cookie.httpOnly, expiry);
        }
    }

    // 2. Inject supplemental cookies that tell Zelda Notes it's running in the mobile app context
    const supplementalCookies: Array<{ name: string; value: string; domain: string; httpOnly: boolean }> = [
        { name: 'appplatform', value: 'android', domain: ZELDA_DOMAIN, httpOnly: true },
        { name: 'na_country', value: country, domain: ZELDA_DOMAIN, httpOnly: true },
        { name: 'na_country', value: country, domain: ZELDA_DOT_DOMAIN, httpOnly: true },
        { name: 'lang', value: language, domain: ZELDA_DOMAIN, httpOnly: true },
        { name: 'lang', value: language, domain: ZELDA_DOT_DOMAIN, httpOnly: true },
        { name: 'browser_fingerprint', value: generateBrowserFingerprint(), domain: ZELDA_DOMAIN, httpOnly: false }
    ];

    const existingNames = new Set(bootstrapCookies.map(c => c.name));
    for (const sc of supplementalCookies) {
        const isAltDomain = sc.domain === ZELDA_DOT_DOMAIN;
        if (!existingNames.has(sc.name) || isAltDomain) {
            await setCookie(sc.name, sc.value, sc.domain, sc.httpOnly);
        }
    }
}

export async function handleGameSessionCreate(body: {
    serviceId?: string | number;
    serviceUri?: string;
    whiteList?: string[];
    token?: string;
    language?: string;
    country?: string;
    launchId?: string;
}): Promise<{ status: number; data: any }> {
    if (!body.serviceId || !body.token || typeof body.token !== 'string' || body.token.length > 8192) {
        return { status: 400, data: { error: 'Invalid game service parameters' } };
    }

    const serviceId = String(body.serviceId);
    let resolved;
    try {
        resolved = resolveAllowedOrigins(serviceId, body.serviceUri, body.whiteList);
    } catch (error: any) {
        return { status: 403, data: { error: error?.message || 'Disallowed game service destination' } };
    }

    const language = body.language || 'en-US';
    const country = body.country || 'US';
    const expiresAt = Date.now() + 2 * 60 * 60 * 1000; // 2 hours
    const sessionId = (typeof body.launchId === 'string' && /^[a-f0-9-]{36}$/i.test(body.launchId))
        ? body.launchId
        : crypto.randomUUID();

    // Register active DeclarativeNetRequest rules so direct requests carry appropriate headers
    await updateGameSessionDnrRules(serviceId, body.serviceUri, body.token, language, country);

    const targetUrl = new URL(resolved.initialUri);
    if (!targetUrl.searchParams.has('lang')) targetUrl.searchParams.set('lang', language);
    if (!targetUrl.searchParams.has('na_country')) targetUrl.searchParams.set('na_country', country);
    if (!targetUrl.searchParams.has('na_lang')) targetUrl.searchParams.set('na_lang', language);

    const isZelda = isZeldaNotesService(serviceId, body.serviceUri);
    const isSplatNet2 = isSplatNet2Service(serviceId, body.serviceUri);
    let webviewUrl = targetUrl.toString();

    if (isSplatNet2) {
        // Prewarm SplatNet 2 root to exchange token with Nintendo & retrieve iksm_session cookie
        const jar = new CookieJar();
        try {
            const prewarmRes = await fetch(targetUrl.toString(), {
                headers: {
                    'X-GameWebToken': body.token,
                    'x-gamewebtoken': body.token,
                    'x-appplatform': 'android',
                    'x-appcolorscheme': 'DARK',
                    'X-Requested-With': 'com.nintendo.znca',
                    'X-NACountry': country,
                    'Accept-Language': language,
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Build/QP1A.190711.020; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/80.0.3987.162 Mobile Safari/537.36 com.nintendo.znca/3.4.1'
                },
                redirect: 'follow'
            });
            jar.setCookiesFromResponse(prewarmRes.headers, targetUrl);
            if (prewarmRes.url) {
                jar.setCookiesFromResponse(prewarmRes.headers, new URL(prewarmRes.url));
            }
        } catch (_) {}

        // Inject captured iksm_session cookie into Chrome cookie store
        await injectJarCookies(jar, `https://${targetUrl.hostname}/`, targetUrl.hostname);

        // SplatNet 2 SPA home URL
        const homeUrl = new URL('/home', targetUrl.origin);
        homeUrl.search = targetUrl.search;
        webviewUrl = homeUrl.toString();
    } else if (isZelda) {
        // Fast background prewarm to exchange token with Nintendo & retrieve AWS ALB sticky cookies
        const jar = new CookieJar();
        try {
            const prewarmRes = await fetch(targetUrl.toString(), {
                headers: {
                    'X-GameWebToken': body.token,
                    'x-gamewebtoken': body.token,
                    'x-appplatform': 'android',
                    'x-appcolorscheme': 'DARK',
                    'X-Requested-With': 'com.nintendo.znca',
                    'X-NACountry': country,
                    'Accept-Language': language,
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Build/QP1A.190711.020; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/80.0.3987.162 Mobile Safari/537.36 com.nintendo.znca/3.4.1'
                },
                redirect: 'follow'
            });
            jar.setCookiesFromResponse(prewarmRes.headers, targetUrl);
            if (prewarmRes.url) {
                jar.setCookiesFromResponse(prewarmRes.headers, new URL(prewarmRes.url));
            }
        } catch (_) {}

        // Inject cookies directly into the browser's cookie store — no proxy needed
        await injectZeldaCookies(jar, targetUrl, language, country);

        // Launch directly into /title-select on Nintendo's origin
        const titleSelectUrl = new URL('/title-select', targetUrl.origin);
        titleSelectUrl.search = targetUrl.search;
        webviewUrl = titleSelectUrl.toString();
    }

    return {
        status: 200,
        data: {
            sessionId,
            webviewUrl,
            expiresAt
        }
    };
}

export async function handleGameTokenRenew(body: {
    serviceId?: string | number;
    serviceUri?: string;
    token?: string;
}): Promise<{ status: number; data: any }> {
    if (!body.token || typeof body.token !== 'string') {
        return { status: 400, data: { error: 'Missing token parameter' } };
    }
    const serviceId = String(body.serviceId || 'unknown');
    await updateGameSessionDnrRules(serviceId, body.serviceUri, body.token);
    return {
        status: 200,
        data: { success: true, expiresAt: Date.now() + 2 * 60 * 60 * 1000 }
    };
}

export async function handleGameSessionClose(): Promise<{ status: number; data: any }> {
    await clearGameSessionDnrRules();
    return { status: 200, data: { success: true } };
}
