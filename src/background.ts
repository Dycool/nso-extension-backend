/**
 * Manifest V3 Background Service Worker for NSO WebApp.
 * Handles cross-origin Nintendo/nxapi operations and DeclarativeNetRequest dynamic rules.
 */
import { setupDefaultDnrRules } from './dnr/dnr-manager';
import {
    handleResumeSession,
    handleRememberSave,
    handleRememberForget,
    handleSessionStart,
    handleLogout
} from './handlers/auth-handlers';
import {
    handleCoralSession,
    handleGameToken,
    handleCoralCall,
    handleCoralBatch,
    handleProxy
} from './handlers/nxapi-handlers';
import {
    handleGameSessionCreate,
    handleGameTokenRenew,
    handleGameSessionClose
} from './handlers/game-handlers';

function setupCookieAutoFixListener() {
    if (typeof chrome === 'undefined' || !chrome.cookies || !chrome.cookies.onChanged) return;

    chrome.cookies.onChanged.addListener(async (changeInfo) => {
        if (changeInfo.removed) return;
        const cookie = changeInfo.cookie;
        if (!cookie) return;

        const isNintendoCookie = cookie.domain.includes('nintendo.net') || cookie.domain.includes('nintendo.com');
        if (!isNintendoCookie) return;

        // If cookie is already secure and cross-site enabled, avoid loop
        if (cookie.secure && cookie.sameSite === 'no_restriction') return;

        try {
            const domainClean = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
            const targetUrl = `https://${domainClean}${cookie.path || '/'}`;

            await chrome.cookies.set({
                url: targetUrl,
                name: cookie.name,
                value: cookie.value,
                domain: cookie.domain,
                path: cookie.path || '/',
                secure: true,
                sameSite: 'no_restriction',
                httpOnly: cookie.httpOnly,
                expirationDate: cookie.expirationDate
            });
        } catch (_) {}
    });
}

// Initialize DeclarativeNetRequest rules on startup and installation
chrome.runtime.onInstalled.addListener(() => {
    setupDefaultDnrRules();
    setupCookieAutoFixListener();
});

chrome.runtime.onStartup.addListener(() => {
    setupDefaultDnrRules();
    setupCookieAutoFixListener();
});

setupCookieAutoFixListener();

/**
 * Central Message Dispatcher for external WebApp (dycool.github.io / localhost)
 * and internal extension calls.
 */
async function dispatchMessage(msg: any): Promise<{ status: number; data: any; text?: string }> {
    const type = msg?.type || 'UNKNOWN';

    switch (type) {
        case 'NSO_PING':
            return {
                status: 200,
                data: {
                    status: 'ok',
                    version: '1.0.0',
                    service: 'NSO WebApp Extension Companion'
                }
            };

        case 'NSO_RESUME_SESSION':
            return handleResumeSession();

        case 'NSO_REMEMBER_SAVE':
            return handleRememberSave(msg);

        case 'NSO_REMEMBER_FORGET':
            return handleRememberForget();

        case 'NSO_SESSION_START':
            return handleSessionStart(msg);

        case 'NSO_SESSION_RELEASE':
            return { status: 200, data: { success: true } };

        case 'NSO_CORAL_SESSION':
            return handleCoralSession(msg);

        case 'NSO_GAME_TOKEN':
            return handleGameToken(msg);

        case 'NSO_GAME_TOKEN_CACHE':
            return { status: 200, data: { miss: true, needsNxapi: true, source: 'cache_miss' } };

        case 'NSO_CORAL_CALL':
            return handleCoralCall(msg);

        case 'NSO_CORAL_BATCH':
            return handleCoralBatch(msg);

        case 'NSO_PROXY':
            return handleProxy(msg);

        case 'NSO_GAME_SESSION_CREATE':
            return handleGameSessionCreate(msg);

        case 'NSO_GAME_TOKEN_RENEW':
            return handleGameTokenRenew(msg);

        case 'NSO_GAME_SESSION_CLOSE':
            return handleGameSessionClose();

        case 'NSO_LOGOUT':
            return handleLogout();

        default:
            return {
                status: 400,
                data: { error: 'unknown_message_type', type }
            };
    }
}

/**
 * Click handler for extension toolbar action icon.
 * Focuses existing WebApp tab or opens a new tab.
 */
if (typeof chrome !== 'undefined' && chrome.action?.onClicked) {
    chrome.action.onClicked.addListener(async () => {
        try {
            const tabs = await chrome.tabs.query({
                url: [
                    'https://dycool.github.io/nso-webapp*',
                    'http://localhost:*/*',
                    'http://127.0.0.1:*/*'
                ]
            });

            if (tabs && tabs.length > 0 && typeof tabs[0].id === 'number') {
                const targetId: number = tabs[0].id;
                await chrome.tabs.update(targetId, { active: true });
                if (typeof tabs[0].windowId === 'number') {
                    await chrome.windows.update(tabs[0].windowId, { focused: true });
                }
            } else {
                await chrome.tabs.create({ url: 'https://dycool.github.io/nso-webapp/' });
            }
        } catch (err) {
            console.warn('[Extension Action] Failed to navigate to WebApp tab:', err);
            try {
                await chrome.tabs.create({ url: 'https://dycool.github.io/nso-webapp/' });
            } catch (_) {}
        }
    });
}

// Listen for messages from externally_connectable web origins (dycool.github.io / localhost)
chrome.runtime.onMessageExternal.addListener((request, _sender, sendResponse) => {
    dispatchMessage(request)
        .then(result => sendResponse(result.data))
        .catch(err => sendResponse({ error: 'internal_extension_error', message: err?.message }));
    return true; // Keep channel open for async response
});

// Listen for internal extension messages
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    dispatchMessage(request)
        .then(result => sendResponse(result.data))
        .catch(err => sendResponse({ error: 'internal_extension_error', message: err?.message }));
    return true;
});
