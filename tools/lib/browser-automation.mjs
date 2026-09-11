import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg'
};


async function pathExists(candidate) {
    try {
        await fs.access(candidate);
        return true;
    } catch {
        return false;
    }
}

async function resolveCommand(candidate) {
    if (!candidate) return null;
    if (candidate.includes(path.sep) || path.isAbsolute(candidate)) return await pathExists(candidate) ? candidate : null;
    const extensions = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
    for (const directory of String(process.env.PATH || '').split(path.delimiter)) {
        if (!directory) continue;
        for (const extension of extensions) {
            const absolute = path.join(directory, `${candidate}${extension}`);
            if (await pathExists(absolute)) return absolute;
        }
    }
    return null;
}

async function resolveChromiumExecutable(preferred) {
    if (preferred) {
        const resolved = await resolveCommand(preferred);
        if (resolved) return resolved;
        throw new Error(`Chromium executable not found: ${preferred}`);
    }
    const candidates = [];
    if (process.env.CHROMIUM_PATH) candidates.push(process.env.CHROMIUM_PATH);
    if (process.platform === 'win32') {
        const programFiles = process.env.PROGRAMFILES || String.raw`C:\Program Files`;
        const programFilesX86 = process.env['PROGRAMFILES(X86)'] || String.raw`C:\Program Files (x86)`;
        const localAppData = process.env.LOCALAPPDATA || '';
        candidates.push(
            path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
            path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
        );
    } else if (process.platform === 'darwin') {
        candidates.push(
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
        );
    } else {
        candidates.push('chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable');
    }

    for (const candidate of candidates) {
        const resolved = await resolveCommand(candidate);
        if (resolved) return resolved;
    }
    throw new Error('No Chromium-based browser was found. Set CHROMIUM_PATH or pass --chromium <path>.');
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


async function removeDirectoryWithRetry(directory) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
            await fs.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
            return;
        } catch (error) {
            if (attempt === 7) throw error;
            await sleep(150);
        }
    }
}

function findFreePort() {
    return new Promise((resolve, reject) => {
        const server = http.createServer();
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(error => error ? reject(error) : resolve(port));
        });
        server.on('error', reject);
    });
}

export async function startStaticServer(root, { uploadDirectory = null } = {}) {
    const server = http.createServer(async (request, response) => {
        try {
            const parsed = new URL(request.url, 'http://127.0.0.1');
            if (parsed.pathname === '/__kinetic_capture' && request.method === 'POST' && uploadDirectory) {
                const requestedName = String(request.headers['x-kinetic-filename'] || 'capture.webm');
                const fileName = path.basename(requestedName).replace(/[^a-z0-9._-]+/gi, '_') || 'capture.webm';
                await fs.mkdir(uploadDirectory, { recursive: true });
                const destination = path.join(uploadDirectory, fileName);
                await new Promise((resolve, reject) => {
                    const output = createWriteStream(destination, { flags: 'w' });
                    request.pipe(output);
                    request.once('error', reject);
                    output.once('error', reject);
                    output.once('finish', resolve);
                });
                const stat = await fs.stat(destination);
                response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
                response.end(JSON.stringify({ ok: true, fileName, bytes: stat.size }));
                return;
            }
            const decoded = decodeURIComponent(parsed.pathname === '/' ? '/index.html' : parsed.pathname);
            const resolvedRoot = path.resolve(root);
            const absolute = path.resolve(resolvedRoot, `.${decoded}`);
            const relative = path.relative(resolvedRoot, absolute);
            if (relative.startsWith('..') || path.isAbsolute(relative)) {
                response.writeHead(403).end('Forbidden');
                return;
            }
            const stat = await fs.stat(absolute);
            const filePath = stat.isDirectory() ? path.join(absolute, 'index.html') : absolute;
            const data = await fs.readFile(filePath);
            response.writeHead(200, {
                'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
                'Cache-Control': 'no-store'
            });
            response.end(data);
        } catch {
            response.writeHead(404).end('Not found');
        }
    });
    const port = await findFreePort();
    await new Promise((resolve, reject) => {
        server.listen(port, '127.0.0.1', resolve);
        server.on('error', reject);
    });
    return { server, port, url: `http://127.0.0.1:${port}` };
}

class CdpClient {
    constructor(socket) {
        this.socket = socket;
        this.nextId = 1;
        this.pending = new Map();
        socket.addEventListener('message', message => {
            const data = JSON.parse(message.data);
            if (!data.id) return;
            const pending = this.pending.get(data.id);
            if (!pending) return;
            this.pending.delete(data.id);
            if (data.error) pending.reject(new Error(data.error.message));
            else pending.resolve(data.result);
        });
        socket.addEventListener('close', () => {
            for (const pending of this.pending.values()) pending.reject(new Error('Chrome DevTools connection closed.'));
            this.pending.clear();
        });
    }

    call(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = this.nextId++;
            this.pending.set(id, { resolve, reject });
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }

    async evaluate(expression, { awaitPromise = true } = {}) {
        const result = await this.call('Runtime.evaluate', {
            expression,
            awaitPromise,
            returnByValue: true,
            userGesture: false
        });
        if (result.exceptionDetails) {
            throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed.');
        }
        return result.result.value;
    }

    close() {
        this.socket.close();
    }
}

export async function launchAutomationBrowser({ url, width = 1080, height = 1920, chromium = null, downloadDir = null, headless = true }) {
    const chromiumExecutable = await resolveChromiumExecutable(chromium);
    const debugPort = await findFreePort();
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kinetic-chrome-'));
    const chromeArgs = [
        ...(headless ? ['--headless=new'] : []),
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=CalculateNativeWinOcclusion',
        '--enable-gpu-rasterization',
        '--enable-zero-copy',
        '--ignore-gpu-blocklist',
        '--enable-features=CanvasOopRasterization',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-sync',
        '--hide-scrollbars',
        '--no-proxy-server',
        '--proxy-bypass-list=*',
        '--autoplay-policy=no-user-gesture-required',
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${userDataDir}`,
        `--window-size=${width},${height}`,
        '--force-device-scale-factor=1',
        url
    ];
    const chrome = spawn(chromiumExecutable, chromeArgs, { stdio: ['ignore', 'ignore', 'pipe'] });

    let stderr = '';
    let launchError = null;
    chrome.stderr.on('data', chunk => { stderr += chunk.toString(); });
    chrome.on('error', error => { launchError = error; });
    let target = null;
    for (let attempt = 0; attempt < 120; attempt += 1) {
        try {
            const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
            const targets = await response.json();
            target = targets.find(candidate => candidate.type === 'page' && candidate.url.startsWith(url))
                || targets.find(candidate => candidate.type === 'page');
            if (target?.webSocketDebuggerUrl) break;
        } catch {}
        if (launchError) throw launchError;
        if (chrome.exitCode !== null) throw new Error(`Chromium exited early. ${stderr}`);
        await sleep(100);
    }
    if (!target?.webSocketDebuggerUrl) {
        chrome.kill('SIGKILL');
        throw new Error(`Unable to connect to Chromium DevTools. ${stderr}`);
    }

    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', reject, { once: true });
    });
    const client = new CdpClient(socket);
    await client.call('Page.enable');
    await client.call('Runtime.enable');
    if (downloadDir) {
        await fs.mkdir(downloadDir, { recursive: true });
        const downloadPath = path.resolve(downloadDir);
        try {
            await client.call('Browser.setDownloadBehavior', {
                behavior: 'allow', downloadPath, eventsEnabled: true
            });
        } catch {
            await client.call('Page.setDownloadBehavior', { behavior: 'allow', downloadPath });
        }
    }
    await client.call('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
        screenWidth: width,
        screenHeight: height
    });

    let arenaReady = false;
    for (let attempt = 0; attempt < 300; attempt += 1) {
        try {
            arenaReady = await client.evaluate('Boolean(window.KineticArena)');
            if (arenaReady) break;
        } catch {}
        await sleep(50);
    }
    if (!arenaReady) {
        let details = '';
        try {
            details = await client.evaluate(`JSON.stringify({
                url: location.href,
                readyState: document.readyState,
                body: document.body?.innerText,
                loading: document.getElementById('loading-status')?.textContent
            })`);
        } catch {}
        client.close();
        if (chrome.exitCode === null) chrome.kill('SIGKILL');
        await Promise.race([new Promise(resolve => chrome.once('exit', resolve)), sleep(2000)]);
        await removeDirectoryWithRetry(userDataDir);
        throw new Error(`Kinetic Arena did not finish browser bootstrap. ${details}`);
    }

    return {
        client,
        chrome,
        userDataDir,
        async capturePng() {
            const result = await client.call('Page.captureScreenshot', {
                format: 'png',
                fromSurface: true,
                captureBeyondViewport: false
            });
            return Buffer.from(result.data, 'base64');
        },
        async close() {
            client.close();
            if (chrome.exitCode === null) chrome.kill('SIGTERM');
            await Promise.race([
                new Promise(resolve => chrome.once('exit', resolve)),
                sleep(2000).then(() => { if (chrome.exitCode === null) chrome.kill('SIGKILL'); })
            ]);
            await removeDirectoryWithRetry(userDataDir);
        }
    };
}
