export const DEFAULT_SETTINGS = Object.freeze({ preset: "lofi", volume: 0.22, mischief: 0.55 });
export const PRESETS = Object.freeze(["lofi", "synthwave", "chiptune"]);

export function validateSettings(input, { partial = true } = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Settings must be an object.");
    const allowed = Object.keys(DEFAULT_SETTINGS);
    if (Object.keys(input).some((key) => !allowed.includes(key))) throw new Error("Unknown setting.");
    if (!partial && allowed.some((key) => !Object.hasOwn(input, key))) throw new Error("Incomplete settings.");
    if (Object.hasOwn(input, "preset") && !PRESETS.includes(input.preset)) throw new Error("Unknown preset.");
    for (const key of ["volume", "mischief"]) {
        if (Object.hasOwn(input, key) && (typeof input[key] !== "number" || !Number.isFinite(input[key]) ||
            input[key] < 0 || input[key] > 1)) throw new Error(`${key} must be between 0 and 1.`);
    }
    return { ...input };
}

export function mapMusic(state, settings = DEFAULT_SETTINGS) {
    const activity = state.mainActive || state.tools > 0 || state.agents > 0;
    const density = Math.min(3, Math.ceil(
        (state.tools * 0.25 + Math.min(3, state.agents) * 0.5 + state.pulse) * settings.mischief,
    ));
    const scene = state.stopped ? "offline" : state.waiting > 0 ? "waiting"
        : state.compacting ? "compacting" : state.error ? "error"
            : state.completed ? "complete" : activity ? "working" : state.uncertain ? "unknown" : "idle";
    return {
        scene, preset: settings.preset, density: activity ? Math.max(1, density) : 0,
        voices: Math.min(3, state.agents), waiting: state.waiting > 0,
        error: state.error, completed: state.completed, compacting: state.compacting,
        heat: Math.min(100, Math.round((density / 3) * 75 + Math.min(3, state.agents) * 8)),
        bpm: { lofi: 84, synthwave: 108, chiptune: 120 }[settings.preset],
    };
}

export const SCENES = Object.freeze({
    unknown: ["開店準備中", "観測開始前の状況は不明です。次のイベントから選曲します。"],
    idle: ["深夜のREADME喫茶", "次の一手をお待ちしています。待機は成功判定ではありません。"],
    working: ["tool-call四つ打ち", "検索も編集もリズム隊。音数は増えても音量は据え置き。"],
    waiting: ["人類の承認をお待ちしております", "DJには承認権限がありません。ほかの演奏は続くことがあります。"],
    error: ["不穏なコード進行", "失敗イベントを受信。音楽上の演出であって、障害診断ではありません。"],
    complete: ["LGTMとは言ってないが乾杯", "明示的な成功完了イベントを受信。自作フレーズでお祝い。"],
    compacting: ["記憶の整理整頓", "思い出を圧縮しています。音楽もちょっと引き算。"],
    offline: ["本日の営業は終了しました", "セッション終了。再生を停止しました。"],
});
