import { buildPattern } from "./presets.mjs";

export class AudioEngine {
    constructor({ onError = () => {}, load = () => import("./assets/strudel.bundle.mjs"),
        contextFactory = () => new AudioContext({ latencyHint: "playback" }) } = {}) {
        this.onError = onError;
        this.load = load;
        this.contextFactory = contextFactory;
        this.generation = 0;
        this.playing = false;
        this.key = null;
        this.updates = 0;
    }
    async initialize() {
        if (!this.ready) {
            this.ready = (async () => {
                this.api = await this.load();
                this.api.setAudioContext(this.context);
                this.repl = await this.api.initStrudel({
                    audioContext: this.context,
                    onUpdateState: (state) => {
                        if (state.schedulerError) {
                            void this.stop();
                            this.onError(new Error("Audio scheduler failed. Playback stopped."));
                        }
                    },
                });
                await this.api.initAudio({ maxPolyphony: 32 });
            })();
        }
        return this.ready;
    }
    unlock() {
        this.context ??= this.contextFactory();
        return this.context.resume();
    }
    routeMaster() {
        const controller = this.api.getSuperdoughAudioController();
        controller.reset();
        const output = controller.output.destinationGain;
        if (!output) throw new Error("Strudel master output is unavailable.");
        output.disconnect();
        this.limiter?.disconnect();
        this.master?.disconnect();
        this.analyser?.disconnect();
        this.limiter = this.context.createDynamicsCompressor();
        this.limiter.threshold.value = -12;
        this.limiter.knee.value = 0;
        this.limiter.ratio.value = 20;
        this.limiter.attack.value = 0.003;
        this.limiter.release.value = 0.1;
        this.master = this.context.createGain();
        this.master.gain.value = 0;
        this.analyser = this.context.createAnalyser();
        this.analyser.fftSize = 1024;
        this.samples = new Float32Array(this.analyser.fftSize);
        output.connect(this.limiter).connect(this.master).connect(this.analyser).connect(this.context.destination);
    }
    async start(music, volume) {
        const generation = ++this.generation;
        this.context ??= this.contextFactory();
        // Resume begins in the user's click, before any network or module awaits.
        const resume = this.context.resume();
        try {
            await resume;
            await this.initialize();
            if (generation !== this.generation) { await this.silence(); return false; }
            await this.context.resume();
            if (generation !== this.generation) { await this.silence(); return false; }
            if (this.context.state !== "running") throw new Error("Audio was blocked. Click Start again.");
            this.routeMaster();
            this.setVolume(volume);
            this.repl.setCps(music.bpm / 240);
            await this.repl.setPattern(buildPattern(this.api, music), false);
            if (generation !== this.generation) { await this.silence(); return false; }
            await this.repl.start();
            if (generation !== this.generation) { await this.silence(); return false; }
            this.playing = true;
            this.key = this.musicKey(music);
            this.updates++;
            return true;
        } catch (error) {
            await this.stop();
            throw error;
        }
    }
    musicKey(music) {
        const { scene, heat, ...audio } = music;
        return JSON.stringify(audio);
    }
    setVolume(volume) {
        if (!this.master) return;
        const time = this.context.currentTime;
        this.master.gain.cancelScheduledValues(time);
        this.master.gain.setValueAtTime(Math.min(1, Math.max(0, volume)) * 0.35, time);
    }
    update(music, volume) {
        this.setVolume(volume);
        if (!this.playing || this.musicKey(music) === this.key) return;
        this.pending = music;
        if (this.timer) return;
        const cycle = this.repl.scheduler.now();
        const seconds = Math.max(0.02, (Math.floor(cycle) + 1 - cycle) / this.repl.scheduler.cps - 0.15);
        const generation = this.generation;
        this.timer = setTimeout(async () => {
            this.timer = null;
            if (generation !== this.generation || !this.playing) return;
            const next = this.pending;
            try {
                this.repl.setCps(next.bpm / 240);
                await this.repl.setPattern(buildPattern(this.api, next), false);
                this.key = this.musicKey(next);
                this.updates++;
            } catch (error) {
                await this.stop();
                this.onError(error);
            }
        }, Math.min(seconds * 1000, 4000));
    }
    async silence() {
        if (this.master) {
            this.master.gain.cancelScheduledValues(this.context.currentTime);
            this.master.gain.setValueAtTime(0, this.context.currentTime);
        }
        this.repl?.stop();
        if (this.context && this.context.state !== "closed") await this.context.suspend();
    }
    async stop() {
        this.generation++;
        this.playing = false;
        clearTimeout(this.timer);
        this.timer = null;
        this.pending = null;
        this.key = null;
        await this.silence();
    }
    metrics() {
        let peak = 0;
        let sum = 0;
        if (this.analyser && this.context.state === "running") {
            this.analyser.getFloatTimeDomainData(this.samples);
            for (const sample of this.samples) { peak = Math.max(peak, Math.abs(sample)); sum += sample * sample; }
        }
        return { playing: this.playing, context: this.context?.state ?? "not-created", peak,
            rms: this.samples ? Math.sqrt(sum / this.samples.length) : 0, updates: this.updates };
    }
}
