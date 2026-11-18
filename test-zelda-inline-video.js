const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

async function main() {
    let pathname = '/title-select';
    let fullscreenCalls = 0;
    let webkitCalls = 0;
    let playCalls = 0;
    class Media {
        play() { playCalls++; return Promise.resolve(); }
    }
    class Video extends Media {
        constructor() { super(); this.playsInline = true; }
        requestFullscreen() { fullscreenCalls++; return Promise.resolve(); }
        webkitEnterFullscreen() { webkitCalls++; }
    }
    const source = fs.readFileSync(path.join(__dirname, 'src/content/zelda-inline-video.ts'), 'utf8');
    const code = esbuild.transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
    const module = { exports: {} };
    const context = {
        module, exports: module.exports,
        HTMLMediaElement: Media, HTMLVideoElement: Video,
        location: { get pathname() { return pathname; } },
        Promise, WeakSet, queueMicrotask
    };
    vm.runInNewContext(code, context);
    module.exports.installZeldaInlineVideoGuard();

    const video = new Video();
    pathname = '/oot/trajectory-of-time';
    const playing = video.play();
    const automaticFullscreen = video.requestFullscreen();
    video.webkitEnterFullscreen();
    await automaticFullscreen;
    await playing;
    assert.equal(fullscreenCalls, 0, 'Immediate fullscreen after play is prevented');
    assert.equal(webkitCalls, 0, 'Immediate WebKit fullscreen after play is prevented');
    assert.equal(playCalls, 1, 'Video playback still starts');

    await video.requestFullscreen();
    video.webkitEnterFullscreen();
    assert.equal(fullscreenCalls, 1, 'Later manual fullscreen is allowed');
    assert.equal(webkitCalls, 1, 'Later manual WebKit fullscreen is allowed');

    pathname = '/botw/other';
    video.play();
    await video.requestFullscreen();
    assert.equal(fullscreenCalls, 2, 'Other Zelda routes are unaffected');

    pathname = '/oot/trajectory-of-time';
    const unrelated = new Video();
    unrelated.playsInline = false;
    unrelated.play();
    await unrelated.requestFullscreen();
    assert.equal(fullscreenCalls, 3, 'Unrelated videos are unaffected');
    assert.equal(playCalls, 3, 'All video play calls still work');
    console.log('Zelda Notes inline video tests passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
