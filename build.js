const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const isWatch = process.argv.includes('--watch');
const shouldZip = process.argv.includes('--zip');

function createZipArchive(sourceDir, outputFile) {
    const files = [];
    function scan(dir, relPath = '') {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const fullPath = path.join(dir, entry.name);
            const entryRel = relPath ? `${relPath}/${entry.name}` : entry.name;
            if (entry.isDirectory()) scan(fullPath, entryRel);
            else if (entry.isFile()) files.push({ fullPath, relPath: entryRel });
        }
    }
    scan(sourceDir);

    const now = new Date();
    const time = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
    const date = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

    const localHeaders = [];
    const centralEntries = [];
    let offset = 0;

    for (const file of files) {
        const raw = fs.readFileSync(file.fullPath);
        const crc = typeof zlib.crc32 === 'function' ? zlib.crc32(raw) : 0;
        const compressed = zlib.deflateRawSync(raw);
        const useDeflate = compressed.length < raw.length;
        const payload = useDeflate ? compressed : raw;
        const method = useDeflate ? 8 : 0;
        const nameBuf = Buffer.from(file.relPath.replace(/\\/g, '/'), 'utf8');

        const localHeader = Buffer.alloc(30 + nameBuf.length);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(0x0800, 6);
        localHeader.writeUInt16LE(method, 8);
        localHeader.writeUInt16LE(time, 10);
        localHeader.writeUInt16LE(date, 12);
        localHeader.writeUInt32LE(crc, 14);
        localHeader.writeUInt32LE(payload.length, 18);
        localHeader.writeUInt32LE(raw.length, 22);
        localHeader.writeUInt16LE(nameBuf.length, 26);
        localHeader.writeUInt16LE(0, 28);
        nameBuf.copy(localHeader, 30);

        localHeaders.push(localHeader, payload);

        const centralEntry = Buffer.alloc(46 + nameBuf.length);
        centralEntry.writeUInt32LE(0x02014b50, 0);
        centralEntry.writeUInt16LE(0x0014, 4);
        centralEntry.writeUInt16LE(20, 6);
        centralEntry.writeUInt16LE(0x0800, 8);
        centralEntry.writeUInt16LE(method, 10);
        centralEntry.writeUInt16LE(time, 12);
        centralEntry.writeUInt16LE(date, 14);
        centralEntry.writeUInt32LE(crc, 16);
        centralEntry.writeUInt32LE(payload.length, 20);
        centralEntry.writeUInt32LE(raw.length, 24);
        centralEntry.writeUInt16LE(nameBuf.length, 28);
        centralEntry.writeUInt16LE(0, 30);
        centralEntry.writeUInt16LE(0, 32);
        centralEntry.writeUInt16LE(0, 34);
        centralEntry.writeUInt16LE(0, 36);
        centralEntry.writeUInt32LE(0, 38);
        centralEntry.writeUInt32LE(offset, 42);
        nameBuf.copy(centralEntry, 46);

        centralEntries.push(centralEntry);
        offset += localHeader.length + payload.length;
    }

    const centralDirOffset = offset;
    const centralDirSize = centralEntries.reduce((sum, b) => sum + b.length, 0);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(centralDirSize, 12);
    eocd.writeUInt32LE(centralDirOffset, 16);
    eocd.writeUInt16LE(0, 20);

    const finalZip = Buffer.concat([...localHeaders, ...centralEntries, eocd]);
    fs.writeFileSync(outputFile, finalZip);
    console.log(`[zip] Created ${path.basename(outputFile)} (${finalZip.length} bytes) with ${files.length} files.`);
}

async function build() {
    const dist = path.resolve(__dirname, 'dist');
    if (!fs.existsSync(dist)) fs.mkdirSync(dist, { recursive: true });

    // Copy manifest.json to dist
    fs.copyFileSync(
        path.resolve(__dirname, 'manifest.json'),
        path.resolve(dist, 'manifest.json')
    );

    // Copy icons to dist/icons
    const iconsSrc = path.resolve(__dirname, 'icons');
    const iconsDist = path.resolve(dist, 'icons');
    if (fs.existsSync(iconsSrc)) {
        if (!fs.existsSync(iconsDist)) fs.mkdirSync(iconsDist, { recursive: true });
        for (const file of fs.readdirSync(iconsSrc)) {
            fs.copyFileSync(path.join(iconsSrc, file), path.join(iconsDist, file));
        }
    }

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

        if (shouldZip) {
            const zipOut = path.resolve(__dirname, 'nso-extension-backend.zip');
            createZipArchive(dist, zipOut);
        }
    }
}

build().catch((err) => {
    console.error(err);
    process.exit(1);
});
