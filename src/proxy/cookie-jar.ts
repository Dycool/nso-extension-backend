/** RFC 6265-style cookie jar for local extension reverse-proxy */
export interface CookieEntry {
    name: string;
    value: string;
    domain: string;
    path: string;
    hostOnly: boolean;
    secure: boolean;
    httpOnly: boolean;
    expires?: number; // timestamp in ms
}

export class CookieJar {
    private cookies: CookieEntry[] = [];

    constructor(initialEntries?: CookieEntry[]) {
        if (initialEntries && Array.isArray(initialEntries)) {
            this.cookies = initialEntries;
        }
    }

    static fromJSON(entries?: CookieEntry[]): CookieJar {
        return new CookieJar(entries);
    }

    addCookie(entry: CookieEntry): void {
        this.cookies = this.cookies.filter((c: CookieEntry) => !(c.name === entry.name && c.domain === entry.domain && c.path === entry.path));
        this.cookies.push(entry);
    }

    toJSON(): CookieEntry[] {
        const now = Date.now();
        this.cookies = this.cookies.filter((c: CookieEntry) => !c.expires || c.expires > now);
        return this.cookies;
    }

    getCookies(): CookieEntry[] {
        const now = Date.now();
        this.cookies = this.cookies.filter((c: CookieEntry) => !c.expires || c.expires > now);
        return [...this.cookies];
    }

    setCookiesFromResponse(headers: Headers, currentUrl: URL): boolean {
        const getSetCookie = (headers as any).getSetCookie?.bind(headers);
        let rawSetCookies: string[] = [];

        if (typeof getSetCookie === 'function') {
            rawSetCookies = getSetCookie();
        } else {
            const single = headers.get('Set-Cookie');
            if (single) rawSetCookies = [single];
        }

        if (!rawSetCookies || rawSetCookies.length === 0) {
            return false;
        }

        let changed = false;
        for (const raw of rawSetCookies) {
            if (this.addSetCookie(raw, currentUrl)) {
                changed = true;
            }
        }
        return changed;
    }

    addSetCookie(raw: string, currentUrl: URL): boolean {
        if (!raw || typeof raw !== 'string') return false;
        const parts = raw.split(';').map(p => p.trim());
        if (!parts[0] || !parts[0].includes('=')) return false;

        const firstEq = parts[0].indexOf('=');
        const name = parts[0].slice(0, firstEq).trim();
        const value = parts[0].slice(firstEq + 1).trim();
        if (!name) return false;

        let domain = currentUrl.hostname.toLowerCase();
        let hostOnly = true;
        let path = currentUrl.pathname ? currentUrl.pathname.slice(0, currentUrl.pathname.lastIndexOf('/') + 1) || '/' : '/';
        let secure = false;
        let httpOnly = false;
        let expires: number | undefined = undefined;

        for (let i = 1; i < parts.length; i++) {
            const attr = parts[i];
            const eqIdx = attr.indexOf('=');
            const attrName = (eqIdx !== -1 ? attr.slice(0, eqIdx) : attr).trim().toLowerCase();
            const attrVal = eqIdx !== -1 ? attr.slice(eqIdx + 1).trim() : '';

            if (attrName === 'domain' && attrVal) {
                let cleanDomain = attrVal.startsWith('.') ? attrVal.slice(1).toLowerCase() : attrVal.toLowerCase();
                if (currentUrl.hostname.toLowerCase().endsWith(cleanDomain)) {
                    domain = cleanDomain;
                    hostOnly = false;
                }
            } else if (attrName === 'path' && attrVal) {
                path = attrVal.startsWith('/') ? attrVal : '/' + attrVal;
            } else if (attrName === 'secure') {
                secure = true;
            } else if (attrName === 'httponly') {
                httpOnly = true;
            } else if (attrName === 'max-age' && attrVal) {
                const maxAgeSec = parseInt(attrVal, 10);
                if (!isNaN(maxAgeSec)) {
                    expires = Date.now() + maxAgeSec * 1000;
                }
            } else if (attrName === 'expires' && attrVal && expires === undefined) {
                const parsed = Date.parse(attrVal);
                if (!isNaN(parsed)) {
                    expires = parsed;
                }
            }
        }

        this.cookies = this.cookies.filter(c => !(c.name === name && c.domain === domain && c.path === path));
        if (expires === undefined || expires > Date.now()) {
            this.cookies.push({
                name,
                value,
                domain,
                path,
                hostOnly,
                secure,
                httpOnly,
                expires
            });
        }
        return true;
    }

    getCookieHeader(targetUrl: URL): string {
        const now = Date.now();
        const hostname = targetUrl.hostname.toLowerCase();
        const pathname = targetUrl.pathname || '/';
        const isSecure = targetUrl.protocol === 'https:';

        const valid = this.cookies.filter(c => {
            if (c.expires && c.expires <= now) return false;
            if (c.secure && !isSecure) return false;

            if (c.hostOnly) {
                if (c.domain !== hostname) return false;
            } else {
                if (hostname !== c.domain && !hostname.endsWith('.' + c.domain)) return false;
            }

            if (c.path !== '/' && !pathname.startsWith(c.path) && pathname !== c.path.replace(/\/$/, '')) return false;

            return true;
        });

        valid.sort((a, b) => b.path.length - a.path.length);
        return valid.map(c => `${c.name}=${c.value}`).join('; ');
    }
}
