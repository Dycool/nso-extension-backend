/**
 * nxapi Attestation, Coral Login, and GameWebServiceToken Handlers.
 */
import {
    acquireCoralSessionFast,
    acquireGameWebServiceTokenFast,
    performCoralApiCallFast
} from '../nxapi/coral';
import { generateSharedMethod2Attestation } from '../nxapi/shared-f2';
import { GameWebServiceTokenPipelineError } from '../nxapi/client';
import { isStrictNintendoOrigin } from '../services/service-policy';

export async function handleCoralSession(body: {
    clientId?: string;
    idToken?: string;
    nxapiAccessToken?: string;
    naId?: string;
    language?: string;
    country?: string;
    birthday?: string;
    zncaVersion?: string;
}): Promise<{ status: number; data: any }> {
    if (!body.clientId || !body.naId) {
        return { status: 400, data: { error: 'invalid_request' } };
    }
    if (!body.idToken || !body.nxapiAccessToken || !body.language || !body.country || !body.birthday) {
        return { status: 200, data: { miss: true, needsNxapi: true, source: 'cache_miss' } };
    }

    const requestedVersion = typeof body.zncaVersion === 'string' && /^\d+\.\d+\.\d+$/.test(body.zncaVersion)
        ? body.zncaVersion : '3.4.1';

    try {
        const result = await acquireCoralSessionFast({
            idToken: body.idToken,
            nxapiAccessToken: body.nxapiAccessToken,
            naId: body.naId,
            language: body.language,
            country: body.country,
            birthday: body.birthday,
            zncaVersion: requestedVersion
        });

        const coralPayload = {
            session: result.session,
            expiresAt: Date.now() + (result.expiresIn || 7200) * 1000,
            zncaVersion: requestedVersion
        };

        return {
            status: 200,
            data: { coral: coralPayload, source: 'extension' }
        };
    } catch (error: any) {
        if (error instanceof GameWebServiceTokenPipelineError) {
            return {
                status: error.status,
                data: { error: error.code, error_description: error.message, retryAfter: error.retryAfter }
            };
        }
        return {
            status: 500,
            data: { error: 'coral_generation_failed', message: error?.message }
        };
    }
}

export async function handleGameToken(body: {
    clientId?: string;
    serviceId?: string | number;
    serviceIds?: Array<string | number>;
    coralAccessToken?: string;
    nxapiAccessToken?: string;
    naId?: string;
    coralUserId?: string;
    zncaVersion?: string;
}): Promise<{ status: number; data: any }> {
    if (!body.clientId || !body.serviceId || !body.coralAccessToken || !body.nxapiAccessToken || !body.naId) {
        return { status: 400, data: { error: 'invalid_request' } };
    }

    const requestedVersion = typeof body.zncaVersion === 'string' && /^\d+\.\d+\.\d+$/.test(body.zncaVersion)
        ? body.zncaVersion : '3.4.1';

    try {
        const requestedId = String(body.serviceId);
        const batchIds = Array.from(new Set([
            requestedId,
            ...(Array.isArray(body.serviceIds) ? body.serviceIds.map(String) : [])
        ].filter(id => /^\d+$/.test(id)))).slice(0, 10);

        // Generate ONE shared method-2 attestation with nxapi
        const attestation = await generateSharedMethod2Attestation({
            coralAccessToken: String(body.coralAccessToken),
            nxapiAccessToken: String(body.nxapiAccessToken),
            naId: String(body.naId),
            coralUserId: body.coralUserId || '',
            zncaVersion: requestedVersion
        });

        // Reuse that exact attestation to get tokens for all services in parallel
        const settled = await Promise.allSettled(batchIds.map(async (serviceId) => {
            const result = await acquireGameWebServiceTokenFast({
                serviceId,
                coralAccessToken: String(body.coralAccessToken),
                nxapiAccessToken: String(body.nxapiAccessToken),
                naId: String(body.naId),
                coralUserId: body.coralUserId || '',
                zncaVersion: requestedVersion,
                attestation: {
                    f: attestation.f,
                    timestamp: attestation.timestamp,
                    requestId: attestation.requestId
                }
            });
            return {
                serviceId,
                token: {
                    token: result.accessToken,
                    expiresAt: Date.now() + (result.expiresIn || 10800) * 1000,
                    coralUserId: String(body.coralUserId || ''),
                    zncaVersion: requestedVersion
                }
            };
        }));

        const tokens: Record<string, any> = {};
        for (const item of settled) {
            if (item.status === 'fulfilled') {
                tokens[item.value.serviceId] = item.value.token;
            }
        }

        const requestedToken = tokens[requestedId];
        if (!requestedToken) {
            const primarySettled = settled[0];
            if (primarySettled.status === 'rejected') throw primarySettled.reason;
            throw new GameWebServiceTokenPipelineError('gws_generation_failed', 'Failed to generate requested game token.');
        }

        return {
            status: 200,
            data: {
                token: requestedToken,
                tokens,
                source: batchIds.length > 1 ? 'shared_f2' : 'extension'
            }
        };
    } catch (error: any) {
        if (error instanceof GameWebServiceTokenPipelineError) {
            return {
                status: error.status,
                data: { error: error.code, error_description: error.message, retryAfter: error.retryAfter }
            };
        }
        return {
            status: 500,
            data: { error: 'gws_generation_failed', message: error?.message }
        };
    }
}

export async function handleCoralCall(body: {
    clientId?: string;
    path?: string;
    requestBody?: any;
    coralAccessToken?: string;
    nxapiAccessToken?: string;
    zncaVersion?: string;
    locale?: string;
    platform?: boolean;
    productVersion?: boolean;
}): Promise<{ status: number; data: any }> {
    const validToken = (value: unknown, max: number) => typeof value === 'string' && value.length > 0 && value.length <= max;
    if (!body.clientId || !validToken(body.path, 256) || !validToken(body.coralAccessToken, 16_384) ||
        !validToken(body.nxapiAccessToken, 16_384)) {
        return { status: 400, data: { error: 'invalid_request' } };
    }

    const requestedVersion = typeof body.zncaVersion === 'string' && /^\d+\.\d+\.\d+$/.test(body.zncaVersion)
        ? body.zncaVersion : '3.4.1';

    try {
        const result = await performCoralApiCallFast({
            path: String(body.path),
            requestBody: body.requestBody ?? {},
            coralAccessToken: String(body.coralAccessToken),
            nxapiAccessToken: String(body.nxapiAccessToken),
            zncaVersion: requestedVersion,
            locale: typeof body.locale === 'string' ? body.locale.slice(0, 35) : 'en-GB',
            platform: body.platform === true,
            productVersion: body.productVersion === true
        });

        return {
            status: result.httpStatus || 200,
            data: result.decoded
        };
    } catch (error: any) {
        if (error instanceof GameWebServiceTokenPipelineError) {
            return {
                status: error.status,
                data: { error: error.code, nso_error: error.code, error_description: error.message, retryAfter: error.retryAfter }
            };
        }
        return {
            status: 500,
            data: { error: 'coral_call_failed', error_description: error?.message || 'Coral API call failed' }
        };
    }
}

export async function handleCoralBatch(body: {
    clientId?: string;
    coralAccessToken?: string;
    nxapiAccessToken?: string;
    naId?: string;
    zncaVersion?: string;
    locale?: string;
    calls?: Array<{ id?: string; path?: string; requestBody?: unknown; platform?: boolean; productVersion?: boolean }>;
}): Promise<{ status: number; data: any }> {
    const calls = Array.isArray(body.calls) ? body.calls : [];
    if (!calls.length || calls.length > 6) {
        return { status: 400, data: { error: 'invalid_batch' } };
    }

    const common = {
        clientId: body.clientId,
        coralAccessToken: body.coralAccessToken,
        nxapiAccessToken: body.nxapiAccessToken,
        naId: body.naId,
        zncaVersion: body.zncaVersion,
        locale: body.locale
    };

    const results = await Promise.all(calls.map(async (call, index) => {
        const res = await handleCoralCall({
            ...common,
            path: call.path,
            requestBody: call.requestBody ?? {},
            platform: call.platform === true,
            productVersion: call.productVersion === true
        });
        return {
            id: typeof call.id === 'string' ? call.id : String(index),
            status: res.status,
            data: res.data
        };
    }));

    const statuses = results.map(r => r.status);
    const overallStatus = statuses.every(s => s === 403) ? 403 :
        statuses.every(s => s === 401) ? 401 : 200;

    return {
        status: overallStatus,
        data: { results }
    };
}

export async function handleProxy(body: {
    targetUrl?: string;
    method?: string;
    headers?: Record<string, string>;
    data?: any;
    dataBase64?: string;
}): Promise<{ status: number; data: any; text?: string }> {
    if (!body.targetUrl || typeof body.targetUrl !== 'string') {
        return { status: 400, data: { error: 'Missing targetUrl parameter' } };
    }

    let targetUrl: URL;
    try {
        targetUrl = new URL(body.targetUrl);
    } catch {
        return { status: 400, data: { error: 'Invalid targetUrl format' } };
    }

    const targetHost = targetUrl.hostname.toLowerCase();
    const allowedNxapiHosts = new Set([
        'nxapi-znca-api.fancy.org.uk',
        'nxapi-auth.fancy.org.uk',
        'fancy.org.uk'
    ]);

    const isAllowed = isStrictNintendoOrigin(body.targetUrl) || allowedNxapiHosts.has(targetHost);
    if (!isAllowed) {
        return { status: 403, data: { error: 'Proxy request disallowed for this domain' } };
    }

    const defaultUserAgent = allowedNxapiHosts.has(targetHost)
        ? 'nso-webapp/1.0 (+https://github.com/dycool/nso-webapp)'
        : 'com.nintendo.znca/3.4.1 (Android/10)';

    const fetchHeaders = new Headers();
    if (body.headers && typeof body.headers === 'object') {
        for (const [k, v] of Object.entries(body.headers)) {
            if (v && typeof v === 'string') fetchHeaders.set(k, v);
        }
    }
    if (!fetchHeaders.has('User-Agent')) fetchHeaders.set('User-Agent', defaultUserAgent);

    let fetchBody: any = undefined;
    const method = String(body.method || 'GET').toUpperCase();
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
        if (body.dataBase64) {
            const binaryString = atob(body.dataBase64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            fetchBody = bytes;
        } else if (body.data !== undefined) {
            fetchBody = typeof body.data === 'string' ? body.data : JSON.stringify(body.data);
        }
    }

    const response = await fetch(body.targetUrl, {
        method,
        headers: fetchHeaders,
        body: fetchBody
    });

    const responseContentType = response.headers.get('Content-Type') || '';
    if (responseContentType.includes('application/json')) {
        try {
            const jsonData = await response.json();
            return { status: response.status, data: jsonData };
        } catch (_) {}
    }

    const textData = await response.text();
    try {
        const jsonData = JSON.parse(textData);
        return { status: response.status, data: jsonData, text: textData };
    } catch (_) {
        return { status: response.status, data: { raw: textData }, text: textData };
    }
}

