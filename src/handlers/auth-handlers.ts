/**
 * Nintendo OAuth & Remember Me Authentication Handlers.
 */
import {
    saveRememberSession,
    getRememberSession,
    clearRememberSession,
    saveBrokerSession,
    clearAllSessions
} from '../storage/local-storage';
import { clearGameSessionDnrRules } from '../dnr/dnr-manager';
import { handleCoralSession, handleGameToken } from './nxapi-handlers';

export async function sha256Hex(value: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function handleResumeSession(options: { warmServiceIds?: Array<string | number>; zncaVersion?: string } = {}): Promise<{ status: number; data: any }> {
    const remember = await getRememberSession();
    if (!remember) {
        return { status: 404, data: { error: 'No remembered session found' } };
    }

    try {
        const response = await fetch('https://accounts.nintendo.com/connect/1.0.0/api/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 10; Build/QP1A.190711.020)'
            },
            body: JSON.stringify({
                client_id: '71b963c1b7b6d119',
                session_token: remember.sessionToken,
                grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer-session-token'
            })
        });

        const tokenData = await response.json().catch(() => ({})) as any;
        if (!response.ok || !tokenData.id_token) {
            await clearRememberSession();
            return {
                status: 401,
                data: {
                    error: tokenData.error_description || tokenData.error || 'Remembered Nintendo session has been revoked or expired.'
                }
            };
        }

        // Keep remembered resume to one extension message. The frontend already
        // understands brokerSession and will skip its follow-up session-start.
        const broker = await handleSessionStart({
            nintendoAccessToken: tokenData.access_token,
            idToken: tokenData.id_token,
            warmServiceIds: options.warmServiceIds,
            zncaVersion: options.zncaVersion
        });

        return {
            status: 200,
            data: {
                idToken: tokenData.id_token,
                accessToken: tokenData.access_token,
                ...(broker.status === 200 && broker.data ? { brokerSession: broker.data } : {})
            }
        };
    } catch (err: any) {
        return {
            status: 502,
            data: { error: 'Failed to connect to Nintendo OAuth endpoint', message: err?.message }
        };
    }
}

export async function handleRememberSave(body: { sessionToken?: string; accountHash?: string }): Promise<{ status: number; data: any }> {
    if (!body.sessionToken || typeof body.sessionToken !== 'string' || body.sessionToken.length > 512) {
        return { status: 400, data: { error: 'Missing or invalid sessionToken' } };
    }
    const saved = await saveRememberSession(body.sessionToken, body.accountHash);
    return { status: 200, data: { success: true, expiresAt: saved.expiresAt } };
}

export async function handleRememberForget(): Promise<{ status: number; data: any }> {
    await clearRememberSession();
    return { status: 200, data: { success: true } };
}

export async function handleSessionStart(body: {
    nintendoAccessToken?: string;
    clientId?: string;
    idToken?: string;
    nxapiAccessToken?: string;
    warmServiceIds?: Array<string | number>;
    zncaVersion?: string;
}): Promise<{ status: number; data: any }> {
    if (!body.nintendoAccessToken || typeof body.nintendoAccessToken !== 'string') {
        return { status: 400, data: { error: 'invalid_request' } };
    }

    try {
        const profileResp = await fetch('https://api.accounts.nintendo.com/2.0.0/users/me', {
            headers: {
                Authorization: `Bearer ${body.nintendoAccessToken}`,
                'User-Agent': 'NASDKAPI; Android',
                Accept: 'application/json'
            }
        });
        const profile = await profileResp.json().catch(() => ({})) as any;
        if (!profileResp.ok || !profile?.id) {
            return { status: 401, data: { error: 'invalid_nintendo_account_token' } };
        }

        const accountHash = await sha256Hex(String(profile.id));
        await saveBrokerSession(accountHash);

        // Match the Worker fast path: keep profile, Coral login, and an optional
        // game-token warm-up within this one extension message. Errors leave the
        // frontend's normal per-stage fallback intact.
        let coral: any = null;
        let gws: Record<string, any> | undefined;
        if (body.idToken && profile.language && profile.country && profile.birthday) {
            try {
                const coralResponse = await handleCoralSession({
                    clientId: body.clientId || accountHash,
                    idToken: body.idToken,
                    nxapiAccessToken: body.nxapiAccessToken,
                    naId: String(profile.id),
                    language: String(profile.language),
                    country: String(profile.country),
                    birthday: String(profile.birthday),
                    zncaVersion: body.zncaVersion
                });
                if (coralResponse.status === 200 && coralResponse.data?.coral?.session) {
                    coral = coralResponse.data.coral;
                    const serviceIds = Array.from(new Set((Array.isArray(body.warmServiceIds) ? body.warmServiceIds : [])
                        .map(String)
                        .filter(serviceId => /^\d+$/.test(serviceId)))).slice(0, 3);
                    const coralAccessToken = coral.session?.result?.webApiServerCredential?.accessToken;
                    if (coralAccessToken && serviceIds.length) {
                        const tokenResponse = await handleGameToken({
                            clientId: body.clientId || accountHash,
                            serviceId: serviceIds[0],
                            serviceIds,
                            coralAccessToken: String(coralAccessToken),
                            nxapiAccessToken: body.nxapiAccessToken,
                            naId: String(profile.id),
                            coralUserId: String(coral.session?.result?.user?.id || coral.session?.user?.id || ''),
                            zncaVersion: body.zncaVersion
                        });
                        if (tokenResponse.status === 200 && tokenResponse.data?.tokens) gws = tokenResponse.data.tokens;
                    }
                }
            } catch (_) {
                // Do not make the one-message optimization a login dependency.
            }
        }

        return {
            status: 200,
            data: {
                success: true,
                persistent: true,
                profile,
                ...(coral ? { coral } : {}),
                ...(gws && Object.keys(gws).length ? { gws } : {}),
                source: 'extension'
            }
        };
    } catch (err: any) {
        return { status: 502, data: { error: 'profile_fetch_failed', message: err?.message } };
    }
}

export async function handleLogout(): Promise<{ status: number; data: any }> {
    await clearAllSessions();
    await clearGameSessionDnrRules();
    return { status: 200, data: { success: true } };
}
