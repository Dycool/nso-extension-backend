/**
 * The Ocarina of Time video player calls play() and requestFullscreen() in
 * the same synchronous handler. Suppress only that immediate fullscreen
 * request, leaving later manual fullscreen actions fully functional.
 * Installed at document_start in the MAIN world on Zelda Notes pages.
 */
export function installZeldaInlineVideoGuard(): void {
    if (typeof HTMLVideoElement === 'undefined' || typeof HTMLMediaElement === 'undefined') return;
    const videoPrototype = HTMLVideoElement.prototype;
    const mediaPrototype = HTMLMediaElement.prototype;
    const nativePlay = mediaPrototype.play;
    const nativeRequestFullscreen = videoPrototype.requestFullscreen;
    const nativeWebkitEnterFullscreen = (videoPrototype as any).webkitEnterFullscreen;
    if (typeof nativePlay !== 'function') return;

    const justStarted = new WeakSet<HTMLVideoElement>();
    function isOotPlayer(video: HTMLVideoElement): boolean {
        return /^\/oot(?:\/|$)/i.test(location.pathname) && video.playsInline;
    }

    // Avoid overriding play() if no fullscreen wrapper could be installed.
    let installed = false;
    if (typeof nativeRequestFullscreen === 'function') {
        try {
            Object.defineProperty(videoPrototype, 'requestFullscreen', {
                configurable: true,
                writable: true,
                value: function(this: HTMLVideoElement, ...args: any[]): Promise<void> {
                    if (justStarted.has(this)) return Promise.resolve();
                    return (nativeRequestFullscreen as any).apply(this, args);
                }
            });
            installed = true;
        } catch (_) {}
    }
    if (typeof nativeWebkitEnterFullscreen === 'function') {
        try {
            Object.defineProperty(videoPrototype, 'webkitEnterFullscreen', {
                configurable: true,
                writable: true,
                value: function(this: HTMLVideoElement, ...args: any[]): void {
                    if (justStarted.has(this)) return;
                    return nativeWebkitEnterFullscreen.apply(this, args);
                }
            });
            installed = true;
        } catch (_) {}
    }
    if (!installed) return;

    mediaPrototype.play = function(this: HTMLMediaElement, ...args: any[]): Promise<void> {
        if (this instanceof HTMLVideoElement && isOotPlayer(this)) {
            justStarted.add(this);
            // The unwanted fullscreen request happens synchronously after play().
            // Any later user action occurs after this microtask.
            queueMicrotask(() => justStarted.delete(this));
        }
        return (nativePlay as any).apply(this, args);
    };
}
