/**
 * Game Service WebView Session Handlers.
 */
import { resolveAllowedOrigins, isNookLinkService, isZeldaNotesService } from '../services/service-policy';
import { updateGameSessionDnrRules, clearGameSessionDnrRules } from '../dnr/dnr-manager';
import { CookieJar } from '../proxy/cookie-jar';

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

    // Register active DeclarativeNetRequest rules so direct requests carry X-GameWebToken
    await updateGameSessionDnrRules(serviceId, body.serviceUri, body.token, language, country);

    const targetUrl = new URL(resolved.initialUri);
    if (!targetUrl.searchParams.has('lang')) targetUrl.searchParams.set('lang', language);
    if (!targetUrl.searchParams.has('na_country')) targetUrl.searchParams.set('na_country', country);
    if (!targetUrl.searchParams.has('na_lang')) targetUrl.searchParams.set('na_lang', language);

    const isZelda = isZeldaNotesService(serviceId, body.serviceUri);
    let cookieString: string | undefined = undefined;
    let webviewUrl = targetUrl.toString();

    if (isZelda) {
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
            const generated = jar.getCookieHeader(targetUrl);
            if (generated) cookieString = generated;
        } catch (_) {}

        // Launch directly into /title-select on Nintendo's origin
        const titleSelectUrl = new URL('/title-select', targetUrl.origin);
        titleSelectUrl.search = targetUrl.search;
        webviewUrl = titleSelectUrl.toString();
    }

    // Register active DeclarativeNetRequest rules with token and prewarmed cookies
    await updateGameSessionDnrRules(serviceId, body.serviceUri, body.token, language, country, cookieString);

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
