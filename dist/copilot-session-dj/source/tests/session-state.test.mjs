import test from "node:test";
import assert from "node:assert/strict";
import { createSessionState, normalizeEvent } from "../.github/extensions/copilot-session-dj/session-state.mjs";
import { DEFAULT_SETTINGS, mapMusic, validateSettings } from "../.github/extensions/copilot-session-dj/music-mapping.mjs";
import { buildPattern, describePattern } from "../.github/extensions/copilot-session-dj/ui/presets.mjs";

function fixture() {
    let time = 10000;
    let index = 0;
    const state = createSessionState({ now: () => time });
    return { state, emit: (type, data = {}, extra = {}) => state.ingest({ type, data, id: `event-${++index}`, ...extra }),
        advance: (ms) => { time += ms; } };
}

test("starts uncertain and does not copy sensitive event fields", () => {
    const { state } = fixture();
    assert.equal(state.snapshot().uncertain, true);
    const event = normalizeEvent({ type: "tool.execution_start", data: { toolCallId: "t1", arguments: { secret: "never-copy" }, toolName: "private-name" } });
    assert.equal(JSON.stringify(event).includes("never-copy"), false);
    assert.equal(JSON.stringify(event).includes("private-name"), false);
    assert.equal(normalizeEvent({ type: "assistant.reasoning", data: { content: "secret" } }), null);
});
test("tool IDs pair, deduplicate and tolerate end-before-start", () => {
    const { state, emit } = fixture();
    emit("tool.execution_start", { toolCallId: "t1" }, { id: "same" });
    assert.equal(emit("tool.execution_start", { toolCallId: "t1" }, { id: "same" }), false);
    emit("tool.execution_start", { toolCallId: "t1" });
    assert.equal(state.snapshot().tools, 1);
    emit("tool.execution_complete", { toolCallId: "t1", success: true });
    emit("tool.execution_complete", { toolCallId: "t2", success: true });
    emit("tool.execution_start", { toolCallId: "t2" });
    assert.equal(state.snapshot().tools, 0);
});
test("agent lifecycle keys off spawning toolCallId, not the parent agentId", () => {
    const { state, emit } = fixture();
    emit("subagent.started", { toolCallId: "spawn-1" }, { agentId: "parent" });
    emit("subagent.started", { toolCallId: "spawn-2" }, { agentId: "parent" });
    assert.equal(state.snapshot().agents, 2);
    emit("subagent.completed", { toolCallId: "spawn-1" }, { agentId: "parent" });
    emit("subagent.failed", { toolCallId: "spawn-2" }, { agentId: "parent" });
    assert.equal(state.snapshot().agents, 0);
    assert.equal(state.snapshot().error, true);
});
test("a completed spawn tool does not tombstone its running subagent", () => {
    const { state, emit } = fixture();
    emit("tool.execution_complete", { toolCallId: "spawn", success: true });
    emit("subagent.started", { toolCallId: "spawn" });
    assert.equal(state.snapshot().agents, 1);
    emit("subagent.completed", { toolCallId: "spawn" });
    assert.equal(state.snapshot().agents, 0);
});
test("all pending request types are paired independently", () => {
    const { state, emit } = fixture();
    for (const type of ["permission", "user_input", "elicitation"]) emit(`${type}.requested`, { requestId: "same-id" });
    emit("permission.completed", { requestId: "same-id" });
    assert.equal(state.snapshot().waiting, 2);
    emit("user_input.completed", { requestId: "same-id" });
    emit("elicitation.completed", { requestId: "same-id" });
    assert.equal(state.snapshot().waiting, 0);
    emit("permission.requested");
    assert.equal(state.snapshot().waiting, 0);
});
test("main idle does not clear background tools or agents", () => {
    const { state, emit } = fixture();
    emit("assistant.turn_start", { turnId: "a" });
    emit("tool.execution_start", { toolCallId: "t" });
    emit("subagent.started", { toolCallId: "s" });
    emit("assistant.idle");
    assert.equal(state.snapshot().mainActive, false);
    assert.equal(mapMusic(state.snapshot()).scene, "working");
    emit("session.idle");
    assert.equal(state.snapshot().tools, 1);
    assert.equal(state.snapshot().agents, 1);
});
test("fallback main turn ID works across turns and ignores child turns", () => {
    const { state, emit } = fixture();
    emit("assistant.turn_start");
    emit("assistant.turn_end");
    emit("assistant.turn_start");
    assert.equal(state.snapshot().mainActive, true);
    emit("assistant.turn_end", {}, { agentId: "child" });
    assert.equal(state.snapshot().mainActive, true);
});
test("success is only an explicit main task completion, not idle or tool success", () => {
    const { state, emit, advance } = fixture();
    emit("tool.execution_complete", { toolCallId: "t", success: true });
    emit("session.idle");
    emit("session.task_complete");
    emit("session.task_complete", { success: false });
    emit("session.task_complete", { success: true }, { agentId: "child" });
    assert.equal(state.snapshot().completed, false);
    emit("session.task_complete", { success: true }, { id: "complete" });
    assert.equal(state.snapshot().completed, true);
    advance(5000);
    state.ingest({ type: "session.task_complete", id: "complete", data: { success: true } });
    assert.equal(state.snapshot().completed, false);
});
test("error accents expire and stale in-flight work becomes uncertain, not successful", () => {
    const { state, emit, advance } = fixture();
    emit("assistant.turn_start", { turnId: "a" });
    emit("tool.execution_start", { toolCallId: "long" });
    emit("tool.execution_complete", { toolCallId: "bad", success: false });
    assert.equal(state.snapshot().error, true);
    advance(5000);
    assert.equal(state.snapshot().error, false);
    advance(16 * 60 * 1000);
    assert.equal(state.snapshot().uncertain, true);
    assert.equal(state.snapshot().tools, 1);
    assert.equal(state.snapshot().completed, false);
});
test("shutdown clears active state and instructs silence", () => {
    const { state, emit } = fixture();
    emit("tool.execution_start", { toolCallId: "t" });
    emit("permission.requested", { requestId: "p" });
    emit("session.shutdown");
    assert.equal(state.snapshot().tools, 0);
    assert.equal(state.snapshot().waiting, 0);
    assert.equal(mapMusic(state.snapshot()).scene, "offline");
});
test("intensity and guest voices remain bounded during an event storm", () => {
    const { state, emit } = fixture();
    for (let i = 0; i < 2500; i++) {
        emit("tool.execution_start", { toolCallId: `t-${i}` });
        emit("subagent.started", { toolCallId: `a-${i}` });
        emit("assistant.message_delta");
    }
    const music = mapMusic(state.snapshot(), { ...DEFAULT_SETTINGS, mischief: 1 });
    assert.equal(music.density, 3);
    assert.equal(music.voices, 3);
    assert.ok(music.heat <= 100);
    assert.ok(state.snapshot().tools <= 2048);
});
test("settings reject invalid values and unknown fields", () => {
    for (const input of [null, [], { volume: NaN }, { volume: 1.01 }, { mischief: -1 }, { preset: "midi" }, { command: "run" }]) {
        assert.throws(() => validateSettings(input));
    }
    assert.throws(() => validateSettings({ volume: 0.5 }, { partial: false }));
    assert.deepEqual(validateSettings({ volume: 0 }), { volume: 0 });
});
test("music is a bounded overlay, not a semantic success classifier", () => {
    const base = createSessionState().snapshot();
    const music = mapMusic({ ...base, tools: 100, agents: 100, waiting: 2, error: true });
    assert.equal(music.scene, "waiting");
    assert.equal(music.voices, 3);
    assert.equal(music.completed, false);
    assert.equal(mapMusic({ ...base, compacting: true }).scene, "compacting");
});
test("all presets compile their documented pattern using the same operations", () => {
    function recorder() {
        let calls = [];
        const node = (text) => new Proxy({ text }, { get: (obj, key) => key === "text" ? obj.text : (...args) => node(`${obj.text}.${key}(${args.map(JSON.stringify).join(",")})`) });
        return { api: { note: (s) => node(`note(${JSON.stringify(s)})`), s: (s) => node(`s(${JSON.stringify(s)})`),
            stack: (...layers) => { calls = layers.map((layer) => layer.text); return calls; } } };
    }
    for (const preset of ["lofi", "synthwave", "chiptune"]) {
        const { api } = recorder();
        const music = { preset, density: 3, voices: 3, waiting: false, error: true, completed: true, compacting: false, bpm: 84 };
        const layers = buildPattern(api, music);
        assert.ok(layers.length <= 9);
        const description = describePattern(music).replaceAll(" ", "");
        for (const layer of layers) assert.ok(description.includes(layer.replaceAll(" ", "")), layer);
        assert.equal(buildPattern(api, { ...music, waiting: true }).some((line) => line.includes('note("a1*4")')), false);
    }
});
