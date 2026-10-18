# Copilot Session DJ

**Code is the session. Music is the side quest.**

A playful GitHub Copilot custom Canvas that turns the current session's activity into a local Strudel soundtrack. Tools become the rhythm section, subagents join the band, errors add a little tension, and approval requests switch the arrangement to suspiciously polite hold music.

English/Japanese DJ-booth UI. Three original, sample-free synth presets: **Lo-fi Incident**, **Merge After Dark**, and **8-bit Standup**.

The booth starts in Japanese when your primary browser language is Japanese, and English otherwise. Use **Language / 言語** to switch without interrupting playback. The choice is saved in browser local storage for the booth's origin, not in session transcripts; a new server origin uses browser detection again. Labels, scene descriptions, notices and known application errors are translated. Technical details from unexpected platform errors remain in their original language. Track names, generated code and event identifiers are unchanged.

The booth combines a turntable-style deck, master/chaos channel strips and Soundcheck cue pads. MASTER OUT shows the actual audio peak in dBFS, sampled once per second; it is separate from the session-activity heat meter and is not a clipping or hearing-safety guarantee. Controls remain native keyboard-accessible inputs, and the deck's ON AIR indicator follows actual playback, not session activity.

## Run in this repository

Requires Node.js 22+, npm, and a Copilot host with extension Canvas support. This uses experimental SDK APIs; it is not an extension for every Copilot client.

```powershell
npm ci --ignore-scripts
npm run build
npm test
```

Reload extensions in Copilot, then ask: **“Open Copilot Session DJ.”** Click **Drop the beat!** / **DJ、スタート！** inside the Canvas. It never starts audio automatically. `Stop the decks` / `いったんストップ` stops it. The Soundcheck section can simulate a session without running tools or approving anything.

For a standalone browser preview with **no live Copilot session**:

```powershell
npm run preview
```

Open the printed loopback URL. Preferences in this preview are not saved. In Copilot, only preset, volume and mischief preferences are stored under the session workspace's `copilot-session-dj` directory.

## What the DJ hears

The extension subscribes to the **current session only**, including its subagent events. It reduces SDK events to counts and flags before sending them to the UI. No transcript, reasoning, tool arguments, shell commands, file paths or tool output is sent to the browser or saved by this extension. The SDK delivers events to the extension process; the normalizer ignores their content.

| Event | Musical consequence |
|---|---|
| Assistant activity and tool starts | A busier rhythm, within fixed limits |
| Subagents starting / finishing | Up to three guest melodic voices |
| Tool failure / session error | A short tension accent; not a bug diagnosis |
| Permission, user-input or MCP elicitation waiting | Elevator-style hold-music overlay |
| Context compaction | An arrangement break |
| `session.task_complete` with `success === true` | An original completion phrase |
| Idle | A quieter arrangement, **not** a success claim |

Tool success does **not** mean tests passed. Subagent completion does **not** mean the whole task succeeded. Heat is a joke metric, not a productivity assessment. Events before the extension joined are unknown; long-running unmatched activity becomes explicitly uncertain instead of being declared successful.

The UI shows which event types have actually arrived. Assistant/tool delivery and browser audio were exercised during development; less common events also have deterministic fixture coverage, not a promise that every host forwards every event. This local Canvas was developed against Copilot App 1.0.99-2's bundled experimental SDK. Remote/cloud hosts, hidden-panel behavior and other app versions require their own acceptance checks.

## Audio and safety

- Everything is synthesized locally using pinned `@strudel/web` **1.3.0**. No music service, API key, microphone, soundfont, sample download, tracking or additional LLM call.
- Initial display, reload and reconnect are silent. A click is required to start or resume.
- Master gain is capped, a compressor sits before the user-volume node, and voices/polyphony are bounded. Keep your device volume sensible; this is not a hearing-safety certification.
- A stop mutes the master and suspends the entire AudioContext, including scheduled sounds and tails.
- Losing the stream, visibility, or the audio lease stops playback. Only one booth in the session may own audio.
- Music updates are cycle-aligned with scheduler lookahead, not sample-accurate synchronization. They do not restart the running clock.
- No arbitrary code evaluator is exposed. The displayed Strudel code is generated from trusted presets, not executed as text.
- The loopback server requires a random URL capability, validates Host/Origin, bounds requests, and exposes only an allowlisted set of files.
- The DSP worklet shipped in the pinned Strudel bundle uses `data:` module URLs. CSP permits those modules but not arbitrary external script or media origins.

The extension never changes prompts, tool results, approvals or agent behavior. The demo is isolated from live activity. UI styling intentionally uses its own after-hours palette, with native keyboard controls, visible focus and textual alternatives to sound.

## Canvas actions

`get_state` reads sanitized activity, settings and observed event types. `set_mix` accepts `volume` and `mischief` in `0..1` and/or `preset`. `select_preset` chooses `lofi`, `synthwave` or `chiptune`. `stop` silences all booths. No action starts audio without an in-page gesture.

## Build an installable plugin

```powershell
npm run build
npm test
npm run package:plugin
npm run smoke:plugin
```

The package command requires the checked-in `assets\preview.png`, and creates `dist\copilot-session-dj` with a standard `plugin.json`, `com.github.copilot\extensions`, the local audio bundle, licenses, corresponding application source, build instructions and SHA256 sums. The smoke command uses the installed Copilot CLI and a disposable local marketplace/home under `.artifacts`; it does not use your normal CLI configuration. Local plugins are linked rather than copied by the CLI. The generated package is not published automatically. The SDK is supplied by Copilot; it is not an npm dependency.

The `.github\extensions\copilot-session-dj` directory is the development source of truth. Do not manually edit generated plugin copies. To rebuild a packaged source tree, enter its `source` directory and run the same `npm ci`, build and test commands.

## Awesome Copilot submission (later)

The target is **external plugin listing**, not relicensing Strudel as MIT. See the [current contribution guide](https://github.com/github/awesome-copilot/blob/main/CONTRIBUTING.md) and [external plugin form](https://github.com/github/awesome-copilot/blob/main/.github/ISSUE_TEMPLATE/external-plugin.yml).

The v0.1.0 release uses `dist/copilot-session-dj` as its installable plugin path. The release commit explicitly includes that generated directory, including the local Strudel bundle, corresponding application source, licenses and checksums. `dist/` remains ignored for ordinary development; rebuild and explicitly stage the reviewed distribution when preparing a release. The repository's root remains the development source of truth.

Before submitting:

1. Make a reviewed public revision containing the **built plugin** at a stable repository path. `dist` is ignored in development, so a source-only tag is not an installable release. Choose the release layout explicitly.
2. Keep the AGPL license, corresponding-source access, third-party notices and build inputs available. Confirm the immutable upstream source links are reachable.
3. Verify `plugin.json`, `assets\preview.png`, `canvas` keyword, version, author, repository and license. Use an immutable release tag or full commit SHA; if supplying both, they must identify the same commit.
4. Run the then-current Vally lint and Copilot CLI clean-install quality gates in an isolated configuration, plus actual Canvas audio/start/stop checks. Our local tests do not substitute for the marketplace's review.
5. Submit the external-plugin Issue form. Do **not** directly edit `plugins/external.json`. Human maintainer approval is required; novelty alone does not guarantee acceptance.

Build and package commands do not publish, tag, push, open an Issue, or apply for listing. Those are separate explicit release actions.

## License and corresponding source

**AGPL-3.0-or-later**. See [LICENSE](LICENSE). This application adds original arrangements and session integration; the Strudel browser distribution is copied without modification.

Strudel's matching `@strudel/web@1.3.0` annotated tag resolves to source commit [`f610965f4332837febe45743105da170e8b331ed`](https://codeberg.org/uzu/strudel/src/commit/f610965f4332837febe45743105da170e8b331ed). Its [source archive](https://codeberg.org/uzu/strudel/archive/f610965f4332837febe45743105da170e8b331ed.tar.gz) includes the preferred source, upstream lockfile and build configuration. The local build generates `THIRD-PARTY-NOTICES` with dependency licenses and original source-package URLs. The distributed package includes this application's source and build scripts.

Respect the Strudel contributors' request not to fork the entire upstream project back to GitHub. We integrate its npm distribution. Anyone distributing a release must maintain equivalent access to the corresponding source; a broken link is not sufficient. Session data and the code being worked on are not part of this extension's corresponding source.