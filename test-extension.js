const fs = require('fs');
const path = require('path');

function read(file) {
    return fs.readFileSync(path.join(__dirname, file), 'utf8');
}

function assert(condition, message) {
    if (!condition) {
        console.error('FAIL:', message);
        process.exit(1);
    }
    console.log('PASS:', message);
}

console.log('--- Running NSO Extension Backend Test Suite ---');

// 1. Manifest V3 Validation
const manifestRaw = read('manifest.json');
const manifest = JSON.parse(manifestRaw);

assert(manifest.manifest_version === 3, 'Manifest version is 3 (MV3)');
assert(manifest.background?.service_worker === 'background.js', 'Background worker points to background.js');
assert(manifest.background?.type === 'module', 'Background worker is configured as ES module');
assert(manifest.permissions?.includes('declarativeNetRequest'), 'Permission declarativeNetRequest is declared');
assert(manifest.permissions?.includes('storage'), 'Permission storage is declared');

// Host permissions
const hostPerms = manifest.host_permissions || [];
assert(hostPerms.some(h => h.includes('accounts.nintendo.com')), 'Host permissions include Nintendo Accounts');
assert(hostPerms.some(h => h.includes('nintendo.net')), 'Host permissions include Nintendo Coral/WebViews');
assert(hostPerms.some(h => h.includes('fancy.org.uk')), 'Host permissions include nxapi API endpoints');

// Externally connectable
const extConnect = manifest.externally_connectable?.matches || [];
assert(extConnect.some(m => m.includes('dycool.github.io')), 'Externally connectable permits dycool.github.io');
assert(extConnect.some(m => m.includes('localhost')), 'Externally connectable permits localhost');

// Content scripts
assert(Array.isArray(manifest.content_scripts) && manifest.content_scripts.length > 0, 'Content scripts are declared');
assert(manifest.content_scripts[0].world === 'MAIN', 'Bridge content script runs in world: MAIN');
assert(manifest.content_scripts[0].run_at === 'document_start', 'Bridge content script runs at document_start');

// 2. Dist Build Artifacts
assert(fs.existsSync(path.join(__dirname, 'dist/background.js')), 'dist/background.js is built');
assert(fs.existsSync(path.join(__dirname, 'dist/bridge-content-script.js')), 'dist/bridge-content-script.js is built');
assert(fs.existsSync(path.join(__dirname, 'dist/manifest.json')), 'dist/manifest.json is copied');

const bgDist = read('dist/background.js');
assert(bgDist.includes('NSO_PING'), 'Background worker handles NSO_PING message');
assert(bgDist.includes('NSO_RESUME_SESSION'), 'Background worker handles NSO_RESUME_SESSION');
assert(bgDist.includes('NSO_CORAL_SESSION'), 'Background worker handles NSO_CORAL_SESSION');
assert(bgDist.includes('NSO_GAME_TOKEN'), 'Background worker handles NSO_GAME_TOKEN');
assert(bgDist.includes('NSO_CORAL_CALL'), 'Background worker handles NSO_CORAL_CALL');
assert(bgDist.includes('NSO_GAME_SESSION_CREATE'), 'Background worker handles NSO_GAME_SESSION_CREATE');

const csDist = read('dist/bridge-content-script.js');
assert(csDist.includes('invokeMethod'), 'Bridge content script defines invokeMethod handler');
assert(csDist.includes('NSO_ZNCA_BRIDGE_EVENT'), 'Bridge content script dispatches events to host');

// 3. DeclarativeNetRequest Manager
const dnrCode = read('src/dnr/dnr-manager.ts');
assert(dnrCode.includes('STATIC_CSP_RULE_ID = 1001'), 'DNR defines static CSP stripping rule');
assert(dnrCode.includes('ACTIVE_GAME_SESSION_RULE_ID = 2001'), 'DNR defines dynamic active game session rule');
assert(dnrCode.includes('X-GameWebToken'), 'DNR modifies X-GameWebToken header on outbound game traffic');
assert(dnrCode.includes('x-frame-options'), 'DNR strips x-frame-options header on inbound game traffic');
assert(dnrCode.includes('content-security-policy'), 'DNR strips content-security-policy header on inbound game traffic');

// 4. nxapi Core Integration
const coralCode = read('src/nxapi/coral.ts');
assert(coralCode.includes('acquireCoralSessionFast'), 'nxapi Coral session pipeline is present');
assert(coralCode.includes('acquireGameWebServiceTokenFast'), 'nxapi GameWebServiceToken pipeline is present');
assert(coralCode.includes('performCoralApiCallFast'), 'nxapi Coral call pipeline is present');

const sharedF2Code = read('src/nxapi/shared-f2.ts');
assert(sharedF2Code.includes('generateSharedMethod2Attestation'), 'Shared method-2 f attestation is present');

console.log('All extension tests passed successfully!');
