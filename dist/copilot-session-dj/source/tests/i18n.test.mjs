import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { COPY, resolveLanguage, translate } from "../.github/extensions/copilot-session-dj/ui/i18n.mjs";
import { SCENES } from "../.github/extensions/copilot-session-dj/music-mapping.mjs";

test("language selection honors an explicit choice and defaults from the primary browser language", () => {
    assert.equal(resolveLanguage("en", ["ja-JP"]), "en");
    assert.equal(resolveLanguage("ja", ["en-US"]), "ja");
    assert.equal(resolveLanguage(null, ["ja-JP"]), "ja");
    assert.equal(resolveLanguage("invalid", ["fr-FR", "ja"]), "en");
    assert.equal(resolveLanguage(null, []), "en");
});
test("all translation pairs round-trip without translating code or identifiers", () => {
    for (const [source, target] of Object.entries(COPY)) {
        const ja = /[ぁ-んァ-ヶ一-龠]/u.test(source) ? source : target;
        const en = ja === source ? target : source;
        assert.equal(translate(ja, "en"), en);
        assert.equal(translate(en, "ja"), ja);
    }
    assert.equal(translate('note("a3").s("sine")', "en"), 'note("a3").s("sine")');
    assert.equal(translate("tool.execution_start", "ja"), "tool.execution_start");
});
test("every Japanese static text node and every scene has an English translation", async () => {
    const html = await readFile(new URL("../.github/extensions/copilot-session-dj/ui/index.html", import.meta.url), "utf8");
    for (const match of html.matchAll(/>([^<>]+)</gu)) {
        const text = match[1].trim();
        if (!/[ぁ-んァ-ヶ一-龠]/u.test(text) || text === "日本語" || text === "Language / 言語") continue;
        assert.notEqual(translate(text, "en"), text, text);
    }
    for (const scene of Object.values(SCENES)) {
        for (const text of scene) assert.notEqual(translate(text, "en"), text, text);
    }
});
test("dynamic instrument lists translate in both directions", () => {
    const ja = "楽器: コード / ベース / キック / ハット / ゲスト旋律 × 3 / 保留音";
    const en = "Instruments: Chords / Bass / Kick / Hi-hat / Guest melody × 3 / Hold music";
    assert.equal(translate(ja, "en"), en);
    assert.equal(translate(en, "ja"), ja);
});
