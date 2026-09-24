/* =========================================================
   ELEMENTS
========================================================= */

const loadingScreen = document.getElementById("loadingScreen");
const missionScreen = document.getElementById("missionScreen");
const originScreen = document.getElementById("originScreen");
const calendarScreen = document.getElementById("calendarScreen");
const solarScreen = document.getElementById("solarScreen");
const statusScreen = document.getElementById("statusScreen");
const passwordScreen = document.getElementById("passwordScreen");
const finalScreen = document.getElementById("finalScreen");
const letterScreen = document.getElementById("letterScreen");

const loadingText = document.getElementById("loadingText");
const loadingProgress = document.getElementById("loadingProgress");

const shootingStars = document.getElementById("shootingStars");


/* =========================================================
   SOUND ENGINE — calm deep-space ambience
   (all synthesized in the browser, so no audio files needed)

   Three quiet layers play the whole time:
   1. Soft pad     — a slow, warm chord that "breathes"
   2. Cosmic wind  — very soft air that drifts in and out
   3. Star twinkles — rare, gentle bell notes, far away

   Every page has its own mood, and the sound glides
   smoothly from one mood to the next when the page changes.
   All sounds go through a big soft reverb so it feels like
   floating in open space.
========================================================= */

let audioCtx = null;
let soundMuted = false;

let masterGain = null;
let dryBus = null;
let reverbSend = null;

let whiteBuffer = null;
let brownBuffer = null;

let ambient = null;
let ambientOn = false;
let currentMood = "loading";
let twinkleTimer = null;

const MASTER_LEVEL = 0.85;
const PAD_LEVEL = 0.5;
const WIND_LEVEL = 0.05;

/* All twinkle notes belong to the same scale as the pad chords,
   so nothing ever sounds wrong or sharp */
const TWINKLE_POOLS = {
    high:  [587.33, 659.25, 739.99, 880.00, 987.77, 1174.66],
    low:   [293.66, 329.63, 369.99, 440.00, 493.88],
    minor: [587.33, 698.46, 880.00, 1046.50]
};

/* One mood per page:
   notes   = the 4 pad notes (Hz)
   cutoff  = how soft / bright the pad is
   level   = pad loudness      wind = wind loudness
   twinkle = gap between star notes (ms), loudness, pitch group */
const MOODS = {

    /* dark, quiet, waiting */
    loading: {
        notes: [73.42, 146.83, 220.00, 293.66],
        cutoff: 500, level: 0.70, wind: 1.0,
        twinkle: { gap: [9000, 15000], volume: 0.020, pitch: "high" }
    },

    /* the mission begins — open and calm */
    mission: {
        notes: [73.42, 164.81, 220.00, 329.63],
        cutoff: 700, level: 0.85, wind: 0.8,
        twinkle: { gap: [6000, 10000], volume: 0.025, pitch: "high" }
    },

    /* "Where it began" — warm and gentle */
    origin: {
        notes: [98.00, 146.83, 246.94, 293.66],
        cutoff: 800, level: 0.85, wind: 0.6,
        twinkle: { gap: [7000, 12000], volume: 0.030, pitch: "low" }
    },

    /* the calendar — light and soft */
    calendar: {
        notes: [73.42, 185.00, 220.00, 277.18],
        cutoff: 800, level: 0.80, wind: 0.5,
        twinkle: { gap: [6000, 10000], volume: 0.025, pitch: "high" }
    },

    /* the solar system — wide, airy, full of stars */
    solar: {
        notes: [73.42, 164.81, 246.94, 369.99],
        cutoff: 1000, level: 0.90, wind: 1.0,
        twinkle: { gap: [3500, 6500], volume: 0.028, pitch: "high" }
    },

    /* the numbers — calm and steady */
    status: {
        notes: [82.41, 164.81, 246.94, 329.63],
        cutoff: 650, level: 0.75, wind: 0.5,
        twinkle: { gap: [8000, 13000], volume: 0.020, pitch: "high" }
    },

    /* the password — quiet mystery */
    password: {
        notes: [73.42, 174.61, 261.63, 349.23],
        cutoff: 500, level: 0.70, wind: 0.9,
        twinkle: { gap: [10000, 16000], volume: 0.020, pitch: "minor" }
    },

    /* happy birthday — warm, bright, sparkly (still soft) */
    final: {
        notes: [73.42, 146.83, 220.00, 369.99],
        cutoff: 1400, level: 1.00, wind: 0.4,
        twinkle: { gap: [2500, 4500], volume: 0.035, pitch: "high" }
    },

    /* the letter — tender and slow */
    letter: {
        notes: [98.00, 146.83, 246.94, 369.99],
        cutoff: 750, level: 0.80, wind: 0.3,
        twinkle: { gap: [8000, 12000], volume: 0.025, pitch: "low" }
    }

};


/* ---------- audio graph: master volume + soft space reverb ---------- */

function makeImpulse(ctx, seconds, decay) {

    const length = Math.floor(ctx.sampleRate * seconds);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);

    for (let c = 0; c < 2; c++) {

        const data = impulse.getChannelData(c);
        let last = 0;

        for (let i = 0; i < length; i++) {

            const white = Math.random() * 2 - 1;

            /* one-pole low-pass makes the tail dark and soft */
            last = last + 0.35 * (white - last);

            data[i] = last * Math.pow(1 - i / length, decay);

        }

    }

    return impulse;

}

function buildAudioGraph(ctx) {

    masterGain = ctx.createGain();
    masterGain.gain.value = 0;

    /* clear out sub-rumble before it ever reaches the compressor */
    const subCut = ctx.createBiquadFilter();
    subCut.type = "highpass";
    subCut.frequency.value = 34;
    subCut.Q.value = 0.5;

    /* a touch of "air" on top so everything reads clean instead of muffled */
    const presence = ctx.createBiquadFilter();
    presence.type = "highshelf";
    presence.frequency.value = 3200;
    presence.gain.value = 2.5;

    /* gentle safety net so nothing can ever get loud or harsh */
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -22;
    compressor.knee.value = 20;
    compressor.ratio.value = 2.5;
    compressor.attack.value = 0.012;
    compressor.release.value = 0.35;

    masterGain.connect(subCut);
    subCut.connect(presence);
    presence.connect(compressor);
    compressor.connect(ctx.destination);

    dryBus = ctx.createGain();
    dryBus.connect(masterGain);

    /* stop the reverb tail from piling up into a muddy low-end wash */
    const reverbCut = ctx.createBiquadFilter();
    reverbCut.type = "highpass";
    reverbCut.frequency.value = 220;
    reverbCut.Q.value = 0.6;

    const reverb = ctx.createConvolver();
    reverb.buffer = makeImpulse(ctx, 6, 2.6);

    reverbSend = ctx.createGain();
    reverbSend.connect(reverbCut);
    reverbCut.connect(reverb);
    reverb.connect(masterGain);

}

function getAudioCtx() {

    if (!audioCtx) {

        const AC = window.AudioContext || window.webkitAudioContext;

        if (!AC) return null;

        audioCtx = new AC();
        buildAudioGraph(audioCtx);

    }

    if (audioCtx.state === "suspended") audioCtx.resume();

    return audioCtx;

}

/* send a sound to the speakers: "dry" = direct, "wet" = through the reverb */
function routeVoice(node, wet = 0.4, dry = 1) {

    const ctx = audioCtx;

    if (dry > 0) {

        if (dry === 1) {

            node.connect(dryBus);

        } else {

            const d = ctx.createGain();
            d.gain.value = dry;
            node.connect(d);
            d.connect(dryBus);

        }

    }

    if (wet > 0) {

        const w = ctx.createGain();
        w.gain.value = wet;
        node.connect(w);
        w.connect(reverbSend);

    }

}

function fadeMaster(target, seconds) {

    if (!audioCtx || !masterGain) return;

    const now = audioCtx.currentTime;

    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(target, now + seconds);

}

function getWhiteBuffer(ctx) {

    if (whiteBuffer) return whiteBuffer;

    const length = ctx.sampleRate * 3;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

    whiteBuffer = buffer;

    return buffer;

}

/* deep, soft "brown" noise — the base of the cosmic wind.
   The end is cross-faded into the start so the loop never clicks. */
function getBrownBuffer(ctx) {

    if (brownBuffer) return brownBuffer;

    const length = Math.floor(ctx.sampleRate * 8);
    const fade = Math.floor(ctx.sampleRate * 1);
    const raw = new Float32Array(length + fade);

    let last = 0;

    for (let i = 0; i < raw.length; i++) {

        const white = Math.random() * 2 - 1;

        last = (last + 0.02 * white) / 1.02;

        raw[i] = last * 3.5;

    }

    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) data[i] = raw[i];

    for (let i = 0; i < fade; i++) {

        const t = i / fade;

        data[i] = raw[i] * t + raw[length + i] * (1 - t);

    }

    brownBuffer = buffer;

    return buffer;

}


/* ---------- one-shot sounds (soft on purpose) ---------- */

function playTone({ freq = 440, endFreq = null, type = "sine", duration = 0.2, volume = 0.05, delay = 0, attack = 0.01, wet = 0.3 }) {

    if (soundMuted) return;

    const ctx = getAudioCtx();

    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;

    const startTime = ctx.currentTime + delay;

    osc.frequency.setValueAtTime(freq, startTime);

    if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 1), startTime + duration);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(volume, startTime + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    routeVoice(gain, wet, 1);

    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);

}

function playNoise({ duration = 0.5, volume = 0.04, delay = 0, filterType = "bandpass", filterFreq = 800, filterEnd = null, attack = 0.02, wet = 0.4, Q = 0.7 }) {

    if (soundMuted) return;

    const ctx = getAudioCtx();

    if (!ctx) return;

    const startTime = ctx.currentTime + delay;

    const source = ctx.createBufferSource();
    source.buffer = getWhiteBuffer(ctx);

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.Q.value = Q;
    filter.frequency.setValueAtTime(filterFreq, startTime);

    if (filterEnd) filter.frequency.exponentialRampToValueAtTime(filterEnd, startTime + duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(volume, startTime + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    source.connect(filter);
    filter.connect(gain);
    routeVoice(gain, wet, 1);

    source.start(startTime, Math.random() * 0.8);
    source.stop(startTime + duration + 0.05);

}

/* a soft, glassy "star" note: a pure tone + a very quiet upper shimmer */
function bell(freq, { volume = 0.04, delay = 0, decay = 2.5, wet = 0.8, dry = 0.6, pan = (Math.random() - 0.5) * 0.65 } = {}) {

    if (soundMuted) return;

    const ctx = getAudioCtx();

    if (!ctx) return;

    const startTime = ctx.currentTime + delay;

    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panner) {
        panner.pan.value = pan;
        routeVoice(panner, wet, dry);
    }

    [[1, 1, 1], [2.76, 0.10, 0.5]].forEach(([ratio, amount, life]) => {

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const length = decay * life;

        osc.type = "sine";
        osc.frequency.value = freq * ratio;

        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.linearRampToValueAtTime(volume * amount, startTime + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + length);

        if (panner) {
            osc.connect(gain);
            gain.connect(panner);
        } else {
            osc.connect(gain);
            routeVoice(gain, wet, dry);
        }

        osc.start(startTime);
        osc.stop(startTime + length + 0.05);

    });

}

const SFX = {

    /* soft tap */
    click() {
        playTone({ freq: 740, endFreq: 560, type: "sine", duration: 0.16, volume: 0.045, attack: 0.006, wet: 0.28 });
    },

    /* page change: a slow, airy swell like drifting through space */
    whoosh() {
        playNoise({ duration: 1.3, volume: 0.035, filterType: "bandpass", filterFreq: 300, filterEnd: 1400, attack: 0.5, wet: 0.6, Q: 0.9 });
        playTone({ freq: 130, endFreq: 90, type: "sine", duration: 1.2, volume: 0.03, attack: 0.4, wet: 0.5 });
    },

    /* loading progress: tiny far-away drop */
    tick() {
        bell(1318.51, { volume: 0.022, decay: 1.4, wet: 0.6, dry: 0.65, pan: 0 });
    },

    /* success: gentle rising star notes */
    success() {
        [587.33, 739.99, 880.00, 1174.66].forEach((f, i) => {
            bell(f, { volume: 0.05, delay: i * 0.2, decay: 3.2, wet: 0.85, dry: 0.6 });
        });
    },

    /* wrong password: soft low "hmm", never harsh */
    error() {
        playTone({ freq: 220, endFreq: 185, type: "sine", duration: 0.5, volume: 0.05, attack: 0.03, wet: 0.4 });
        playTone({ freq: 165, endFreq: 140, type: "sine", duration: 0.55, volume: 0.04, attack: 0.03, delay: 0.14, wet: 0.4 });
    },

    /* unlock: a soft shimmer that opens upward */
    unlock() {
        playTone({ freq: 300, endFreq: 900, type: "sine", duration: 0.7, volume: 0.03, attack: 0.15, wet: 0.6 });
        bell(1174.66, { volume: 0.04, delay: 0.35, decay: 3, wet: 0.85, dry: 0.6 });
    },

    /* blowing the candle: a soft breath */
    blow() {
        playNoise({ duration: 1.1, volume: 0.06, filterType: "lowpass", filterFreq: 900, filterEnd: 250, attack: 0.15, wet: 0.5, Q: 0.5 });
    },

    /* magic sparkle: little stars appearing */
    sparkle() {
        const pool = TWINKLE_POOLS.high;
        for (let i = 0; i < 6; i++) {
            bell(pool[Math.floor(Math.random() * pool.length)] * (Math.random() < 0.4 ? 2 : 1), {
                volume: 0.025, delay: i * 0.13, decay: 2.2, wet: 0.9, dry: 0.5
            });
        }
    },

    /* the wish: slow, warm, hopeful */
    chime() {
        [440.00, 587.33, 739.99, 880.00].forEach((f, i) => {
            bell(f, { volume: 0.05, delay: i * 0.32, decay: 4, wet: 0.9, dry: 0.6 });
        });
    },

    page() {
        playNoise({ duration: 0.5, volume: 0.02, filterType: "bandpass", filterFreq: 1800, attack: 0.1, wet: 0.5 });
    }

};


/* ---------- the ambient bed (pad + wind + twinkles) ---------- */

function createPadVoice(ctx, freq, destination, pan = 0) {

    const voiceGain = ctx.createGain();
    voiceGain.gain.value = 0.045;

    const oscA = ctx.createOscillator();
    oscA.type = "sine";
    oscA.frequency.value = freq;
    oscA.detune.value = -5;

    const oscB = ctx.createOscillator();
    oscB.type = "triangle";
    oscB.frequency.value = freq;
    oscB.detune.value = 5;

    const softB = ctx.createGain();
    softB.gain.value = 0.35;

    oscA.connect(voiceGain);
    oscB.connect(softB);
    softB.connect(voiceGain);

    /* very slow "breathing" so the chord is never static */
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.03 + Math.random() * 0.05;

    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.015;

    lfo.connect(lfoDepth);
    lfoDepth.connect(voiceGain.gain);

    /* spread the four pad notes gently across the stereo field so the
       chord stays legible instead of stacking up in the center */
    if (ctx.createStereoPanner) {
        const panner = ctx.createStereoPanner();
        panner.pan.value = pan;
        voiceGain.connect(panner);
        panner.connect(destination);
    } else {
        voiceGain.connect(destination);
    }

    oscA.start();
    oscB.start();
    lfo.start();

    return { oscA, oscB, lfo };

}

function startAmbient() {

    if (soundMuted || ambientOn) return;

    const ctx = getAudioCtx();

    if (!ctx) return;

    const firstTime = !ambient;

    if (firstTime) {

        const mood = MOODS[currentMood];

        /* pad */
        const padFilter = ctx.createBiquadFilter();
        padFilter.type = "lowpass";
        padFilter.frequency.value = mood.cutoff;
        padFilter.Q.value = 0.3;

        const padGain = ctx.createGain();
        padGain.gain.value = mood.level * PAD_LEVEL;

        padFilter.connect(padGain);
        routeVoice(padGain, 0.55, 0.85);

        const PAD_PANS = [-0.35, -0.12, 0.12, 0.35];
        const voices = mood.notes.map((f, i) => createPadVoice(ctx, f, padFilter, PAD_PANS[i] || 0));

        /* slow drift in the pad's brightness */
        const filterLfo = ctx.createOscillator();
        filterLfo.type = "sine";
        filterLfo.frequency.value = 0.04;

        const filterLfoDepth = ctx.createGain();
        filterLfoDepth.gain.value = 120;

        filterLfo.connect(filterLfoDepth);
        filterLfoDepth.connect(padFilter.frequency);
        filterLfo.start();

        /* cosmic wind */
        const windSource = ctx.createBufferSource();
        windSource.buffer = getBrownBuffer(ctx);
        windSource.loop = true;

        const windFilter = ctx.createBiquadFilter();
        windFilter.type = "lowpass";
        windFilter.frequency.value = 650;
        windFilter.Q.value = 0.7;

        const windGain = ctx.createGain();
        windGain.gain.value = mood.wind * WIND_LEVEL;

        windSource.connect(windFilter);
        windFilter.connect(windGain);
        routeVoice(windGain, 0.5, 0.9);

        const windFilterLfo = ctx.createOscillator();
        windFilterLfo.type = "sine";
        windFilterLfo.frequency.value = 0.05;

        const windFilterDepth = ctx.createGain();
        windFilterDepth.gain.value = 220;

        windFilterLfo.connect(windFilterDepth);
        windFilterDepth.connect(windFilter.frequency);

        const windBreathLfo = ctx.createOscillator();
        windBreathLfo.type = "sine";
        windBreathLfo.frequency.value = 0.035;

        const windBreathDepth = ctx.createGain();
        windBreathDepth.gain.value = mood.wind * WIND_LEVEL * 0.4;

        windBreathLfo.connect(windBreathDepth);
        windBreathDepth.connect(windGain.gain);

        windSource.start();
        windFilterLfo.start();
        windBreathLfo.start();

        ambient = { voices, padFilter, padGain, windGain, windBreathDepth };

    }

    ambientOn = true;

    fadeMaster(MASTER_LEVEL, firstTime ? 5 : 1.5);

    scheduleTwinkle();

}

function stopAmbient() {

    ambientOn = false;

    clearTimeout(twinkleTimer);

    if (!audioCtx) return;

    fadeMaster(0, 0.8);

    /* fully pause the audio engine while muted */
    setTimeout(() => {

        if (soundMuted && audioCtx) audioCtx.suspend();

    }, 1000);

}

/* glide the whole soundscape to a new page mood */
function setMood(name) {

    if (!MOODS[name]) return;

    currentMood = name;

    if (!ambient || !audioCtx) return;

    const mood = MOODS[name];
    const now = audioCtx.currentTime;

    ambient.voices.forEach((voice, i) => {

        voice.oscA.frequency.setTargetAtTime(mood.notes[i], now, 2.2);
        voice.oscB.frequency.setTargetAtTime(mood.notes[i], now, 2.2);

    });

    ambient.padFilter.frequency.setTargetAtTime(mood.cutoff, now, 2.5);
    ambient.padGain.gain.setTargetAtTime(mood.level * PAD_LEVEL, now, 2);
    ambient.windGain.gain.setTargetAtTime(mood.wind * WIND_LEVEL, now, 2);
    ambient.windBreathDepth.gain.setTargetAtTime(mood.wind * WIND_LEVEL * 0.4, now, 2);

}

function scheduleTwinkle() {

    clearTimeout(twinkleTimer);

    if (!ambientOn || soundMuted) return;

    const mood = MOODS[currentMood];
    const [minGap, maxGap] = mood.twinkle.gap;

    twinkleTimer = setTimeout(() => {

        if (ambientOn && !soundMuted && !document.hidden) {

            const t = MOODS[currentMood].twinkle;
            const pool = TWINKLE_POOLS[t.pitch];

            bell(pool[Math.floor(Math.random() * pool.length)], {
                volume: t.volume, decay: 4, wet: 0.9, dry: 0.5
            });

        }

        scheduleTwinkle();

    }, minGap + Math.random() * (maxGap - minGap));

}


/* ---------- sound button + browser rules ---------- */

const soundToggleButton = document.getElementById("soundToggle");

function updateSoundToggleUI() {

    if (!soundToggleButton) return;

    soundToggleButton.textContent = soundMuted ? "🔇" : "🔊";
    soundToggleButton.classList.toggle("muted", soundMuted);

}

if (soundToggleButton) {

    soundToggleButton.addEventListener("click", (event) => {

        event.stopPropagation();

        soundMuted = !soundMuted;

        updateSoundToggleUI();

        if (soundMuted) {

            stopAmbient();

        } else {

            getAudioCtx();
            startAmbient();

        }

    });

}

/* Browsers block sound until the first tap, so the space ambience
   starts softly (fades in) on the very first touch or click */
const PRIME_EVENTS = ["pointerdown", "touchend", "click", "keydown"];

function primeAudioOnce() {

    const ctx = getAudioCtx();

    if (!ctx) return;

    startAmbient();

    if (ctx.state === "running") {

        PRIME_EVENTS.forEach(name => document.removeEventListener(name, primeAudioOnce));

    }

}

PRIME_EVENTS.forEach(name => document.addEventListener(name, primeAudioOnce));

/* hush the sound when the tab is hidden, bring it back gently */
document.addEventListener("visibilitychange", () => {

    if (!audioCtx) return;

    if (document.hidden) {

        fadeMaster(0, 0.4);

        setTimeout(() => {

            if (document.hidden && audioCtx) audioCtx.suspend();

        }, 500);

    } else if (!soundMuted && ambientOn) {

        audioCtx.resume();

        fadeMaster(MASTER_LEVEL, 1.5);

        scheduleTwinkle();

    }

});


/* =========================================================
   ALL SCREENS
========================================================= */

const screens = [
    loadingScreen,
    missionScreen,
    originScreen,
    calendarScreen,
    solarScreen,
    statusScreen,
    passwordScreen,
    finalScreen,
    letterScreen
];


/* which sound mood belongs to which page */
function moodForScreen(target) {

    if (target === loadingScreen) return "loading";
    if (target === missionScreen) return "mission";
    if (target === originScreen) return "origin";
    if (target === calendarScreen) return "calendar";
    if (target === solarScreen) return "solar";
    if (target === statusScreen) return "status";
    if (target === passwordScreen) return "password";
    if (target === finalScreen) return "final";
    if (target === letterScreen) return "letter";

    return "mission";

}


/* =========================================================
   SHOW SCREEN
========================================================= */

let screenTimer;

function showScreen(target) {

    SFX.whoosh();

    setMood(moodForScreen(target));

    screens.forEach(screen => {

        if (!screen) return;

        screen.classList.remove("active");
        screen.classList.add("hidden");

    });

    clearTimeout(screenTimer);

    screenTimer = setTimeout(() => {

        target.classList.remove("hidden");
        target.classList.add("active");

        target.scrollTop = 0;

        if (target === statusScreen) runCounters();

    }, 650);

    /* Moon stays hidden only during the loading boot sequence */
    document.body.classList.toggle("state-loading", target === loadingScreen);
    document.body.classList.toggle("hide-moon", target === solarScreen);

    /* The black hole is a one-time accent, reserved for the
       password chapter onward so it doesn't repeat everywhere */
    const showBlackHole =
        target === passwordScreen ||
        target === finalScreen ||
        target === letterScreen;

    document.body.classList.toggle("show-black-hole", showBlackHole);

}


/* =========================================================
   LOADING SEQUENCE
========================================================= */

const loadingMessages = [
    "Warming up the engines...",
    "Opening the sky...",
    "Adding the stars...",
    "Setting the date...",
    "Almost there...",
    "Ready for launch."
];

let loadingIndex = 0;

function runLoading() {

    let progress = 0;

    const progressTimer = setInterval(() => {

        progress += 1;

        loadingProgress.style.width = progress + "%";

        if (progress >= 100) {

            clearInterval(progressTimer);

        }

    }, 45);


    const messageTimer = setInterval(() => {

        if (loadingIndex < loadingMessages.length) {

            loadingText.textContent =
                loadingMessages[loadingIndex];

            SFX.tick();

            loadingIndex++;

        } else {

            clearInterval(messageTimer);

            setTimeout(() => {

                showScreen(missionScreen);

            }, 900);

        }

    }, 850);

}


/* =========================================================
   SHOOTING STARS (random, continuous, on every screen —
   most noticeable during the loading boot sequence since
   there's nothing else on screen to compete with it)
========================================================= */

function createShootingStar() {

    const star = document.createElement("div");

    star.className = "shooting-star";

    /* one gentle slant, random start, random speed: looks like a real meteor */
    star.style.left = (Math.random() * window.innerWidth * 0.8) + "px";
    star.style.top = (Math.random() * window.innerHeight * 0.45) + "px";
    star.style.setProperty("--a", (20 + Math.random() * 25) + "deg");
    star.style.setProperty("--d", (260 + Math.random() * 380) + "px");
    star.style.setProperty("--len", (100 + Math.random() * 120) + "px");
    star.style.animationDuration = (0.8 + Math.random() * 0.7) + "s";

    shootingStars.appendChild(star);

    star.addEventListener("animationend", () => star.remove());

}

function startShootingStars() {

    function scheduleNext() {

        const delay = 2000 + Math.random() * 4000;

        setTimeout(() => {

            createShootingStar();

            scheduleNext();

        }, delay);

    }

    scheduleNext();

}


/* =========================================================
   STAR FIELD (each star has its own size, position and blink)
========================================================= */

function createStarField() {

    const bg = document.getElementById("spaceBackground");
    const box = document.createElement("div");

    box.id = "starField";
    bg.insertBefore(box, shootingStars);

    const count = Math.round(Math.min(160, Math.max(60, window.innerWidth * window.innerHeight / 9000)));

    for (let i = 0; i < count; i++) {

        const star = document.createElement("i");
        const size = 1 + Math.random() * 2.2;

        star.style.left = (Math.random() * 100) + "%";
        star.style.top = (Math.random() * 100) + "%";
        star.style.width = size + "px";
        star.style.height = size + "px";

        if (size > 2.3) star.classList.add("glow");

        if (Math.random() < 0.55) {
            star.classList.add("blink");
            star.style.animationDuration = (1.8 + Math.random() * 3.5) + "s";
            star.style.animationDelay = (-Math.random() * 5) + "s";
        }

        box.appendChild(star);

    }

}


/* =========================================================
   MISSION → ORIGIN
========================================================= */

document
    .getElementById("missionNext")
    .addEventListener("click", () => {

        showScreen(originScreen);

        startStarSequence();

    });

document
    .getElementById("missionBack")
    .addEventListener("click", () => {

        showScreen(loadingScreen);

    });


/* =========================================================
   ORIGIN STORY SEQUENCE
========================================================= */

function startStarSequence() {

    const text = document.getElementById("starText");

    const messages = [
        "Checking the night sky...",
        "Billions of stars found.",
        "Looking for one special star...",
        "Found it!"
    ];

    let index = 0;

    text.textContent = messages[0];

    const timer = setInterval(() => {

        index++;

        if (index >= messages.length) {

            clearInterval(timer);

            return;

        }

        text.style.opacity = "0";

        setTimeout(() => {

            text.textContent = messages[index];
            text.style.opacity = "1";

            SFX.tick();

        }, 400);

    }, 1500);

}

document
    .getElementById("originNext")
    .addEventListener("click", () => {

        showScreen(calendarScreen);

    });

document
    .getElementById("originBack")
    .addEventListener("click", () => {

        showScreen(missionScreen);

    });


/* =========================================================
   CALENDAR — SEPTEMBER 2026, 25th HIGHLIGHTED
========================================================= */

function buildCalendar() {

    const weekdaysEl = document.getElementById("calendarWeekdays");
    const gridEl = document.getElementById("calendarGrid");

    if (!weekdaysEl || !gridEl || gridEl.dataset.built) return;

    const weekdayNames = ["S", "M", "T", "W", "T", "F", "S"];

    weekdayNames.forEach(label => {

        const cell = document.createElement("div");

        cell.textContent = label;

        weekdaysEl.appendChild(cell);

    });

    const year = 2026;
    const month = 8; /* September, 0-indexed */

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < firstDay; i++) {

        const empty = document.createElement("div");

        empty.className = "empty";

        gridEl.appendChild(empty);

    }

    for (let day = 1; day <= daysInMonth; day++) {

        const cell = document.createElement("div");

        cell.textContent = day;

        if (day === 25) {

            cell.classList.add("highlight-day");

        }

        gridEl.appendChild(cell);

    }

    gridEl.dataset.built = "true";

}

document
    .getElementById("calendarNext")
    .addEventListener("click", () => {

        showScreen(solarScreen);

    });

document
    .getElementById("calendarBack")
    .addEventListener("click", () => {

        showScreen(originScreen);

    });


/* =========================================================
   SOLAR → STATUS
========================================================= */

document
    .getElementById("solarNext")
    .addEventListener("click", () => {

        showScreen(statusScreen);

    });

document
    .getElementById("solarBack")
    .addEventListener("click", () => {

        showScreen(calendarScreen);

    });


/* =========================================================
   STATUS → PASSWORD
========================================================= */

document
    .getElementById("statusNext")
    .addEventListener("click", () => {

        showScreen(passwordScreen);

    });

document
    .getElementById("statusBack")
    .addEventListener("click", () => {

        showScreen(solarScreen);

    });


/* =========================================================
   SHOW / HIDE PASSWORD
========================================================= */

const passwordInput =
    document.getElementById("passwordInput");

const showPasswordButton =
    document.getElementById("showPassword");

showPasswordButton.addEventListener("click", () => {

    if (passwordInput.type === "password") {

        passwordInput.type = "text";

        showPasswordButton.textContent = "HIDE";

    } else {

        passwordInput.type = "password";

        showPasswordButton.textContent = "SHOW";

    }

});


/* =========================================================
   PASSWORD UNLOCK
========================================================= */

const unlockButton =
    document.getElementById("unlockButton");

const passwordFeedback =
    document.getElementById("passwordFeedback");

function unlockMission() {

    const enteredPassword =
        passwordInput.value.trim();

    const correctPassword = "25092007";

    if (enteredPassword === correctPassword) {

        passwordFeedback.textContent = "Correct! Opening your surprise...";
        passwordFeedback.classList.remove("wrong");
        passwordFeedback.classList.add("show", "correct");

        SFX.unlock();

        setTimeout(() => {

            passwordInput.value = "";
            passwordInput.dispatchEvent(new Event("input"));

            showScreen(finalScreen);

            setTimeout(fireSparkleBurst, 500);
            setTimeout(() => SFX.success(), 600);

        }, 700);

    } else {

        passwordFeedback.textContent = "Wrong password. Try again.";
        passwordFeedback.classList.remove("correct");
        passwordFeedback.classList.add("show", "wrong");

        SFX.error();

        passwordInput.classList.add("shake");

        setTimeout(() => {

            passwordInput.classList.remove("shake");

        }, 400);

    }

}

unlockButton.addEventListener("click", unlockMission);

passwordInput.addEventListener("keydown", (event) => {

    if (event.key === "Enter") {

        unlockMission();

    }

});

document
    .getElementById("passwordBack")
    .addEventListener("click", () => {

        showScreen(statusScreen);

    });


/* =========================================================
   SPARKLE BURST — plays once when the final file unlocks
========================================================= */

function fireSparkleBurst() {

    const container = document.getElementById("sparkleBurst");

    if (!container) return;

    SFX.sparkle();

    const count = 26;

    for (let i = 0; i < count; i++) {

        const piece = document.createElement("div");

        piece.className = "sparkle-piece";

        const angle = (Math.PI * 2 * i) / count;

        const distance = 120 + Math.random() * 160;

        const sx = Math.cos(angle) * distance;
        const sy = Math.sin(angle) * distance;

        piece.style.setProperty("--sx", sx + "px");
        piece.style.setProperty("--sy", sy + "px");

        piece.style.animationDelay = (Math.random() * 0.15) + "s";

        container.appendChild(piece);

        setTimeout(() => piece.remove(), 1800);

    }

}


/* =========================================================
   MAKE A WISH
========================================================= */

const wishButton = document.getElementById("wishButton");
const wishResult = document.getElementById("wishResult");

wishButton.addEventListener("click", () => {

    wishButton.disabled = true;

    SFX.chime();

    wishResult.classList.add("show");

    wishResult.querySelectorAll("span").forEach((line, i) => {
        setTimeout(() => line.classList.add("on"), 500 + i * 1300);
    });

    [0, 400, 800].forEach(d => setTimeout(createShootingStar, d));

});


/* =========================================================
   LETTER SCREEN
========================================================= */

document
    .getElementById("letterButton")
    .addEventListener("click", () => {

        showScreen(letterScreen);

    });

document
    .getElementById("letterBack")
    .addEventListener("click", () => {

        showScreen(finalScreen);

    });


/* =========================================================
   RESTART
========================================================= */

function restartMission() {

    resetExtras();

    loadingIndex = 0;

    loadingProgress.style.width = "0%";

    loadingText.textContent =
        "Warming up the engines...";

    wishButton.disabled = true;
    wishButton.style.opacity = "1";
    wishResult.classList.remove("show");

    passwordFeedback.classList.remove("show", "correct", "wrong");
    passwordFeedback.textContent = "";

    showScreen(loadingScreen);

    setTimeout(() => {

        runLoading();

    }, 500);

}



document
    .getElementById("letterRestartButton")
    .addEventListener("click", restartMission);


/* =========================================================
   PARALLAX SPACE EFFECT
========================================================= */

document.addEventListener(
    "mousemove",
    (event) => {

        const x =
            (event.clientX / window.innerWidth - 0.5);

        const y =
            (event.clientY / window.innerHeight - 0.5);

        const milkyWay =
            document.querySelector(".milky-way");

        const brightStars =
            document.querySelector(".stars-bright");

        if (milkyWay) {

            milkyWay.style.transform =
                `translate(${x * 18}px, ${y * 12}px) rotate(-18deg)`;

        }

        if (brightStars) {

            brightStars.style.transform =
                `translate(${x * -12}px, ${y * -8}px)`;

        }

    }
);


document.getElementById("finalBack").addEventListener("click", () => showScreen(passwordScreen));

/* =========================================================
   CANDLE MAGIC
========================================================= */

const cake = document.querySelector(".cake");
const cakeHint = document.getElementById("cakeHint");
const blowButton = document.getElementById("blowButton");
const magicLayer = document.getElementById("magicLayer");

function magicRise() {

    const r = cake.getBoundingClientRect();

    for (let i = 0; i < 40; i++) {

        const dot = document.createElement("i");

        dot.className = "magic-dot";
        dot.style.left = (r.left + r.width / 2 + (Math.random() - 0.5) * r.width) + "px";
        dot.style.top = (r.top + r.height / 3) + "px";
        dot.style.setProperty("--dx", ((Math.random() - 0.5) * 280) + "px");
        dot.style.setProperty("--dy", (-(160 + Math.random() * 340)) + "px");
        dot.style.animationDelay = (Math.random() * 0.6) + "s";
        dot.style.animationDuration = (1.6 + Math.random() * 1.4) + "s";

        magicLayer.appendChild(dot);

        dot.addEventListener("animationend", () => dot.remove());

    }

}

function blowCandle() {

    if (cake.classList.contains("out")) return;

    cake.classList.add("out");
    blowButton.disabled = true;
    wishButton.disabled = false;
    cakeHint.textContent = "The candle is out. Now make your wish.";

    SFX.blow();

    fireSparkleBurst();
    magicRise();

    [0, 300, 600, 900, 1200].forEach(d => setTimeout(createShootingStar, d));

    document.body.classList.add("magic-flash");

    setTimeout(() => document.body.classList.remove("magic-flash"), 1600);

}

blowButton.addEventListener("click", blowCandle);
cake.addEventListener("click", blowCandle);

function resetExtras() {

    cake.classList.remove("out");
    blowButton.disabled = false;
    cakeHint.textContent = "Blow out the candle, then make a wish.";

    wishResult.querySelectorAll("span").forEach(line => line.classList.remove("on"));

    document.querySelectorAll(".pin-dots i").forEach(dot => dot.classList.remove("on"));

}

passwordInput.addEventListener("input", () => {

    document.querySelectorAll(".pin-dots i").forEach((dot, i) => {
        dot.classList.toggle("on", i < passwordInput.value.length);
    });

});


/* =========================================================
   PERCENT COUNTERS (chapter 5)
========================================================= */

function runCounters() {

    document.querySelectorAll(".count-up").forEach(el => {

        const target = Number(el.dataset.to);
        const begin = performance.now();

        function tick(now) {

            const t = Math.min(1, (now - begin) / 1800);

            el.textContent = Math.round(target * (1 - Math.pow(1 - t, 3)));

            if (t < 1) requestAnimationFrame(tick);

        }

        el.textContent = "0";

        requestAnimationFrame(tick);

    });

}


/* =========================================================
   POINTER MAGIC: star trail + tap bounce
========================================================= */

let lastTrail = 0;

function spawnTrail(x, y, burst) {

    const dot = document.createElement("i");
    const isStar = Math.random() < 0.4;
    const size = (3 + Math.random() * 4) * (isStar ? 2 : 1);

    dot.className = "trail" + (isStar ? " star" : "");
    dot.style.left = x + "px";
    dot.style.top = y + "px";
    dot.style.width = size + "px";
    dot.style.height = size + "px";
    dot.style.setProperty("--tx", ((Math.random() - 0.5) * (burst ? 130 : 44)) + "px");
    dot.style.setProperty("--ty", ((Math.random() - 0.4) * (burst ? 130 : 50) + (burst ? 0 : 16)) + "px");

    document.body.appendChild(dot);

    dot.addEventListener("animationend", () => dot.remove());

}

document.addEventListener("pointermove", (event) => {

    const now = performance.now();

    if (now - lastTrail < 45) return;

    lastTrail = now;

    spawnTrail(event.clientX, event.clientY, false);

});

const bounceTargets =
    "button, .data-card, .status-card, .calendar-grid div:not(.empty), .overall-status-box, " +
    ".origin-note, .calendar-message, .final-message, .letter-paragraph, .timeline li, " +
    ".cake, .hero-planet, .password-box, h1, h2";

document.addEventListener("pointerdown", (event) => {

    for (let i = 0; i < 8; i++) spawnTrail(event.clientX, event.clientY, true);

    const el = event.target.closest(bounceTargets);

    if (!el || el.disabled) return;

    if (el.tagName === "BUTTON") SFX.click();

    el.animate([
        { transform: "scale(1)", filter: "brightness(1)" },
        { transform: "scale(0.94)", filter: "brightness(1.5)", offset: 0.3 },
        { transform: "scale(1.04)", filter: "brightness(1.35)", offset: 0.65 },
        { transform: "scale(1)", filter: "brightness(1)" }
    ], { duration: 480, easing: "ease-out" });

});




/* =========================================================
   BIRTHDAY COUNTDOWN
========================================================= */

function updateCountdown() {

    const chip = document.getElementById("countChip");

    if (!chip) return;

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    let target = new Date(now.getFullYear(), 8, 25);

    if (today > target) target = new Date(now.getFullYear() + 1, 8, 25);

    const days = Math.round((target - today) / 86400000);

    chip.textContent = days === 0
        ? "🎂 Today is your birthday!"
        : "🚀 Your birthday mission is ready";

}


/* =========================================================
   START
========================================================= */

window.addEventListener("load", () => {

    document.body.classList.add("state-loading");

    buildCalendar();
    updateCountdown();
    createStarField();
    setTimeout(createShootingStar, 1200);

    /*
       Small delay makes the opening feel like
       an actual mission boot instead of instantly
       throwing the box onto the screen.
    */

    setTimeout(() => {

        runLoading();

    }, 700);

    startShootingStars();

});


/* =========================================================
   PANEL DECORATIONS (top line with dots, bottom signal bars)
========================================================= */

document
    .querySelectorAll(".loading-core, .mission-box, .origin-content, .calendar-content, .status-wrapper, .password-wrapper, .final-wrapper, .letter-wrapper, .solar-textbox")
    .forEach(panel => {

        const top = document.createElement("div");
        top.className = "deco-top";
        top.innerHTML = "<i></i><i></i><i></i>";

        const bottom = document.createElement("div");
        bottom.className = "deco-bottom";
        bottom.innerHTML = "<b></b><b></b><b></b><b></b><b></b>";

        panel.insertBefore(top, panel.firstChild);
        panel.appendChild(bottom);

    });
