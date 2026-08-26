/** Coral authentication and GameWebServiceToken pipelines backed by nxapi. */
import { NXAPI_ZNCA_API_BASE, CORAL_GWS_TOKEN_URL, CORAL_ACCOUNT_LOGIN_URL, GameWebServiceTokenPipelineError, decodeBase64Bytes, encodeBase64Bytes, nxapiHeaders, nxapiPipelineFetch, requireNxapiSuccess } from './client';

export async function getEncryptedWebServiceTokenRequest(
    serviceId: number,
    coralAccessToken: string,
    nxapiAccessToken: string,
    naId: string,
    coralUserId: string,
    zncaVersion: string,
    attestation?: { f: string; timestamp: number; requestId: string },
    signal?: AbortSignal
): Promise<{ bytes: Uint8Array; mode: 'prewarmed' | 'combined'; fDurationMs: number }> {
    const parameter = {
        id: serviceId,
        registrationToken: '',
        f: attestation?.f || '',
        requestId: attestation?.requestId || '',
        timestamp: attestation?.timestamp || 0
    };

    if (attestation) {
        const startedAt = performance.now();
        const response = await nxapiPipelineFetch(
            `${NXAPI_ZNCA_API_BASE}/encrypt-request`,
            {
                method: 'POST',
                headers: nxapiHeaders(nxapiAccessToken, zncaVersion),
                body: JSON.stringify({
                    url: CORAL_GWS_TOKEN_URL,
                    token: coralAccessToken,
                    data: JSON.stringify({ parameter })
                })
            },
            'nxapi encrypt-request',
            signal
        );
        const { json } = await requireNxapiSuccess(response, 'nxapi encrypt-request');
        if (!json?.data || typeof json.data !== 'string') {
            throw new GameWebServiceTokenPipelineError(
                'nxapi_invalid_response',
                'nxapi did not return encrypted GameWebServiceToken request data.'
            );
        }
        return {
            bytes: decodeBase64Bytes(json.data),
            mode: 'prewarmed',
            fDurationMs: Math.round(performance.now() - startedAt)
        };
    }

    // Exact nxapi fast path: f + encrypt_token_request in one upstream call.
    const startedAt = performance.now();
    const response = await nxapiPipelineFetch(
        `${NXAPI_ZNCA_API_BASE}/f`,
        {
            method: 'POST',
            headers: nxapiHeaders(nxapiAccessToken, zncaVersion),
            body: JSON.stringify({
                hash_method: '2',
                token: coralAccessToken,
                na_id: naId,
                coral_user_id: coralUserId,
                encrypt_token_request: {
                    url: CORAL_GWS_TOKEN_URL,
                    parameter
                }
            })
        },
        'nxapi f-generation',
        signal
    );
    const { json } = await requireNxapiSuccess(response, 'nxapi f-generation');
    if (!json?.encrypted_token_request || typeof json.encrypted_token_request !== 'string') {
        throw new GameWebServiceTokenPipelineError(
            'nxapi_invalid_response',
            'nxapi did not return encrypted_token_request for GameWebServiceToken.'
        );
    }

    return {
        bytes: decodeBase64Bytes(json.encrypted_token_request),
        mode: 'combined',
        fDurationMs: Math.round(performance.now() - startedAt)
    };
}

export async function decryptCoralPipelineResponse(
    response: Response,
    nxapiAccessToken: string,
    zncaVersion: string,
    signal?: AbortSignal
): Promise<any> {
    const bytes = new Uint8Array(await response.arrayBuffer());
    const maybeText = new TextDecoder().decode(bytes);
    const trimmed = maybeText.trimStart();

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try { return JSON.parse(maybeText); } catch { }
    }

    const decryptResponse = await nxapiPipelineFetch(
        `${NXAPI_ZNCA_API_BASE}/decrypt-response`,
        {
            method: 'POST',
            headers: nxapiHeaders(nxapiAccessToken, zncaVersion, 'text/plain'),
            body: JSON.stringify({ data: encodeBase64Bytes(bytes) })
        },
        'nxapi decrypt-response',
        signal
    );
    const { text } = await requireNxapiSuccess(decryptResponse, 'nxapi decrypt-response');
    try {
        return JSON.parse(text);
    } catch {
        throw new GameWebServiceTokenPipelineError(
            'nxapi_invalid_response',
            'nxapi returned an invalid decrypted Coral response.'
        );
    }
}

export async function performCoralApiCallFast(body: {
    path: string;
    requestBody: any;
    coralAccessToken: string;
    nxapiAccessToken: string;
    zncaVersion: string;
    locale?: string;
    platform?: boolean;
    productVersion?: boolean;
    signal?: AbortSignal;
}): Promise<{ decoded: any; httpStatus: number; retryAfter: string | null }> {
    if (!/^\/v\d+\/[A-Za-z0-9_./-]+$/.test(body.path) || body.path.includes('..')) {
        throw new GameWebServiceTokenPipelineError('invalid_request', 'Invalid Coral API path.', 400);
    }
    const target = new URL(body.path, 'https://api-lp1.znc.srv.nintendo.net');
    if (target.origin !== 'https://api-lp1.znc.srv.nintendo.net') {
        throw new GameWebServiceTokenPipelineError('invalid_request', 'Invalid Coral API origin.', 400);
    }

    const encryptedResponse = await nxapiPipelineFetch(
        `${NXAPI_ZNCA_API_BASE}/encrypt-request`,
        {
            method: 'POST',
            headers: nxapiHeaders(body.nxapiAccessToken, body.zncaVersion),
            body: JSON.stringify({
                url: target.href,
                token: body.coralAccessToken,
                data: JSON.stringify(body.requestBody ?? {})
            })
        },
        'nxapi encrypt-request',
        body.signal
    );
    const { json: encryptedJson } = await requireNxapiSuccess(encryptedResponse, 'nxapi encrypt-request');
    if (!encryptedJson?.data || typeof encryptedJson.data !== 'string') {
        throw new GameWebServiceTokenPipelineError('nxapi_invalid_response', 'nxapi did not return encrypted Coral request data.');
    }

    const headers: Record<string, string> = {
        'Content-Type': 'application/octet-stream',
        Accept: 'application/octet-stream,application/json',
        'Accept-Language': body.locale || 'en-GB',
        Authorization: `Bearer ${body.coralAccessToken}`,
        'User-Agent': `com.nintendo.znca/${body.zncaVersion}(Android/12)`,
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache'
    };
    if (body.platform) headers['X-Platform'] = 'Android';
    if (body.productVersion) headers['X-ProductVersion'] = body.zncaVersion;

    const coralResponse = await nxapiPipelineFetch(
        target.href,
        {
            method: 'POST',
            headers,
            body: decodeBase64Bytes(encryptedJson.data)
        },
        `Nintendo Coral ${body.path}`,
        body.signal
    );
    const retryAfter = coralResponse.headers.get('Retry-After');
    const httpStatus = coralResponse.status;
    const decoded = await decryptCoralPipelineResponse(
        coralResponse,
        body.nxapiAccessToken,
        body.zncaVersion,
        body.signal
    );
    return { decoded, httpStatus, retryAfter };
}

export async function acquireGameWebServiceTokenFast(body: {
    serviceId: string | number;
    coralAccessToken: string;
    nxapiAccessToken: string;
    naId: string;
    coralUserId?: string;
    zncaVersion: string;
    attestation?: { f: string; timestamp: number; requestId: string };
    signal?: AbortSignal;
}): Promise<{ accessToken: string; expiresIn: number; mode: string; timings: Record<string, number> }> {
    const serviceId = Number(body.serviceId);
    if (!Number.isSafeInteger(serviceId) || serviceId <= 0) {
        throw new GameWebServiceTokenPipelineError('invalid_request', 'Invalid game service ID.', 400);
    }

    const pipelineStarted = performance.now();
    const encrypted = await getEncryptedWebServiceTokenRequest(
        serviceId,
        body.coralAccessToken,
        body.nxapiAccessToken,
        body.naId,
        body.coralUserId || '',
        body.zncaVersion,
        body.attestation,
        body.signal
    );

    const coralStarted = performance.now();
    const coralResponse = await nxapiPipelineFetch(
        CORAL_GWS_TOKEN_URL,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/octet-stream',
                Accept: 'application/octet-stream,application/json',
                'Accept-Language': 'en-GB',
                Authorization: `Bearer ${body.coralAccessToken}`,
                'X-ProductVersion': body.zncaVersion,
                'X-Platform': 'Android',
                'User-Agent': `com.nintendo.znca/${body.zncaVersion}(Android/12)`
            },
            body: encrypted.bytes
        },
        'Nintendo GameWebServiceToken',
        body.signal
    );
    const coralDurationMs = Math.round(performance.now() - coralStarted);

    const decryptStarted = performance.now();
    const decoded = await decryptCoralPipelineResponse(
        coralResponse,
        body.nxapiAccessToken,
        body.zncaVersion,
        body.signal
    );
    const decryptDurationMs = Math.round(performance.now() - decryptStarted);

    if (!coralResponse.ok || !decoded?.result?.accessToken) {
        const message = decoded?.errorMessage || decoded?.error ||
            `Nintendo rejected GameWebServiceToken request (HTTP ${coralResponse.status}).`;
        const code = coralResponse.status === 401 ? 'coral_token_expired' : 'coral_upstream_error';
        throw new GameWebServiceTokenPipelineError(code, String(message), coralResponse.status || 502);
    }

    const result = decoded.result;
    return {
        accessToken: String(result.accessToken),
        expiresIn: Math.max(60, Number(result.expiresIn || 7200)),
        mode: encrypted.mode,
        timings: {
            fOrEncryptMs: encrypted.fDurationMs,
            coralMs: coralDurationMs,
            decryptMs: decryptDurationMs,
            totalMs: Math.round(performance.now() - pipelineStarted)
        }
    };
}

export async function acquireCoralSessionFast(body: {
    idToken: string;
    nxapiAccessToken: string;
    naId: string;
    language: string;
    country: string;
    birthday: string;
    zncaVersion: string;
    signal?: AbortSignal;
}): Promise<{ session: any; expiresIn: number; timings: Record<string, number> }> {
    const parameter = {
        f: '',
        naIdToken: body.idToken,
        timestamp: 0,
        requestId: '',
        language: body.language,
        naCountry: body.country,
        naBirthday: body.birthday
    };

    const pipelineStarted = performance.now();
    const fStarted = performance.now();
    const fResponse = await nxapiPipelineFetch(
        `${NXAPI_ZNCA_API_BASE}/f`,
        {
            method: 'POST',
            headers: nxapiHeaders(body.nxapiAccessToken, body.zncaVersion),
            body: JSON.stringify({
                hash_method: '1',
                token: body.idToken,
                na_id: body.naId,
                encrypt_token_request: {
                    url: CORAL_ACCOUNT_LOGIN_URL,
                    parameter
                }
            })
        },
        'nxapi Coral f-generation',
        body.signal
    );
    const { json: fJson } = await requireNxapiSuccess(fResponse, 'nxapi Coral f-generation');
    if (!fJson?.encrypted_token_request || typeof fJson.encrypted_token_request !== 'string') {
        throw new GameWebServiceTokenPipelineError(
            'nxapi_invalid_response',
            'nxapi did not return encrypted Account/Login request data.'
        );
    }
    const fMs = Math.round(performance.now() - fStarted);

    const coralStarted = performance.now();
    const coralResponse = await nxapiPipelineFetch(
        CORAL_ACCOUNT_LOGIN_URL,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/octet-stream',
                Accept: 'application/octet-stream,application/json',
                'Accept-Language': body.language || 'en-GB',
                Pragma: 'no-cache',
                'Cache-Control': 'no-cache',
                'X-ProductVersion': body.zncaVersion,
                'X-Platform': 'Android',
                'User-Agent': `com.nintendo.znca/${body.zncaVersion}(Android/12)`
            },
            body: decodeBase64Bytes(fJson.encrypted_token_request)
        },
        'Nintendo Coral Account/Login',
        body.signal
    );
    const coralMs = Math.round(performance.now() - coralStarted);

    const decryptStarted = performance.now();
    const decoded = await decryptCoralPipelineResponse(
        coralResponse,
        body.nxapiAccessToken,
        body.zncaVersion,
        body.signal
    );
    const decryptMs = Math.round(performance.now() - decryptStarted);

    if (!coralResponse.ok || !decoded?.result?.webApiServerCredential?.accessToken) {
        const message = decoded?.errorMessage || decoded?.error ||
            `Nintendo rejected Coral Account/Login (HTTP ${coralResponse.status}).`;
        throw new GameWebServiceTokenPipelineError(
            coralResponse.status === 401 ? 'nintendo_account_token_expired' : 'coral_login_failed',
            String(message),
            coralResponse.status || 502
        );
    }

    const expiresIn = Math.max(60, Number(decoded.result.webApiServerCredential.expiresIn || 7200));
    decoded.nsoWebapp = {
        ...(decoded.nsoWebapp || {}),
        naId: body.naId,
        coralExpiresAt: Date.now() + expiresIn * 1000,
        zncaVersion: body.zncaVersion
    };

    return {
        session: decoded,
        expiresIn,
        timings: {
            fMs,
            coralMs,
            decryptMs,
            totalMs: Math.round(performance.now() - pipelineStarted)
        }
    };
}
