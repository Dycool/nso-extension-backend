/**
 * DeclarativeNetRequest rules manager.
 * 1. Strips X-Frame-Options & CSP from Nintendo responses to allow iframe embedding in the webapp.
 * 2. Injects authentication headers (X-GameWebToken, X-Platform, User-Agent) on outbound game requests.
 */
import { isSmashWorldService, isNookLinkService, isSplatNet2Service } from '../services/service-policy';

export const STATIC_CSP_RULE_ID = 1001;
export const ACTIVE_GAME_SESSION_RULE_ID = 2001;
export const ACTIVE_GAME_SESSION_SUBRESOURCE_RULE_ID = 2002;

const DEFAULT_ANDROID_UA = 'Mozilla/5.0 (Linux; Android 10; Build/QP1A.190711.020; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/80.0.3987.162 Mobile Safari/537.36 com.nintendo.znca/3.4.1';
const NXAPI_IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.3 Mobile/15E148 Safari/604.1';

/**
 * Ensures baseline response header modification rules exist.
 * Removes frame-ancestors & X-Frame-Options on Nintendo origins.
 */
export async function setupDefaultDnrRules(): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.declarativeNetRequest) return;

    const baseRule: chrome.declarativeNetRequest.Rule = {
        id: STATIC_CSP_RULE_ID,
        priority: 1,
        action: {
            type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
            responseHeaders: [
                { header: 'x-frame-options', operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE },
                { header: 'content-security-policy', operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE },
                { header: 'content-security-policy-report-only', operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE },
                { header: 'cross-origin-embedder-policy', operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE },
                { header: 'cross-origin-opener-policy', operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE },
                { header: 'cross-origin-resource-policy', operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE }

            ]
        },
        condition: {
            requestDomains: ['nintendo.net', 'nintendo.com'],
            resourceTypes: [
                chrome.declarativeNetRequest.ResourceType.MAIN_FRAME,
                chrome.declarativeNetRequest.ResourceType.SUB_FRAME,
                chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
                chrome.declarativeNetRequest.ResourceType.SCRIPT,
                chrome.declarativeNetRequest.ResourceType.STYLESHEET,
                chrome.declarativeNetRequest.ResourceType.IMAGE,
                chrome.declarativeNetRequest.ResourceType.FONT,
                chrome.declarativeNetRequest.ResourceType.MEDIA,
                chrome.declarativeNetRequest.ResourceType.OTHER
            ]
        }
    };

    try {
        await chrome.declarativeNetRequest.updateSessionRules({
            removeRuleIds: [STATIC_CSP_RULE_ID],
            addRules: [baseRule]
        });
    } catch (err) {
        console.warn('[DnrManager] Failed to update session rules:', err);
    }
}

/**
 * Registers dynamic session headers for the currently launched game service.
 */
export async function updateGameSessionDnrRules(
    serviceId: string,
    serviceUri: string | undefined,
    token: string,
    language = 'en-US',
    country = 'US',
    cookieHeader?: string,
    zncaVersion = '3.4.1'
): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.declarativeNetRequest) return;

    const isSmash = isSmashWorldService(serviceId, serviceUri);
    const isNookLink = isNookLinkService(serviceId, serviceUri);
    const isSplatNet2 = isSplatNet2Service(serviceId, serviceUri);
    const effectiveUa = (isSmash || isNookLink) ? NXAPI_IOS_UA : DEFAULT_ANDROID_UA;

    const rulesToAdd: chrome.declarativeNetRequest.Rule[] = [];

    if (isSplatNet2) {
        // SplatNet 2: X-GameWebToken is only used to bootstrap the iksm_session cookie on document loads.
        // API/XHR calls must NOT receive X-GameWebToken or X-Requested-With: com.nintendo.znca.
        const frameHeaders: chrome.declarativeNetRequest.ModifyHeaderInfo[] = [
            { header: 'X-GameWebToken', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: token },
            { header: 'x-gamewebtoken', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: token },
            { header: 'x-appplatform', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: 'android' },
            { header: 'x-appcolorscheme', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: 'DARK' },
            { header: 'X-Requested-With', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: 'com.nintendo.znca' },
            { header: 'X-NACountry', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: country },
            { header: 'Accept-Language', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: language },
            { header: 'User-Agent', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: effectiveUa }
        ];

        const subresourceHeaders: chrome.declarativeNetRequest.ModifyHeaderInfo[] = [
            { header: 'x-appplatform', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: 'android' },
            { header: 'x-appcolorscheme', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: 'DARK' },
            { header: 'X-NACountry', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: country },
            { header: 'Accept-Language', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: language },
            { header: 'User-Agent', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: effectiveUa }
        ];

        rulesToAdd.push({
            id: ACTIVE_GAME_SESSION_RULE_ID,
            priority: 2,
            action: {
                type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
                requestHeaders: frameHeaders
            },
            condition: {
                requestDomains: ['splatoon2.nintendo.net'],
                resourceTypes: [
                    chrome.declarativeNetRequest.ResourceType.MAIN_FRAME,
                    chrome.declarativeNetRequest.ResourceType.SUB_FRAME
                ]
            }
        });

        rulesToAdd.push({
            id: ACTIVE_GAME_SESSION_SUBRESOURCE_RULE_ID,
            priority: 2,
            action: {
                type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
                requestHeaders: subresourceHeaders
            },
            condition: {
                requestDomains: ['splatoon2.nintendo.net'],
                resourceTypes: [
                    chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
                    chrome.declarativeNetRequest.ResourceType.SCRIPT,
                    chrome.declarativeNetRequest.ResourceType.STYLESHEET,
                    chrome.declarativeNetRequest.ResourceType.IMAGE,
                    chrome.declarativeNetRequest.ResourceType.FONT,
                    chrome.declarativeNetRequest.ResourceType.MEDIA,
                    chrome.declarativeNetRequest.ResourceType.OTHER
                ]
            }
        });
    } else {
        const requestHeaders: chrome.declarativeNetRequest.ModifyHeaderInfo[] = [
            { header: 'X-GameWebToken', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: token },
            { header: 'x-gamewebtoken', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: token },
            { header: 'x-appplatform', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: 'android' },
            { header: 'x-appcolorscheme', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: 'DARK' },
            { header: 'X-Requested-With', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: 'com.nintendo.znca' },
            { header: 'X-NACountry', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: country },
            { header: 'Accept-Language', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: language },
            { header: 'User-Agent', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: effectiveUa }
        ];

        if (cookieHeader && typeof cookieHeader === 'string' && cookieHeader.trim().length > 0) {
            requestHeaders.push({
                header: 'Cookie',
                operation: chrome.declarativeNetRequest.HeaderOperation.SET,
                value: cookieHeader.trim()
            });
        }

        const responseHeaders: chrome.declarativeNetRequest.ModifyHeaderInfo[] = [];
        if (cookieHeader && typeof cookieHeader === 'string' && cookieHeader.trim().length > 0) {
            responseHeaders.push({
                header: 'set-cookie',
                operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE
            });
        }

        rulesToAdd.push({
            id: ACTIVE_GAME_SESSION_RULE_ID,
            priority: 2,
            action: {
                type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
                requestHeaders,
                ...(responseHeaders.length > 0 ? { responseHeaders } : {})
            },
            condition: {
                requestDomains: ['nintendo.net', 'nintendo.com'],
                resourceTypes: [
                    chrome.declarativeNetRequest.ResourceType.MAIN_FRAME,
                    chrome.declarativeNetRequest.ResourceType.SUB_FRAME,
                    chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
                    chrome.declarativeNetRequest.ResourceType.SCRIPT,
                    chrome.declarativeNetRequest.ResourceType.STYLESHEET,
                    chrome.declarativeNetRequest.ResourceType.IMAGE,
                    chrome.declarativeNetRequest.ResourceType.FONT,
                    chrome.declarativeNetRequest.ResourceType.MEDIA,
                    chrome.declarativeNetRequest.ResourceType.OTHER
                ]
            }
        });
    }

    try {
        await chrome.declarativeNetRequest.updateSessionRules({
            removeRuleIds: [ACTIVE_GAME_SESSION_RULE_ID, ACTIVE_GAME_SESSION_SUBRESOURCE_RULE_ID],
            addRules: rulesToAdd
        });
    } catch (err) {
        console.warn('[DnrManager] Failed to set game session rules:', err);
    }
}

/**
 * Clears active game session rules when closing or switching games.
 */
export async function clearGameSessionDnrRules(): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.declarativeNetRequest) return;
    try {
        await chrome.declarativeNetRequest.updateSessionRules({
            removeRuleIds: [ACTIVE_GAME_SESSION_RULE_ID, ACTIVE_GAME_SESSION_SUBRESOURCE_RULE_ID]
        });
    } catch (err) {
        console.warn('[DnrManager] Failed to clear game session rules:', err);
    }
}
