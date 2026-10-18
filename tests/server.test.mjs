import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createHub, startCanvasServer } from "../.github/extensions/copilot-session-dj/server.mjs";
import { createSessionState } from "../.github/extensions/copilot-session-dj/session-state.mjs";

async function fixture(t, options = {}) {
    const hub = await createHub({ state: createSessionState(), ...options });
    const server = await startCanvasServer({ hub });
    t.after(() => server.close());
    const origin = new URL(server.url).origin;
    return { hub, server, post: (route, data = {}, headers = {}) => fetch(new URL(route, server.url), {
        method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...headers }, body: JSON.stringify(data),
    }) };
}

test("serves an accessible silent-start page and all local modules", async (t) => {
    const { server } = await fixture(t);
    const response = await fetch(server.url);
    const html = await response.text();
    assert.match(html, /lang="ja"/);
    assert.match(html, /id="start"[^>]*disabled/);
    assert.match(html, /id="start"[^>]*>DJ、スタート！<\/button>/);
    assert.match(html, /id="stop"[^>]*>.*いったんストップ<\/button>/);
    assert.match(html, /「DJ、スタート！」で音楽を再生します。自動では音は鳴りません。/);
    assert.match(response.headers.get("content-security-policy"), /default-src 'none'/);
    for (const path of ["app.mjs", "i18n.mjs", "audio-engine.mjs", "session-state.mjs", "presets.mjs", "music-mapping.mjs", "styles.css", "assets/icon.svg"]) {
        assert.equal((await fetch(new URL(path, server.url))).status, 200, path);
    }
    assert.equal((await fetch(new URL("../not-a-token/", server.url))).status, 404);
    assert.equal((await fetch(new URL("package.json", server.url))).status, 404);
});
test("rejects cross-origin, host spoofing, missing origin and invalid body", async (t) => {
    const { server, post } = await fixture(t);
    assert.equal((await post("settings", { volume: 0.3 }, { Origin: "https://attacker.invalid" })).status, 403);
    const hostStatus = await new Promise((resolve, reject) => {
        const req = request(server.url, { headers: { Host: "attacker.invalid" } }, (res) => {
            res.resume();
            resolve(res.statusCode);
        });
        req.on("error", reject);
        req.end();
    });
    assert.equal(hostStatus, 403);
    assert.equal((await fetch(new URL("stop", server.url), { method: "POST", body: "{}" })).status, 403);
    assert.equal((await post("settings", { volume: 9 })).status, 400);
    assert.equal((await post("settings", { code: "eval" })).status, 400);
    assert.equal((await post("settings", { preset: "x".repeat(3000) })).status, 413);
    assert.equal((await post("settings", {}, { "Content-Type": "text/plain" })).status, 415);
    const bad = await fetch(new URL("settings", server.url), { method: "POST",
        headers: { Origin: new URL(server.url).origin, "Content-Type": "application/json" }, body: "{" });
    assert.equal(bad.status, 400);
});
test("settings persist without live events or playback status and survive a new hub", async (t) => {
    const workspacePath = await mkdtemp(join(tmpdir(), "session-dj-settings-"));
    t.after(() => rm(workspacePath, { recursive: true, force: true }));
    const { post } = await fixture(t, { workspacePath });
    assert.equal((await post("settings", { preset: "chiptune", volume: 0.4 })).status, 200);
    const disk = JSON.parse(await readFile(join(workspacePath, "copilot-session-dj", "settings.json"), "utf8"));
    assert.deepEqual(disk, { preset: "chiptune", volume: 0.4, mischief: 0.55 });
    const restored = await createHub({ state: createSessionState(), workspacePath });
    assert.equal(restored.snapshot().settings.preset, "chiptune");
    assert.equal(restored.snapshot().owner, null);
});
test("serializes concurrent setting updates without losing fields", async () => {
    const hub = await createHub({ state: createSessionState() });
    await Promise.all([hub.configure({ volume: 0.4 }), hub.configure({ mischief: 0.8 })]);
    assert.deepEqual(hub.snapshot().settings, { preset: "lofi", volume: 0.4, mischief: 0.8 });
});
test("a second panel cannot claim audio and lease expiry requires a new claim", async (t) => {
    let clock = 0;
    const { hub, post } = await fixture(t, { now: () => clock });
    const a = randomUUID(), b = randomUUID();
    assert.equal((await post("claim", { client: a })).status, 200);
    assert.equal((await post("claim", { client: b })).status, 409);
    assert.equal((await post("heartbeat", { client: a })).status, 200);
    clock = 5001;
    assert.equal((await post("heartbeat", { client: a })).status, 409);
    assert.equal(hub.snapshot().owner, null);
    assert.equal((await post("claim", { client: b })).status, 200);
    assert.equal((await post("stop")).status, 200);
    assert.equal(hub.snapshot().owner, null);
});
test("closing the owning server releases audio for another panel", async (t) => {
    const { server, hub, post } = await fixture(t);
    await post("claim", { client: randomUUID() });
    assert.notEqual(hub.snapshot().owner, null);
    await server.close();
    assert.equal(hub.snapshot().owner, null);
});
test("SSE starts with a current snapshot and closes even with an active client", async (t) => {
    const { server, hub } = await fixture(t);
    const response = await fetch(new URL("events", server.url));
    assert.match(response.headers.get("content-type"), /text\/event-stream/);
    const reader = response.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    const snapshot = JSON.parse(first.slice(6));
    assert.deepEqual(snapshot.settings, hub.snapshot().settings);
    assert.equal(Object.hasOwn(snapshot, "events"), false);
    await server.close();
    assert.equal((await reader.read()).done, true);
});
