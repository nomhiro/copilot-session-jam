import { AudioEngine } from "./audio-engine.mjs";
import { createSessionState } from "./session-state.mjs";
import { mapMusic, SCENES } from "./music-mapping.mjs";
import { describePattern, PRESET_NAMES } from "./presets.mjs";
import { resolveLanguage, translateDocument } from "./i18n.mjs";

const $ = (id) => document.getElementById(id);
let savedLanguage;
try { savedLanguage = localStorage.getItem("session-dj-language"); }
catch (error) { console.warn("Language preference could not be read.", error); }
let language = resolveLanguage(savedLanguage, navigator.languages);
function localize() {
    document.documentElement.lang = language;
    translateDocument(document.body, language);
}
$("language").value = language;
$("language").addEventListener("change", () => {
    language = $("language").value;
    try { localStorage.setItem("session-dj-language", language); }
    catch (error) { console.warn("Language preference could not be saved.", error); showError(new Error("Language preference could not be saved.")); }
    localize();
});
new MutationObserver(localize).observe(document.body, { childList: true, characterData: true, subtree: true });
localize();
const client = crypto.randomUUID();
const identity = client;
let snapshot;
let connected = false;
let starting = false;
let stopping = false;
let attempt = 0;
let stopVersion;
let lastHeartbeat = 0;
let leaseActive = false;
let demo = createSessionState();
let sequence = 0;
let demoScene;
let heartbeatBusy = false;
let saving = Promise.resolve();

function showError(error) {
    $("error").textContent = error.message ?? String(error);
    $("error").hidden = false;
}
async function post(route, data = {}) {
    const response = await fetch(new URL(route, location.href), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
        signal: AbortSignal.timeout(3000),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    return body;
}
const audio = new AudioEngine({ onError: (error) => {
    showError(error);
    void stopPlayback("音声エラーで停止しました。");
} });
const isDemo = () => $("mode").value === "demo";
function current() {
    const state = isDemo() ? demo.snapshot() : snapshot.live;
    return { state, music: mapMusic(state, snapshot.settings) };
}
function render() {
    if (!snapshot) return;
    const { state, music } = current();
    const [title, description] = SCENES[music.scene];
    $("track-title").textContent = PRESET_NAMES[music.preset];
    $("scene-title").textContent = title;
    $("scene-description").textContent = description;
    $("bpm").textContent = `${music.bpm} BPM`;
    $("tools").textContent = state.tools;
    $("agents").textContent = state.agents;
    $("waiting").textContent = state.waiting;
    $("heat").value = music.heat;
    $("heat").textContent = music.heat;
    $("heat-value").textContent = `${music.heat} / 100`;
    $("certainty").textContent = state.uncertain ? "一部の状況は不明" : "受信イベントから編曲";
    $("reason").textContent = state.reason;
    $("observed").textContent = snapshot.live.observed.join(" · ") || "まだありません。未受信と未対応は区別できません。";
    $("storage").textContent = snapshot.storageError || "設定のみをセッションに保存。再生状態は保存しません。";
    $("pattern").textContent = describePattern(music);
    $("mode-label").textContent = isDemo() ? "DEMO · FICTIONAL SESSION" : "LIVE SESSION";
    document.body.dataset.demo = String(isDemo());
    document.body.dataset.playing = String(audio.playing);
    document.body.dataset.scene = music.scene;
    document.querySelectorAll("[data-demo]").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.demo === demoScene));
    });
    const instruments = ["コード"];
    if (music.density && !music.waiting && !music.compacting) instruments.push("ベース", "キック");
    if (music.density > 1 && !music.waiting && !music.compacting) instruments.push("ハット");
    if (music.voices) instruments.push(`ゲスト旋律 × ${music.voices}`);
    if (music.waiting) instruments.push("保留音");
    $("instruments").textContent = `楽器: ${instruments.join(" / ")}`;
    $("start").disabled = !connected || starting || stopping || audio.playing || (!isDemo() && state.stopped);
    $("start").textContent = starting ? "音の準備中…" : audio.playing ? "ただいまオンエア" : "DJ、スタート！";
    $("audio-state").textContent = audio.playing ? "ON AIR" : "SILENT";
    $("connection").textContent = connected ? "接続済み" : "切断・停止中";
    audio.update(music, snapshot.settings.volume);
}
function apply(next) {
    if (snapshot && (next.revision < snapshot.revision || next.at < snapshot.at ||
        next.live.revision < snapshot.live.revision)) return;
    const mustStop = (starting || audio.playing || leaseActive) && (
        (stopVersion !== undefined && next.stopVersion !== stopVersion) ||
        (leaseActive && next.owner !== identity) || (!isDemo() && next.live.stopped));
    snapshot = next;
    stopVersion = next.stopVersion;
    if (mustStop) void stopPlayback("再生権限または接続状態が変わったため停止しました。");
    for (const field of ["preset", "volume", "mischief"]) {
        if (document.activeElement === $(field)) continue;
        $(field).value = field === "preset" ? next.settings[field] : Math.round(next.settings[field] * 100);
    }
    $("volume-value").textContent = `${Math.round(next.settings.volume * 100)}%`;
    $("mischief-value").textContent = `${Math.round(next.settings.mischief * 100)}%`;
    render();
}
async function stopPlayback(message = "音楽を止めました。再開するときは「DJ、スタート！」を押してください。") {
    if (stopping) return;
    stopping = true;
    attempt++;
    starting = false;
    leaseActive = false;
    const stopOperation = audio.stop();
    $("notice").textContent = message;
    render();
    try {
        await stopOperation;
        await post("release", { client });
    } catch (error) { showError(error); }
    finally { stopping = false; render(); }
}
$("start").addEventListener("click", async () => {
    if (!connected || starting || stopping || audio.playing) return;
    const ticket = ++attempt;
    starting = true;
    $("error").hidden = true;
    render();
    try {
        const unlock = audio.unlock();
        await unlock;
        if (ticket !== attempt) return;
        const claimed = await post("claim", { client });
        if (ticket !== attempt) { await post("release", { client }); return; }
        leaseActive = true;
        lastHeartbeat = performance.now();
        apply(claimed);
        const played = await audio.start(current().music, snapshot.settings.volume);
        if (ticket !== attempt) { await audio.stop(); return; }
        $("notice").textContent = played ? "演奏中。音楽が盛り上がっても、テスト合格とは限りません。" : "再生をキャンセルしました。";
    } catch (error) {
        showError(error);
        await stopPlayback("再生できませんでした。エラーを確認して、もう一度「DJ、スタート！」を押してください。");
    } finally {
        starting = false;
        render();
    }
});
$("stop").addEventListener("click", async () => {
    await stopPlayback();
    try { apply(await post("stop")); } catch (error) { showError(error); }
});
for (const field of ["volume", "mischief"]) {
    $(field).addEventListener("input", () => {
        $(`${field}-value`).textContent = `${$(field).value}%`;
        if (field === "volume") audio.setVolume(Number($(field).value) / 100);
    });
}
for (const field of ["volume", "mischief", "preset"]) {
    $(field).addEventListener("change", () => {
        const value = field === "preset" ? $(field).value : Number($(field).value) / 100;
        saving = saving.then(async () => {
            try { apply(await post("settings", { [field]: value })); }
            catch (error) { showError(error); render(); }
        });
    });
}
$("mode").addEventListener("change", () => {
    void stopPlayback("演奏ソースを変更しました。「DJ、スタート！」を押すと再生します。");
    $("demo-controls").hidden = !isDemo();
    demo = createSessionState();
    demoScene = undefined;
    render();
});
function demoEvent(type, data = {}) {
    demo.ingest({ id: `demo-${++sequence}`, type, data });
}
document.querySelectorAll("[data-demo]").forEach((button) => button.addEventListener("click", () => {
    demo = createSessionState();
    const scene = button.dataset.demo;
    demoScene = scene;
    demoEvent("assistant.turn_start", { turnId: `turn-${sequence}` });
    if (scene === "working" || scene === "band") {
        for (let i = 0; i < 8; i++) demoEvent("tool.execution_start", { toolCallId: `tool-${i}` });
    }
    if (scene === "band") for (let i = 0; i < 3; i++) demoEvent("subagent.started", { toolCallId: `guest-${i}` });
    if (scene === "error") demoEvent("tool.execution_complete", { toolCallId: "imaginary-failure", success: false });
    if (scene === "waiting") demoEvent("permission.requested", { requestId: "imaginary-permission" });
    if (scene === "complete") demoEvent("session.task_complete", { success: true });
    if (scene === "idle") demoEvent("session.idle");
    render();
}));
$("copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("pattern").textContent); $("notice").textContent = "表示中のStrudelコードをコピーしました。"; }
    catch { showError(new Error("Clipboard is unavailable. Select the code and copy it manually.")); }
});
const stream = new EventSource(new URL("events", location.href));
stream.onmessage = (event) => {
    try {
        const next = JSON.parse(event.data);
        connected = true;
        apply(next);
    } catch (error) {
        showError(error);
        connected = false;
        void stopPlayback("状態を読み取れないため停止しました。");
    }
};
stream.onerror = () => {
    connected = false;
    void stopPlayback("接続が切れたため停止しました。再接続後も自動では再開しません。");
};
const ticker = setInterval(async () => {
    const metrics = audio.metrics();
    $("master-level").value = metrics.playing && metrics.peak > 0
        ? Math.max(-60, Math.min(0, 20 * Math.log10(metrics.peak))) : -60;
    $("level-value").textContent = metrics.playing
        ? (metrics.peak > 0 ? `${(20 * Math.log10(metrics.peak)).toFixed(1)} dBFS` : "−∞ dBFS")
        : "SILENT";
    $("signal").textContent = metrics.playing ? `peak ${metrics.peak.toFixed(4)} / rms ${metrics.rms.toFixed(4)}` : "無音";
    if (leaseActive && performance.now() - lastHeartbeat > 4000) {
        await stopPlayback("音声リースを確認できないため停止しました。");
        return;
    }
    if (leaseActive && !heartbeatBusy) {
        heartbeatBusy = true;
        try {
            apply(await post("heartbeat", { client }));
            lastHeartbeat = performance.now();
        } catch (error) { showError(error); await stopPlayback("音声リースを失ったため停止しました。"); }
        finally { heartbeatBusy = false; }
    }
    render();
}, 1000);
document.addEventListener("visibilitychange", () => {
    if (document.hidden) void stopPlayback("画面が非表示になったため停止しました。");
});
window.addEventListener("pagehide", () => {
    clearInterval(ticker);
    stream.close();
    void audio.stop();
    void fetch(new URL("release", location.href), { method: "POST", keepalive: true,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client }) });
});
window.sessionDJDiagnostics = () => ({ ...audio.metrics(), connected, starting, demo: isDemo() });
