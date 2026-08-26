const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isWatch = process.argv.includes('--watch');

async function build() {
    const dist = path.resolve(__dirname, 'dist');
    if (!fs.existsSync(dist)) fs.mkdirSync(dist, { recursive: true });

    // Copy manifest.json to dist
    fs.copyFileSync(
        path.resolve(__dirname, 'manifest.json'),
        path.resolve(dist, 'manifest.json')
    );

    const backgroundConfig = {
        entryPoints: [path.resolve(__dirname, 'src/background.ts')],
        bundle: true,
        outfile: path.resolve(dist, 'background.js'),
        format: 'esm',
        target: 'es2022',
        platform: 'browser',
        sourcemap: true,
        minify: !isWatch
    };

    const contentConfig = {
        entryPoints: [path.resolve(__dirname, 'src/content/bridge-content-script.ts')],
        bundle: true,
        outfile: path.resolve(dist, 'bridge-content-script.js'),
        format: 'iife',
        target: 'es2022',
        platform: 'browser',
        sourcemap: true,
        minify: !isWatch
    };

    if (isWatch) {
        const bgCtx = await esbuild.context(backgroundConfig);
        const csCtx = await esbuild.context(contentConfig);
        await Promise.all([bgCtx.watch(), csCtx.watch()]);
        console.log('[esbuild] Watching for extension changes...');
    } else {
        await Promise.all([
            esbuild.build(backgroundConfig),
            esbuild.build(contentConfig)
        ]);
        console.log('[esbuild] Extension bundle successfully created in dist/');
    }
}

build().catch((err) => {
    console.error(err);
    process.exit(1);
});
