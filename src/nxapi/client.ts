/** Low-level nxapi HTTP helpers, encoding, error normalization, and single-attempt fetch behavior. */
export const NXAPI_ZNCA_API_ORIGIN = 'https://nxapi-znca-api.fancy.org.uk';

export const NXAPI_ZNCA_API_BASE = `${NXAPI_ZNCA_API_ORIGIN}/api/znca`;

export const NXAPI_CLIENT_VERSION = 'w8zSLBsxR7rVoGJA';

export const CORAL_GWS_TOKEN_URL = 'https://api-lp1.znc.srv.nintendo.net/v4/Game/GetWebServiceToken';

export const CORAL_ACCOUNT_LOGIN_URL = 'https://api-lp1.znc.srv.nintendo.net/v4/Account/Login';

export class GameWebServiceTokenPipelineError extends Error {
    status: number;
    code: string;
    retryAfter: string | null;

    constructor(code: string, message: string, status = 502, retryAfter: string | null = null) {
        super(message);
        this.name = 'GameWebServiceTokenPipelineError';
        this.code = code;
        this.status = status;
        this.retryAfter = retryAfter;
    }
}

export function standardBase64(value: string): string {
    let normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    while (normalized.length % 4) normalized += '=';
    return normalized;
}

export function decodeBase64Bytes(value: string): Uint8Array {
    const binary = atob(standardBase64(value));
    return Uint8Array.from(binary, c => c.charCodeAt(0));
}

export function encodeBase64Bytes(bytes: Uint8Array): string {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

export function nxapiHeaders(accessToken: string, zncaVersion: string, accept = 'application/json'): Headers {
    const headers = new Headers({
        'Content-Type': 'application/json',
        Accept: accept,
        Authorization: `Bearer ${accessToken}`,
        'X-znca-Client-Version': NXAPI_CLIENT_VERSION,
        'X-znca-Platform': 'Android',
        'X-znca-Version': zncaVersion,
        'User-Agent': 'nso-webapp/1.0 (+https://github.com/Dycool/nso-webapp)'
    });
    return headers;
}

export async function readJsonOrText(response: Response): Promise<{ json: any; text: string }> {
    const text = await response.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { }
    return { json, text };
}

export function normalizeNxapiProxyFailure(status: number, json: any, text: string): string {
    const upstreamError = String(json?.error || '');
    const description = String(json?.error_description || json?.error_message || text || '').toLowerCase();
    if (status === 429 || upstreamError === 'rate_limit') return 'nxapi_rate_limited';
    if (status === 401 && upstreamError === 'invalid_token') return 'nxapi_invalid_token';
    if (status === 406 && upstreamError === 'unsupported_version') return 'nxapi_unsupported_version';
    if (status === 503 || description.includes('no matching workers') || upstreamError === 'service_unavailable') return 'nxapi_service_unavailable';
    if ([500, 502, 504].includes(status)) return 'nxapi_upstream_error';
    return upstreamError ? `nxapi_${upstreamError}` : 'nxapi_upstream_error';
}

export async function nxapiPipelineFetch(
    url: string,
    init: RequestInit,
    label: string,
    externalSignal?: AbortSignal
): Promise<Response> {
    // Public nxapi terms prohibit automatic HTTP retries (except a transport failure
    // before any response, or an explicit Retry-After). Deliberately make exactly one
    // upstream attempt here: cache misses are precious and must never turn into two f
    // generations because an upstream returned a 5xx.
    const controller = new AbortController();
    const relayAbort = () => {
        try { controller.abort('upstream_cancelled'); } catch { }
    };
    if (externalSignal?.aborted) relayAbort();
    else externalSignal?.addEventListener('abort', relayAbort, { once: true });

    const timeout = setTimeout(() => {
        try { controller.abort('upstream_timeout'); } catch { }
    }, 20_000);

    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } catch (error: any) {
        if (externalSignal?.aborted) {
            throw new DOMException('The operation was aborted.', 'AbortError');
        }
        throw new GameWebServiceTokenPipelineError(
            'upstream_transport_failure',
            `${label} ${error?.name === 'AbortError' ? 'timed out' : 'failed to connect'}.`,
            504
        );
    } finally {
        clearTimeout(timeout);
        externalSignal?.removeEventListener('abort', relayAbort);
    }
}

export async function requireNxapiSuccess(response: Response, label: string): Promise<{ json: any; text: string }> {
    const { json, text } = await readJsonOrText(response);
    if (response.ok) return { json, text };

    const message =
        json?.error_description ||
        json?.error_message ||
        json?.error ||
        text ||
        `${label} failed (HTTP ${response.status}).`;

    if (response.status === 401 || json?.error === 'invalid_token') {
        throw new GameWebServiceTokenPipelineError(
            'nxapi_invalid_token',
            'The in-memory nxapi access token expired.',
            401,
            response.headers.get('Retry-After')
        );
    }
    if (response.status === 429) {
        throw new GameWebServiceTokenPipelineError(
            'nxapi_rate_limited',
            String(message),
            429,
            response.headers.get('Retry-After')
        );
    }
    if (response.status === 406 || json?.error === 'unsupported_version' || /no matching workers/i.test(String(message))) {
        throw new GameWebServiceTokenPipelineError(
            'nxapi_unsupported_version',
            String(message),
            406,
            response.headers.get('Retry-After')
        );
    }
    if (response.status === 400 && /X-znca-Version.*does not match token/i.test(String(message))) {
        throw new GameWebServiceTokenPipelineError(
            'nxapi_version_context_mismatch',
            String(message),
            400,
            response.headers.get('Retry-After')
        );
    }
    throw new GameWebServiceTokenPipelineError(
        'nxapi_upstream_error',
        String(message),
        response.status || 502,
        response.headers.get('Retry-After')
    );
}
