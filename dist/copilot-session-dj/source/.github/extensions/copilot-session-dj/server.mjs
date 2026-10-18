import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_SETTINGS, validateSettings, mapMusic } from "./music-mapping.mjs";

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".mjs": "text/javascript", ".js": "text/javascript", ".json": "application/json", ".png": "image/png" };
const STATIC = {
    "": "ui/index.html", "app.mjs": "ui/app.mjs", "styles.css": "ui/styles.css",
    "audio-engine.mjs": "ui/audio-engine.mjs", "presets.mjs": "ui/presets.mjs", "i18n.mjs": "ui/i18n.mjs",
    "music-mapping.mjs": "music-mapping.mjs", "session-state.mjs": "session-state.mjs",
    "assets/strudel.bundle.mjs": "assets/strudel.bundle.mjs",
    "assets/assets/clockworker-ZDiUtESR.js": "assets/assets/clockworker-ZDiUtESR.js",
    "assets/icon.svg": "assets/icon.svg",
    "LICENSE": "LICENSE", "THIRD-PARTY-NOTICES": "THIRD-PARTY-NOTICES",
};
const LEASE_MS = 5000;

export async function createHub({ state, workspacePath, onError = () => {}, now = Date.now }) {
    let settings = { ...DEFAULT_SETTINGS };
    let storageError = workspacePath ? null : "Session workspace unavailable: preferences cannot be saved.";
    const settingsPath = workspacePath ? join(workspacePath, "copilot-session-dj", "settings.json") : null;
    if (settingsPath) {
        try {
            settings = validateSettings(JSON.parse(await readFile(settingsPath, "utf8")), { partial: false });
        } catch (error) {
            if (error.code !== "ENOENT") {
                storageError = `Cannot load preferences: ${error.message}`;
                onError(storageError);
            }
        }
    }
    let revision = 0;
    let stopVersion = 0;
    let owner = null;
    let leaseUntil = 0;
    let writeQueue = Promise.resolve();
    const listeners = new Set();
    const source = { url: "https://github.com/nomhiro/copilot-session-jam", license: "AGPL-3.0-or-later" };
    function expire() {
        if (owner && now() >= leaseUntil) {
            owner = null;
            stopVersion++;
            revision++;
        }
    }
    const hub = {
        snapshot() {
            expire();
            const live = state.snapshot();
            return { revision, at: now(), live, music: mapMusic(live, settings), settings: { ...settings },
                storageError, owner, stopVersion, source, leaseMs: LEASE_MS };
        },
        publish() {
            const snapshot = hub.snapshot();
            for (const listener of listeners) listener(snapshot);
        },
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        async configure(input) {
            const patch = validateSettings(input);
            const task = writeQueue.then(async () => {
                const next = { ...settings, ...patch };
                if (settingsPath) {
                    const folder = join(workspacePath, "copilot-session-dj");
                    const temp = `${settingsPath}.${randomBytes(6).toString("hex")}.tmp`;
                    try {
                        await mkdir(folder, { recursive: true });
                        await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
                        await rename(temp, settingsPath);
                        storageError = null;
                    } catch (error) {
                        storageError = "Preferences could not be saved. Previous settings are unchanged.";
                        onError(storageError);
                        throw error;
                    }
                }
                settings = next;
                revision++;
                hub.publish();
                return hub.snapshot();
            });
            writeQueue = task.catch(() => {});
            return task;
        },
        claim(client) {
            expire();
            if (owner && owner !== client) throw Object.assign(new Error("Another DJ booth owns the audio. Stop it first or wait for its lease to expire."), { status: 409 });
            owner = client;
            leaseUntil = now() + LEASE_MS;
            revision++;
            hub.publish();
            return hub.snapshot();
        },
        heartbeat(client) {
            expire();
            if (owner !== client) throw Object.assign(new Error("Audio lease expired. Start again explicitly."), { status: 409 });
            leaseUntil = now() + LEASE_MS;
            return hub.snapshot();
        },
        release(client) {
            if (owner === client) { owner = null; revision++; hub.publish(); }
        },
        stop() {
            owner = null;
            stopVersion++;
            revision++;
            hub.publish();
            return hub.snapshot();
        },
    };
    return hub;
}

async function jsonBody(req) {
    if (req.headers["content-type"] !== "application/json") throw Object.assign(new Error("Expected application/json."), { status: 415 });
    let text = "";
    for await (const chunk of req) {
        text += chunk;
        if (Buffer.byteLength(text) > 2048) throw Object.assign(new Error("Request body too large."), { status: 413 });
    }
    let data;
    try { data = JSON.parse(text); } catch { throw Object.assign(new Error("Invalid JSON."), { status: 400 }); }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw Object.assign(new Error("Expected an object."), { status: 400 });
    return data;
}

export async function startCanvasServer({ hub, onError = () => {} }) {
    const token = randomBytes(24).toString("hex");
    const prefix = `/${token}/`;
    const clients = new Set();
    const owners = new Set();
    let origin;
    function send(res, status, data) {
        res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(data));
    }
    const server = createServer(async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self' blob: data:; style-src 'self'; connect-src 'self'; img-src 'self'; worker-src 'self' blob: data:; base-uri 'none'; form-action 'none'");
        try {
            if (req.headers.host !== new URL(origin).host) return send(res, 403, { error: "Invalid Host." });
            if (req.headers.origin && req.headers.origin !== origin) return send(res, 403, { error: "Invalid Origin." });
            const url = new URL(req.url, origin);
            if (!url.pathname.startsWith(prefix)) return send(res, 404, { error: "Not found." });
            const route = url.pathname.slice(prefix.length);
            if (req.method === "GET" && route === "state") return send(res, 200, hub.snapshot());
            if (req.method === "GET" && route === "events") {
                if (clients.size >= 8) return send(res, 429, { error: "Too many connections." });
                res.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive" });
                res.write(`data: ${JSON.stringify(hub.snapshot())}\n\n`);
                clients.add(res);
                req.on("close", () => clients.delete(res));
                return;
            }
            if (req.method === "GET" && Object.hasOwn(STATIC, route)) {
                const path = STATIC[route];
                const data = await readFile(new URL(path, import.meta.url));
                const suffix = path.slice(path.lastIndexOf("."));
                res.writeHead(200, { "Content-Type": MIME[suffix] ?? "text/plain; charset=utf-8" });
                return res.end(data);
            }
            if (req.method === "POST") {
                if (req.headers.origin !== origin) return send(res, 403, { error: "Origin required." });
                const data = await jsonBody(req);
                if (route === "settings") {
                    try { validateSettings(data); } catch (error) { return send(res, 400, { error: error.message }); }
                    return send(res, 200, await hub.configure(data));
                }
                if (["claim", "heartbeat", "release"].includes(route)) {
                    if (Object.keys(data).some((key) => key !== "client") || !/^[a-f0-9-]{36}$/.test(data.client ?? "")) {
                        return send(res, 400, { error: "Invalid client ID." });
                    }
                    const identity = data.client;
                    if (route === "claim") { const result = hub.claim(identity); owners.add(identity); return send(res, 200, result); }
                    if (route === "heartbeat") return send(res, 200, hub.heartbeat(identity));
                    hub.release(identity);
                    owners.delete(identity);
                    return send(res, 200, hub.snapshot());
                }
                if (route === "stop" && Object.keys(data).length === 0) return send(res, 200, hub.stop());
            }
            send(res, 404, { error: "Not found." });
        } catch (error) {
            const status = error.status ?? 500;
            if (status === 500) onError(`Canvas request failed: ${error.code ?? error.name}`);
            if (!res.headersSent) send(res, status, { error: status === 500 ? "Local request failed. Check extension logs; build audio assets if missing." : error.message });
            else res.end();
        }
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    origin = `http://127.0.0.1:${server.address().port}`;
    const unsubscribe = hub.subscribe((state) => {
        for (const client of clients) {
            if (client.writableLength > 65536) { client.destroy(); clients.delete(client); }
            else client.write(`data: ${JSON.stringify(state)}\n\n`);
        }
    });
    return {
        url: `${origin}${prefix}`,
        async close() {
            unsubscribe();
            for (const owner of owners) hub.release(owner);
            for (const client of clients) client.end();
            clients.clear();
            await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
        },
    };
}
