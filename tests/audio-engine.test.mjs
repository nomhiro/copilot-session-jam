import test from "node:test";
import assert from "node:assert/strict";
import { AudioEngine } from "../.github/extensions/copilot-session-dj/ui/audio-engine.mjs";

function fixture(loadDelay) {
    const parameter = () => ({ value: 0, cancelScheduledValues() {}, setValueAtTime(value) { this.value = value; } });
    const node = () => ({ gain: parameter(), threshold: parameter(), ratio: parameter(), knee: parameter(),
        attack: parameter(), release: parameter(), connect(target) { return target; }, disconnect() {},
        fftSize: 1024, getFloatTimeDomainData(data) { data.fill(0); } });
    const context = { state: "suspended", currentTime: 0, destination: node(),
        async resume() { this.state = "running"; }, async suspend() { this.state = "suspended"; },
        createGain: node, createDynamicsCompressor: node, createAnalyser: node };
    const pattern = new Proxy({}, { get: () => () => pattern });
    let starts = 0;
    const repl = { scheduler: { now: () => 0, cps: 0.35 }, setCps() {}, async setPattern() {},
        async start() { starts++; }, stop() {} };
    const controller = { output: { destinationGain: node() }, reset() { this.output.destinationGain = node(); } };
    const api = { setAudioContext() {}, async initStrudel() { return repl; }, async initAudio() {},
        getSuperdoughAudioController: () => controller, note: () => pattern, s: () => pattern, stack: () => pattern };
    const engine = new AudioEngine({ contextFactory: () => context, load: async () => { await loadDelay; return api; } });
    return { engine, context, starts: () => starts };
}
const music = { preset: "lofi", density: 3, voices: 3, waiting: false, compacting: false, bpm: 84 };
test("constructing the engine is silent and does not create an AudioContext", () => {
    const engine = new AudioEngine({ contextFactory: () => { throw new Error("must not run"); } });
    assert.deepEqual(engine.metrics(), { playing: false, context: "not-created", peak: 0, rms: 0, updates: 0 });
});
test("stopping during delayed initialization cannot start the scheduler later", async () => {
    let resolve;
    const { engine, context, starts } = fixture(new Promise((r) => { resolve = r; }));
    const start = engine.start(music, 0.4);
    await engine.stop();
    resolve();
    assert.equal(await start, false);
    assert.equal(starts(), 0);
    assert.equal(context.state, "suspended");
});
test("stop clears pending changes, mutes all output and suspends the context", async () => {
    const { engine, context } = fixture();
    await engine.start(music, 1);
    assert.equal(engine.playing, true);
    assert.equal(engine.master.gain.value, 0.35);
    engine.update({ ...music, voices: 1 }, 0.5);
    assert.ok(engine.timer);
    await engine.stop();
    assert.equal(engine.timer, null);
    assert.equal(engine.master.gain.value, 0);
    assert.equal(context.state, "suspended");
    assert.equal(engine.metrics().peak, 0);
});
test("unchanged arrangements do not schedule repeated pattern updates", async () => {
    const { engine } = fixture();
    await engine.start(music, 0.3);
    for (let i = 0; i < 100; i++) engine.update({ ...music, heat: i, scene: "working" }, 0.3);
    assert.equal(engine.timer, undefined);
    await engine.stop();
});
