/**
 * Game Service WebView Session Handlers.
 */
import { resolveAllowedOrigins, isNookLinkService } from '../services/service-policy';
import { updateGameSessionDnrRules, clearGameSessionDnrRules } from '../dnr/dnr-manager';

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

    // Register active DeclarativeNetRequest rules so the direct iframe request carries X-GameWebToken
    await updateGameSessionDnrRules(serviceId, body.serviceUri, body.token, language, country);

    // Build the direct Nintendo service launch target URL
    const targetUrl = new URL(resolved.initialUri);
    if (!targetUrl.searchParams.has('lang')) targetUrl.searchParams.set('lang', language);
    if (!targetUrl.searchParams.has('na_country')) targetUrl.searchParams.set('na_country', country);
    if (!targetUrl.searchParams.has('na_lang')) targetUrl.searchParams.set('na_lang', language);

    return {
        status: 200,
        data: {
            sessionId,
            webviewUrl: targetUrl.toString(),
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
