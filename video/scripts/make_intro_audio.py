"""Synthesises the intro's music bed and sound effects, in sync with src/timeline.json.

Everything here is generated from scratch (no samples), so there is no licensing question.
Run from the ireport-video folder:   python scripts/make_intro_audio.py

Outputs
  public/audio/intro-bed.wav       music: 120 BPM, D minor -> F major lift on the logo
  public/sfx/pop.wav               small UI pop (city pins, issue tiles)
  public/sfx/whoosh-soft.wav       scene transition, loudest at 0.4 s (= the cut)
  public/sfx/pin-drop.wav          soft thud when the map pin lands
  public/sfx/status-1..4.wav       mallet notes D5 F5 A5 D6 for the four status steps
  public/sfx/dot-chime.wav         glassy ping when the lime dot appears
  public/sfx/logo-impact.wav       boom + air on the logo reveal
"""
import json
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, sosfilt

ROOT = Path(__file__).resolve().parent.parent
T = json.loads((ROOT / "src/timeline.json").read_text())
SR = 48000
FPS = T["fps"]
BEAT = 60 / T["bpm"]
BAR = 4 * BEAT
DUR = T["durationInFrames"] / FPS
EV = T["events"]
rng = np.random.default_rng(7)


def sec(frame):
    return frame / FPS


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def lp(x, f, order=2):
    return sosfilt(butter(order, f, "low", fs=SR, output="sos"), x)


def hp(x, f, order=2):
    return sosfilt(butter(order, f, "high", fs=SR, output="sos"), x)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], "band", fs=SR, output="sos"), x)


def tvec(seconds):
    return np.arange(int(seconds * SR)) / SR


def place(buf, sig, at):
    """Add a mono or stereo signal into a stereo buffer at time `at` (s)."""
    if sig.ndim == 1:
        sig = np.stack([sig, sig], 1)
    i = int(at * SR)
    if i >= len(buf):
        return
    n = min(len(sig), len(buf) - i)
    buf[i:i + n] += sig[:n]


def reverb(x, seconds=2.2, damp=5000, mix=0.3):
    """Cheap stereo plate: exponentially decaying noise, darkened, convolved."""
    t = tvec(seconds)
    irs = [lp(rng.standard_normal(len(t)) * np.exp(-t / (seconds / 6.5)), damp) for _ in range(2)]
    irs = [ir / np.sqrt((ir ** 2).sum()) for ir in irs]
    mono = x.mean(1) if x.ndim == 2 else x
    wet = np.stack([fftconvolve(mono, ir)[:len(mono)] for ir in irs], 1)
    dry = x if x.ndim == 2 else np.stack([x, x], 1)
    return dry * (1 - mix) + wet * mix * 1.6


def saw(f, t, detune_cents=0.0):
    f = f * 2 ** (detune_cents / 1200)
    nh = max(1, min(30, int(9000 / f)))
    ph = rng.uniform(0, 2 * np.pi)
    return sum(np.sin(2 * np.pi * k * f * t + k * ph) / k for k in range(1, nh + 1)) * 0.6


def pad_chord(notes, seconds, bright):
    t = tvec(seconds)
    left = sum(saw(hz(n), t, -7) + 0.6 * saw(hz(n), t, 4) for n in notes)
    right = sum(saw(hz(n), t, 7) + 0.6 * saw(hz(n), t, -4) for n in notes)
    sig = np.stack([lp(left, bright, 2), lp(right, bright, 2)], 1) / (len(notes) * 1.6)
    return sig


def env(seconds, attack, release):
    t = tvec(seconds)
    e = np.minimum(1, t / max(attack, 1e-4))
    return e * np.clip((seconds - t) / max(release, 1e-4), 0, 1)


def kick(level=1.0):
    t = tvec(0.45)
    f = 44 + 120 * np.exp(-t / 0.028)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.16)
    click = hp(rng.standard_normal(len(t)), 3000) * np.exp(-t / 0.004) * 0.25
    return np.tanh(1.6 * (body + click)) * level


def clap(level=1.0):
    t = tvec(0.35)
    n = bp(rng.standard_normal(len(t)), 900, 3200)
    e = sum(np.exp(-np.maximum(t - d, 0) / 0.012) * (t >= d) for d in (0, 0.011, 0.022))
    e = e * 0.5 + np.exp(-t / 0.11) * (t >= 0.022)
    return n * e * level


def hat(level=1.0):
    t = tvec(0.08)
    return hp(rng.standard_normal(len(t)), 7500) * np.exp(-t / 0.018) * level


def pluck(midi, seconds=0.32, level=1.0):
    t = tvec(seconds)
    f = hz(midi)
    s = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(4 * np.pi * f * t) + 0.12 * np.sin(6 * np.pi * f * t)
    return s * np.exp(-t / 0.09) * np.minimum(1, t / 0.002) * level


def bass(midi, seconds, level=1.0):
    t = tvec(seconds)
    f = hz(midi)
    s = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t)
    return lp(np.tanh(1.4 * s), 500) * np.exp(-t / (seconds * 0.6)) * np.minimum(1, t / 0.004) * level


def bell(midi, seconds=2.4, level=1.0):
    """Two-operator FM bell."""
    t = tvec(seconds)
    f = hz(midi)
    idx = 2.2 * np.exp(-t / 0.5)
    s = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * 3.5 * t))
    return s * np.exp(-t / 0.7) * np.minimum(1, t / 0.002) * level


def mallet(midi, seconds=0.9, level=1.0):
    t = tvec(seconds)
    f = hz(midi)
    s = np.sin(2 * np.pi * f * t) + 0.5 * np.sin(2 * np.pi * f * 3.99 * t) * np.exp(-t / 0.04)
    return s * np.exp(-t / 0.22) * np.minimum(1, t / 0.0015) * level


def sweep_noise(seconds, f0, f1, curve=2.0):
    """Noise through a band-pass whose centre moves from f0 to f1 (block-wise)."""
    n = int(seconds * SR)
    x = rng.standard_normal(n)
    out = np.zeros(n)
    blk = 1024
    for i in range(0, n, blk):
        p = (i / n) ** curve
        c = f0 * (f1 / f0) ** p
        out[i:i + blk] = bp(x[i:i + blk + 256], c * 0.7, min(c * 1.4, SR / 2 - 100))[:len(out[i:i + blk])]
    return out


def norm(x, peak=0.89):
    return x / (np.abs(x).max() + 1e-9) * peak


def save(path, x):
    if x.ndim == 1:
        x = np.stack([x, x], 1)
    path = ROOT / path
    path.parent.mkdir(parents=True, exist_ok=True)
    wavfile.write(path, SR, (np.clip(x, -1, 1) * 32767).astype(np.int16))
    print(f"wrote {path.relative_to(ROOT)}  {len(x) / SR:.2f}s")


# ------------------------------------------------------------------ music bed
def music_bed():
    n = int(DUR * SR)
    pads = np.zeros((n, 2))
    drums = np.zeros((n, 2))
    tonal = np.zeros((n, 2))  # plucks/bells, goes through reverb

    impact = sec(EV["impact"])  # = start of bar 5 (8.0 s)
    # Chords (MIDI). Dm9 -> Dm9 -> Bbmaj7 -> Csus2 -> Fmaj9 (the lift on the logo).
    chords = [
        (0 * BAR, [50, 53, 57, 60, 64], 700),
        (2 * BAR, [46, 50, 53, 57, 62], 1600),
        (3 * BAR, [48, 55, 60, 62, 67], 2400),
        (impact, [41, 53, 57, 60, 64, 67], 4200),
    ]
    for i, (start, notes, bright) in enumerate(chords):
        end = chords[i + 1][0] if i + 1 < len(chords) else DUR
        length = end - start + 0.25
        sig = pad_chord(notes, length, bright) * env(length, 0.9 if i == 0 else 0.06, 0.3)[:, None]
        place(pads, sig * (0.55 if i < 3 else 0.75), start)

    # Sub drone under the problem section.
    t = tvec(impact)
    drone = np.sin(2 * np.pi * hz(38) * t) * np.minimum(1, t / 1.2) * 0.35
    place(pads, drone * np.clip((impact - 0.05 - t) / 0.05, 0, 1), 0)

    gap = impact - BEAT / 2  # half-beat of silence before the reveal
    sixteenth = BEAT / 4

    # Hats: 16ths from beat 2 of bar 1, quiet, getting busier.
    for k in range(int(gap / sixteenth)):
        at = k * sixteenth
        if at < BEAT:
            continue
        accent = 1.0 if k % 2 == 0 else 0.55
        place(drums, hat(0.10 * accent * (0.6 if at < BAR else 1.0)), at)

    # Kick: half-time in bar 2, four-on-the-floor from bar 3.
    for b in range(int(gap / BEAT)):
        at = b * BEAT
        if at < BAR:
            continue
        if at < 2 * BAR and b % 2:
            continue
        place(drums, kick(0.75), at)
    # Clap on 2 & 4 from bar 3.
    for b in range(int(gap / BEAT)):
        at = b * BEAT
        if at >= 2 * BAR and b % 4 in (1, 3):
            place(drums, clap(0.32), at)

    # Bass 8ths: D in bars 2-3, Bb, C.
    roots = {1: 38, 2: 34, 3: 36}
    for k in range(int(gap / (BEAT / 2))):
        at = k * BEAT / 2
        bar = int(at // BAR)
        if bar in roots:
            place(tonal, bass(roots[bar], BEAT / 2 * 0.95, 0.42 if k % 2 == 0 else 0.3), at)

    # Arp: 16ths over bars 3-4, chord tones, rising octave on the last half bar.
    arps = {2: [62, 65, 69, 72, 74, 72, 69, 65], 3: [60, 64, 67, 72, 74, 72, 67, 64]}
    for k in range(int(gap / sixteenth)):
        at = k * sixteenth
        bar = int(at // BAR)
        if bar in arps:
            pat = arps[bar]
            note = pat[k % len(pat)] + (12 if at > 3 * BAR + 2 * BEAT else 0)
            place(tonal, pluck(note, level=0.16), at)

    # Riser into the reveal: band-passed noise sweeping up + a rising tone.
    rs = 3 * BAR
    rlen = gap - rs + 0.04
    rt = tvec(rlen)
    rnoise = sweep_noise(rlen, 400, 9000) * (rt / rlen) ** 2.2 * 0.45
    rtone = np.sin(2 * np.pi * np.cumsum(220 * 2 ** (2 * rt / rlen)) / SR) * (rt / rlen) ** 3 * 0.08
    place(pads, np.stack([rnoise + rtone, np.roll(rnoise, 240) + rtone], 1), rs)

    # Logo: bass F1, bell arpeggio F A C E G.
    place(tonal, bass(29, 2.0, 0.55), impact)
    for i, m in enumerate([77, 81, 84, 88, 91]):
        place(tonal, bell(m, level=0.11 - i * 0.012), impact + 0.05 + i * BEAT / 2)

    # Gap: duck everything except the riser just before the reveal.
    duck = np.ones(n)
    gi, ii = int(gap * SR), int(impact * SR)
    duck[gi:ii] = 0.0
    drums *= duck[:, None]
    tonal_wet = reverb(tonal, 2.4, 6000, 0.35)
    mix = pads + drums * 0.9 + tonal_wet
    mix = reverb(mix, 1.4, 4000, 0.12)
    # Fade in the first 0.3 s, out the last 0.6 s.
    tt = tvec(DUR)[:n]
    fade = np.minimum(1, tt / 0.3) * np.clip((DUR - tt) / 0.6, 0, 1)
    mix = np.tanh(1.2 * norm(mix, 1.0)) * fade[:, None]
    return norm(mix, 0.8)


# ------------------------------------------------------------------ sfx
def sfx_pop():
    t = tvec(0.14)
    f = 620 + 560 * np.exp(-t / 0.018)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.035)
    return norm(s, 0.7)


def sfx_whoosh():
    length = 0.75
    t = tvec(length)
    peak = 0.4
    e = np.where(t < peak, (t / peak) ** 2.5, np.exp(-(t - peak) / 0.12))
    n1 = sweep_noise(length, 250, 3500, curve=1.0)
    s = n1 * e
    pan = np.clip(t / length, 0, 1)
    st = np.stack([s * np.cos(pan * np.pi / 2) * 1.2, s * np.sin(pan * np.pi / 2) * 1.2], 1)
    return norm(reverb(st, 0.8, 5000, 0.2), 0.75)


def sfx_pin_drop():
    t = tvec(0.5)
    f = 48 + 90 * np.exp(-t / 0.03)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.12)
    tick = bp(rng.standard_normal(len(t)), 1500, 5000) * np.exp(-t / 0.006) * 0.3
    return norm(np.tanh(1.5 * (body + tick)), 0.8)


def sfx_status(midi):
    s = mallet(midi, level=1.0)
    return norm(reverb(s, 1.2, 7000, 0.25), 0.65)


def sfx_dot():
    s = bell(93, 1.6, 1.0) * 0.6 + bell(100, 1.6, 1.0) * 0.25
    return norm(reverb(s, 1.8, 9000, 0.4), 0.5)


def sfx_impact():
    t = tvec(2.6)
    f = 30 + 55 * np.exp(-t / 0.08)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.7)
    air = lp(rng.standard_normal(len(t)), 2500) * np.exp(-t / 0.35) * 0.5
    crack = hp(rng.standard_normal(len(t)), 2000) * np.exp(-t / 0.02) * 0.35
    s = np.tanh(1.3 * (boom + air + crack))
    return norm(reverb(s, 2.6, 3500, 0.4), 0.9)


if __name__ == "__main__":
    save("public/audio/intro-bed.wav", music_bed())
    save("public/sfx/pop.wav", sfx_pop())
    save("public/sfx/whoosh-soft.wav", sfx_whoosh())
    save("public/sfx/pin-drop.wav", sfx_pin_drop())
    for i, m in enumerate([74, 77, 81, 86], start=1):
        save(f"public/sfx/status-{i}.wav", sfx_status(m))
    save("public/sfx/dot-chime.wav", sfx_dot())
    save("public/sfx/logo-impact.wav", sfx_impact())
