/** Shared method-2 Coral attestation generation for concurrent game-service token requests. */
import {
    NXAPI_ZNCA_API_BASE,
    GameWebServiceTokenPipelineError,
    nxapiHeaders,
    nxapiPipelineFetch,
    requireNxapiSuccess
} from './client';

export interface SharedMethod2Attestation {
    f: string;
    timestamp: number;
    requestId: string;
    generationMs: number;
}

export async function generateSharedMethod2Attestation(body: {
    coralAccessToken: string;
    nxapiAccessToken: string;
    naId: string;
    coralUserId?: string;
    zncaVersion: string;
    signal?: AbortSignal;
}): Promise<SharedMethod2Attestation> {
    const startedAt = performance.now();
    const response = await nxapiPipelineFetch(
        `${NXAPI_ZNCA_API_BASE}/f`,
        {
            method: 'POST',
            headers: nxapiHeaders(body.nxapiAccessToken, body.zncaVersion),
            body: JSON.stringify({
                hash_method: '2',
                token: body.coralAccessToken,
                na_id: body.naId,
                coral_user_id: body.coralUserId || ''
            })
        },
        'nxapi shared f-generation',
        body.signal
    );
    const { json } = await requireNxapiSuccess(response, 'nxapi shared f-generation');
    const timestamp = Number(json?.timestamp);
    const requestId = String(json?.request_id || '');
    if (!json?.f || !requestId || !Number.isFinite(timestamp)) {
        throw new GameWebServiceTokenPipelineError(
            'nxapi_invalid_response',
            'nxapi did not return a complete shared method-2 attestation.'
        );
    }

    return {
        f: String(json.f),
        timestamp,
        requestId,
        generationMs: Math.round(performance.now() - startedAt)
    };
}
