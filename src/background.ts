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
    handleCoralBatch
} from './handlers/nxapi-handlers';
import {
    handleGameSessionCreate,
    handleGameTokenRenew,
    handleGameSessionClose
} from './handlers/game-handlers';

// Initialize DeclarativeNetRequest rules on startup and installation
chrome.runtime.onInstalled.addListener(() => {
    setupDefaultDnrRules();
});

chrome.runtime.onStartup.addListener(() => {
    setupDefaultDnrRules();
});

/**
 * Central Message Dispatcher for external WebApp (dycool.github.io / localhost)
 * and internal extension calls.
 */
async function dispatchMessage(msg: any): Promise<{ status: number; data: any }> {
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
