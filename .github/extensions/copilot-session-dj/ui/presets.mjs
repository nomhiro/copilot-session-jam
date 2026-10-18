export const PRESET_NAMES = { lofi: "Lo-fi Incident", synthwave: "Merge After Dark", chiptune: "8-bit Standup" };

export function describePattern(music) {
    const bassSound = music.preset === "chiptune" ? "square" : music.preset === "synthwave" ? "sawtooth" : "triangle";
    const cutoff = music.preset === "synthwave" ? 1400 : 850;
    const waiting = music.waiting || music.compacting;
    const lines = [
        `// ${PRESET_NAMES[music.preset]} | ${music.bpm} BPM | generated, not evaluated`,
        `stack(`,
        `  note("<[a3,c4,e4] [f3,a3,c4] [c3,e3,g3] [g3,b3,d4]>").s("triangle").slow(2).attack(0.04).release(0.2).gain(0.045)`,
    ];
    if (music.density > 0 && !waiting) {
        lines.push(`  , note("a1 ~ a1 e2").s("${bassSound}").lpf(${cutoff}).decay(0.12).sustain(0).gain(0.07)`);
        lines.push(`  , note("a1*4").s("sine").decay(0.08).sustain(0).gain(0.11)`);
    }
    if (music.density > 1 && !waiting) lines.push(`  , s("pink*${music.density > 2 ? 8 : 4}").hpf(6500).decay(0.025).sustain(0).gain(0.025)`);
    const melodies = ["a4 ~ c5 ~ e5 ~ c5 ~", "e4 ~ g4 ~ b4 ~ g4 ~", "c5 ~ e5 ~ g5 ~ e5 ~"];
    for (let voice = 0; voice < music.voices; voice++) {
        lines.push(`  , note("${melodies[voice]}").s("${music.preset === "chiptune" ? "square" : "sine"}").slow(2).decay(0.08).sustain(0).gain(0.018)`);
    }
    if (waiting) lines.push(`  , note("a4 ~ c5 ~ e5 ~ g5 ~").s("sine").slow(2).decay(0.1).sustain(0).gain(0.035)`);
    if (music.error) lines.push(`  , note("bb2 ~ ~ ~").s("triangle").decay(0.1).sustain(0).gain(0.035)`);
    if (music.completed) lines.push(`  , note("a4 c5 e5 a5").s("sine").decay(0.08).sustain(0).gain(0.035)`);
    lines.push(")");
    return lines.join("\n");
}

export function buildPattern(api, music) {
    const { note, s, stack } = api;
    const waiting = music.waiting || music.compacting;
    const bassSound = music.preset === "chiptune" ? "square" : music.preset === "synthwave" ? "sawtooth" : "triangle";
    const layers = [note("<[a3,c4,e4] [f3,a3,c4] [c3,e3,g3] [g3,b3,d4]>")
        .s("triangle").slow(2).attack(0.04).release(0.2).gain(0.045)];
    if (music.density > 0 && !waiting) {
        layers.push(note("a1 ~ a1 e2").s(bassSound).lpf(music.preset === "synthwave" ? 1400 : 850)
            .decay(0.12).sustain(0).gain(0.07));
        layers.push(note("a1*4").s("sine").decay(0.08).sustain(0).gain(0.11));
    }
    if (music.density > 1 && !waiting) layers.push(s(`pink*${music.density > 2 ? 8 : 4}`)
        .hpf(6500).decay(0.025).sustain(0).gain(0.025));
    const melodies = ["a4 ~ c5 ~ e5 ~ c5 ~", "e4 ~ g4 ~ b4 ~ g4 ~", "c5 ~ e5 ~ g5 ~ e5 ~"];
    for (let voice = 0; voice < music.voices; voice++) {
        layers.push(note(melodies[voice]).s(music.preset === "chiptune" ? "square" : "sine")
            .slow(2).decay(0.08).sustain(0).gain(0.018));
    }
    if (waiting) layers.push(note("a4 ~ c5 ~ e5 ~ g5 ~").s("sine").slow(2).decay(0.1).sustain(0).gain(0.035));
    if (music.error) layers.push(note("bb2 ~ ~ ~").s("triangle").decay(0.1).sustain(0).gain(0.035));
    if (music.completed) layers.push(note("a4 c5 e5 a5").s("sine").decay(0.08).sustain(0).gain(0.035));
    return stack(...layers);
}
