/** Nintendo service catalog, origin policy, and service-specific routing rules. */
export const TRUSTED_NINTENDO_DOMAINS = [
    'srv.nintendo.net',
    'nintendo.net',
    'nintendo.com',
    'nintendo.co.jp',
    'nintendowifi.net',
    'nintendo-europe.com'
];

export function isStrictNintendoOrigin(urlString: string): boolean {
    if (!urlString || typeof urlString !== 'string') return false;
    try {
        const parsed = new URL(urlString);
        if (parsed.protocol !== 'https:') return false;
        const hostname = parsed.hostname.toLowerCase();

        // Disallow IP literals, localhost, cloud metadata, and non-standard hostnames
        if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname)) return false; // IPv4
        if (hostname.includes(':') || hostname.startsWith('[') || hostname.endsWith(']')) return false; // IPv6
        if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) return false;

        return TRUSTED_NINTENDO_DOMAINS.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
    } catch {
        return false;
    }
}

export function classifyProxyTarget(targetUrlStr: string): string {
    try {
        const u = new URL(targetUrlStr);
        const host = u.hostname.toLowerCase();
        const path = u.pathname.toLowerCase();

        if (host === 'nxapi-auth.fancy.org.uk' || (host.includes('fancy.org.uk') && path.includes('/token'))) {
            return 'nxapi-auth';
        }
        if (host === 'nxapi-znca-api.fancy.org.uk') {
            if (path.endsWith('/f')) return 'nxapi-f';
            if (path.endsWith('/encrypt-request')) return 'nxapi-encrypt';
            if (path.endsWith('/decrypt-response')) return 'nxapi-decrypt';
            return 'nxapi-znca';
        }
        if (host === 'accounts.nintendo.com' || host === 'api.accounts.nintendo.com') {
            return 'nintendo-account';
        }
        if (host === 'api-lp1.znc.srv.nintendo.net') {
            return 'nintendo-coral';
        }
        if (host.endsWith('.srv.nintendo.net') || host.endsWith('.nintendo.net')) {
            return 'nintendo-web-service';
        }
    } catch { }
    return 'other';
}

export interface ServiceQuirkConfig {
    name?: string;
    preserveExactInitialUri?: boolean;
    customCss?: string;
}

export const SERVICE_QUIRKS: Record<string, ServiceQuirkConfig> = {
    '4834290508791808': {
        name: 'SplatNet 3',
        customCss: `
            [class*="NavigationBar_exitButton"] { display: none !important; }
        `
    },
    '4953919198265344': {
        name: 'NookLink',
        preserveExactInitialUri: true
    },
    '5935781783175168': {
        name: 'Zelda Notes',
        preserveExactInitialUri: true
    },
    '4974384874151936': {
        name: 'Zelda Notes',
        preserveExactInitialUri: true
    },
    '5741031244955648': {
        name: 'SplatNet 2'
    },
    '5598642853249024': {
        name: 'Smash World'
    },
    // Legacy/incorrect ID retained only for compatibility with older frontend snapshots.
    '5614999764533248': {
        name: 'Smash World (legacy id)'
    }
};

export const FALLBACK_SERVICES: Record<string, { uri: string; whiteList: string[] }> = {
    '4834290508791808': {
        uri: 'https://api.lp1.av5ja.srv.nintendo.net',
        whiteList: ['api.lp1.av5ja.srv.nintendo.net', 'api.lp1.usagi.srv.nintendo.net']
    },
    '4953919198265344': {
        uri: 'https://web.sd.lp1.acbaa.srv.nintendo.net',
        whiteList: ['web.sd.lp1.acbaa.srv.nintendo.net', 'dpl.sd.lp1.acbaa.srv.nintendo.net']
    },
    '5935781783175168': {
        uri: 'https://api.lp1.87abc152.srv.nintendo.net',
        whiteList: ['api.lp1.87abc152.srv.nintendo.net', '87abc152.srv.nintendo.net']
    },
    '4974384874151936': {
        uri: 'https://api.lp1.87abc152.srv.nintendo.net',
        whiteList: ['api.lp1.87abc152.srv.nintendo.net', '87abc152.srv.nintendo.net']
    },
    '5741031244955648': {
        uri: 'https://app.splatoon2.nintendo.net',
        whiteList: ['app.splatoon2.nintendo.net']
    },
    '5598642853249024': {
        uri: 'https://app.smashbros.nintendo.net',
        whiteList: ['app.smashbros.nintendo.net', 'www-aaaba-lp1-hac.cdn.nintendo.net']
    },
    // Legacy/incorrect ID retained only for compatibility with older frontend snapshots.
    '5614999764533248': {
        uri: 'https://app.smashbros.nintendo.net',
        whiteList: ['app.smashbros.nintendo.net', 'www-aaaba-lp1-hac.cdn.nintendo.net']
    }
};

export function isZeldaNotesService(serviceId: string, serviceUri?: string): boolean {
    if (serviceId === '5935781783175168' || serviceId === '4974384874151936') return true;
    if (serviceUri) {
        const lower = serviceUri.toLowerCase();
        if (lower.includes('87abc152') || lower.includes('zelda') || lower.includes('znotes')) return true;
    }
    return false;
}

export function isSplatNet3Service(serviceId: string, serviceUri?: string): boolean {
    if (serviceId === '4834290508791808') return true;
    if (serviceUri) {
        const lower = serviceUri.toLowerCase();
        if (lower.includes('av5ja') || lower.includes('usagi') || lower.includes('splatnet3')) return true;
    }
    return false;
}

export function isSmashWorldService(serviceId: string, serviceUri?: string): boolean {
    if (serviceId === '5598642853249024' || serviceId === '5614999764533248') return true;
    if (serviceUri) {
        const lower = serviceUri.toLowerCase();
        if (lower.includes('smash') || lower.includes('aaaba') || lower.includes('smashbros')) return true;
    }
    return false;
}

export function isSplatNet2Service(serviceId: string, serviceUri?: string): boolean {
    if (serviceId === '5741031244955648') return true;
    if (serviceUri) {
        const lower = serviceUri.toLowerCase();
        if (lower.includes('splatoon2.nintendo.net') || lower.includes('splatnet2')) return true;
    }
    return false;
}

export function isNookLinkService(serviceId: string, serviceUri?: string): boolean {
    if (serviceId === '4953919198265344') return true;
    if (serviceUri) {
        const lower = serviceUri.toLowerCase();
        if (lower.includes('acbaa') || lower.includes('nooklink')) return true;
    }
    return false;
}

export const SMASH_WORLD_RESOURCE_ORIGINS = new Set([
    'https://www-aaaba-lp1-hac.cdn.nintendo.net'
]);

export const SPLATNET3_RESOURCE_ORIGINS = new Set([
    // SplatNet 3's main SPA is served from av5ja, while Room Creation uses
    // a separate Nintendo-owned API host. Coral metadata does not always
    // expose this secondary origin, so keep it as a subresource-only quirk.
    'https://api.lp1.usagi.srv.nintendo.net'
]);

export const NOOKLINK_WEB_API_ORIGIN = 'https://web.sd.lp1.acbaa.srv.nintendo.net';

export const NOOKLINK_DPL_ORIGIN = 'https://dpl.sd.lp1.acbaa.srv.nintendo.net';

export const NOOKLINK_API_PATH = /^\/api\/sd\/v1(?:\/|$)/;

export const NOOKLINK_RESOURCE_ORIGINS = new Set([
    // NookLink can boot on the dpl host while its authenticated catalog/API
    // requests are sent to the web host (and vice versa). Coral metadata can
    // omit the sibling host, so keep this as an exact, NookLink-only resource quirk.
    NOOKLINK_WEB_API_ORIGIN,
    NOOKLINK_DPL_ORIGIN
]);

export function isServiceResourceOriginAllowed(
    serviceId: string,
    serviceUri: string | undefined,
    targetOrigin: string,
    allowedOrigins: string[],
    method = 'GET',
    fetchDest = ''
): boolean {
    if (isOriginWhitelisted(targetOrigin, allowedOrigins)) return true;

    // nxapi applies Coral's whiteList to navigations, while Chromium is still allowed to
    // load normal page subresources. Smash World uses this specific Nintendo CDN even
    // though older/live Coral metadata may list only app.smashbros.nintendo.net.
    if (isSmashWorldService(serviceId, serviceUri) && SMASH_WORLD_RESOURCE_ORIGINS.has(targetOrigin)) {
        const safeMethod = method === 'GET' || method === 'HEAD';
        const isNavigation = fetchDest === 'document' || fetchDest === 'iframe' || fetchDest === 'frame';
        return safeMethod && !isNavigation;
    }

    // SplatNet 3 Room Creation uses api.lp1.usagi.srv.nintendo.net for
    // /api/primer_tokens and /api/graphql. Treat it as a fetch/XHR API origin,
    // not as a navigation origin, so Coral's live navigation whitelist remains
    // authoritative while the official Room Creation flow can still function.
    if (isSplatNet3Service(serviceId, serviceUri) && SPLATNET3_RESOURCE_ORIGINS.has(targetOrigin)) {
        const safeMethod = method === 'GET' || method === 'HEAD' || method === 'POST';
        const isNavigation = fetchDest === 'document' || fetchDest === 'iframe' || fetchDest === 'frame';
        return safeMethod && !isNavigation;
    }

    // NookLink's SPA and API are split between the dpl and web acbaa hosts.
    // Treat those exact sibling origins as subresources only; never expand the
    // navigation allowlist and never allow arbitrary acbaa/Nintendo hosts here.
    if (isNookLinkService(serviceId, serviceUri) && NOOKLINK_RESOURCE_ORIGINS.has(targetOrigin)) {
        const safeMethod = method === 'GET' || method === 'HEAD' || method === 'POST';
        const isNavigation = fetchDest === 'document' || fetchDest === 'iframe' || fetchDest === 'frame';
        return safeMethod && !isNavigation;
    }

    return false;
}

export function isOriginWhitelisted(targetOrigin: string, allowedOrigins: string[]): boolean {
    if (!isStrictNintendoOrigin(targetOrigin)) return false;
    if (allowedOrigins.includes(targetOrigin)) return true;

    try {
        const targetHost = new URL(targetOrigin).hostname.toLowerCase();
        for (const allowed of allowedOrigins) {
            let allowedHost = '';
            try {
                allowedHost = allowed.startsWith('http') ? new URL(allowed).hostname.toLowerCase() : allowed.toLowerCase();
            } catch {
                allowedHost = allowed.replace(/^https?:\/\//i, '').toLowerCase();
            }

            if (allowedHost.startsWith('*.')) {
                const suffix = allowedHost.slice(2);
                if (targetHost === suffix || targetHost.endsWith('.' + suffix)) {
                    return true;
                }
            } else if (allowedHost.startsWith('.')) {
                const suffix = allowedHost.slice(1);
                if (targetHost === suffix || targetHost.endsWith('.' + suffix)) {
                    return true;
                }
            }
        }
    } catch { }

    return false;
}

export function resolveAllowedOrigins(serviceId: string, clientUri?: string, clientWhiteList?: string[]): {
    primaryOrigin: string;
    allowedOrigins: Set<string>;
    initialUri: string;
    usedFallback: boolean;
} {
    // 1. Authoritative: Coral-provided service URI and whitelist
    if (clientUri && typeof clientUri === 'string' && isStrictNintendoOrigin(clientUri)) {
        const primary = new URL(clientUri).origin;
        const set = new Set<string>([primary]);

        if (Array.isArray(clientWhiteList)) {
            for (const item of clientWhiteList) {
                try {
                    const clean = item.trim();
                    if (clean.startsWith('*.')) {
                        const baseDomain = clean.slice(2);
                        if (isStrictNintendoOrigin(`https://${baseDomain}`)) {
                            set.add(`https://${clean}`);
                        }
                    } else {
                        const origin = clean.startsWith('http') ? new URL(clean).origin : new URL(`https://${clean}`).origin;
                        if (isStrictNintendoOrigin(origin)) {
                            set.add(origin);
                        }
                    }
                } catch { }
            }
        }

        return { primaryOrigin: primary, allowedOrigins: set, initialUri: clientUri, usedFallback: false };
    }

    // 2. Fallback only if clientUri is missing or invalid
    const fallback = FALLBACK_SERVICES[String(serviceId)];
    if (fallback) {
        console.warn(`[resolveAllowedOrigins] Fallback metadata used for serviceId=${serviceId}`);
        const primary = new URL(fallback.uri).origin;
        const set = new Set<string>([primary]);
        for (const item of fallback.whiteList) {
            try {
                const clean = item.trim();
                if (clean.startsWith('*.')) {
                    const baseDomain = clean.slice(2);
                    if (isStrictNintendoOrigin(`https://${baseDomain}`)) {
                        set.add(`https://${clean}`);
                    }
                } else {
                    const origin = clean.startsWith('http') ? new URL(clean).origin : new URL(`https://${clean}`).origin;
                    if (isStrictNintendoOrigin(origin)) set.add(origin);
                }
            } catch { }
        }
        return { primaryOrigin: primary, allowedOrigins: set, initialUri: fallback.uri, usedFallback: true };
    }

    throw new Error('Game service URI is missing or does not satisfy strict Nintendo origin policy.');
}
