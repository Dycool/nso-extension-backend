/**
 * Isolated browser extension storage manager.
 * Stores Remember Me tokens and broker state in sandboxed chrome.storage.local.
 */

export interface StoredRememberSession {
    sessionToken: string;
    accountHash?: string;
    expiresAt: number;
    savedAt: number;
}

export interface StoredBrokerSession {
    accountHash: string;
    expiresAt: number;
    savedAt: number;
}

const REMEMBER_SESSION_KEY = 'nso_remember_session';
const BROKER_SESSION_KEY = 'nso_broker_session';
export const REMEMBER_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function saveRememberSession(sessionToken: string, accountHash?: string): Promise<StoredRememberSession> {
    const session: StoredRememberSession = {
        sessionToken,
        accountHash,
        expiresAt: Date.now() + REMEMBER_MAX_AGE_MS,
        savedAt: Date.now()
    };
    await chrome.storage.local.set({ [REMEMBER_SESSION_KEY]: session });
    return session;
}

export async function getRememberSession(): Promise<StoredRememberSession | null> {
    const data = await chrome.storage.local.get(REMEMBER_SESSION_KEY);
    const session = data[REMEMBER_SESSION_KEY] as StoredRememberSession | undefined;
    if (!session || !session.sessionToken || session.expiresAt <= Date.now()) {
        if (session) await clearRememberSession();
        return null;
    }
    return session;
}

export async function clearRememberSession(): Promise<void> {
    await chrome.storage.local.remove(REMEMBER_SESSION_KEY);
}

export async function saveBrokerSession(accountHash: string): Promise<StoredBrokerSession> {
    const session: StoredBrokerSession = {
        accountHash,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        savedAt: Date.now()
    };
    await chrome.storage.local.set({ [BROKER_SESSION_KEY]: session });
    return session;
}

export async function getBrokerSession(): Promise<StoredBrokerSession | null> {
    const data = await chrome.storage.local.get(BROKER_SESSION_KEY);
    const session = data[BROKER_SESSION_KEY] as StoredBrokerSession | undefined;
    if (!session || !session.accountHash || session.expiresAt <= Date.now()) {
        if (session) await clearBrokerSession();
        return null;
    }
    return session;
}

export async function clearBrokerSession(): Promise<void> {
    await chrome.storage.local.remove(BROKER_SESSION_KEY);
}

export async function clearAllSessions(): Promise<void> {
    await chrome.storage.local.remove([REMEMBER_SESSION_KEY, BROKER_SESSION_KEY]);
}
