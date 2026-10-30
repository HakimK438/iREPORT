"""Music bed for the full 46 s video, built from the same instruments as the intro (scripts/make_intro_audio.py).

  0 s - 4 s    Dm9 pad, drone, soft ticking (the problem)
  4 s - 34 s   light 120 BPM groove under the product demo: Dm9 | Bbmaj7 | Fmaj7 | Csus, two bars each
  34 s - 36 s  riser, then half a beat of silence
  36 s         lift to F major on the logo (the impact itself is public/sfx/logo-impact.wav)
  36 s - 46 s  pad and bells under the logo and team credits, fading out

Run from the ireport-video folder:   python scripts/make_full_audio.py
"""
import json

import numpy as np

import make_intro_audio as m

T = json.loads((m.ROOT / "src/full/timeline.json").read_text())
MU = T["music"]
FPS = T["fps"]
DUR = T["durationInFrames"] / FPS
BEAT, BAR, SR = m.BEAT, m.BAR, m.SR


def sec(f):
    return f / FPS


def bed():
    n = int(DUR * SR)
    pads = np.zeros((n, 2))
    drums = np.zeros((n, 2))
    tonal = np.zeros((n, 2))
    drums_in = sec(MU["drumsIn"])
    riser = sec(MU["riserFrom"])
    impact = sec(MU["impact"])
    gap = impact - BEAT / 2

    loop = [
        ([50, 53, 57, 60, 64], 38, [62, 65, 69, 72]),  # Dm9
        ([46, 50, 53, 57, 62], 34, [62, 65, 69, 74]),  # Bbmaj7
        ([41, 53, 57, 60, 64], 41, [60, 65, 69, 72]),  # Fmaj7
        ([48, 55, 60, 62, 67], 36, [60, 62, 67, 72]),  # Csus2
    ]
    # Pads: intro Dm9 until the drums, then the loop in two-bar chords until the impact.
    m.place(pads, m.pad_chord(loop[0][0], drums_in + 0.25, 700) * m.env(drums_in + 0.25, 1.0, 0.3)[:, None] * 0.55, 0)
    t = drums_in
    k = 0
    while t < impact - 1e-6:
        length = min(2 * BAR, impact - t)
        notes, root, arp = loop[k % 4]
        sig = m.pad_chord(notes, length + 0.2, 1500) * m.env(length + 0.2, 0.08, 0.25)[:, None]
        m.place(pads, sig * 0.42, t)
        # Bass on 8ths, quiet.
        for j in range(int(length / (BEAT / 2))):
            at = t + j * BEAT / 2
            if at < gap:
                m.place(tonal, m.bass(root, BEAT / 2 * 0.9, 0.3 if j % 2 == 0 else 0.2), at)
        # Arp on 8ths (16ths only in the last 4 bars), soft, so it never fights the clicks.
        step = BEAT / 4 if t >= riser - 4 * BAR else BEAT / 2
        for j in range(int(length / step)):
            at = t + j * step
            if at < gap:
                m.place(tonal, m.pluck(arp[j % 4] + (12 if (j // 4) % 2 else 0), level=0.09), at)
        t += length
        k += 1

    # Drone and hats in the intro.
    tt = m.tvec(drums_in + 0.5)
    m.place(pads, np.sin(2 * np.pi * m.hz(38) * tt) * np.minimum(1, tt / 1.2) * 0.3 * np.clip((drums_in + 0.5 - tt) / 0.5, 0, 1), 0)
    sixteenth = BEAT / 4
    for j in range(int(gap / sixteenth)):
        at = j * sixteenth
        if at < BEAT:
            continue
        place_hat = j % 2 == 0 or at > riser - 2 * BAR
        if place_hat:
            m.place(drums, m.hat(0.07 if at < drums_in else 0.06), at)
    # Kick on every beat, clap on 2 and 4, from the drums-in point.
    for j in range(int(gap / BEAT)):
        at = j * BEAT
        if at < drums_in:
            continue
        m.place(drums, m.kick(0.55), at)
        if j % 4 in (1, 3):
            m.place(drums, m.clap(0.2), at)

    # Riser into the logo.
    rlen = gap - riser + 0.04
    rt = m.tvec(rlen)
    rnoise = m.sweep_noise(rlen, 400, 9000) * (rt / rlen) ** 2.2 * 0.4
    rtone = np.sin(2 * np.pi * np.cumsum(220 * 2 ** (2 * rt / rlen)) / SR) * (rt / rlen) ** 3 * 0.07
    m.place(pads, np.stack([rnoise + rtone, np.roll(rnoise, 240) + rtone], 1), riser)

    # Outro: Fmaj9 -> Bbmaj9 -> Fmaj9, bells, no drums.
    outro = [(impact, [41, 53, 57, 60, 64, 67]), (impact + 2 * BAR, [46, 53, 57, 62, 65, 69]), (impact + 3 * BAR, [41, 53, 57, 60, 64, 67])]
    for i, (start, notes) in enumerate(outro):
        end = outro[i + 1][0] if i + 1 < len(outro) else DUR
        length = end - start + 0.3
        m.place(pads, m.pad_chord(notes, length, 3800) * m.env(length, 0.05, 0.4)[:, None] * 0.7, start)
    m.place(tonal, m.bass(29, 3.0, 0.5), impact)
    for i, mi in enumerate([77, 81, 84, 88, 91]):
        m.place(tonal, m.bell(mi, level=0.1 - i * 0.012), impact + 0.05 + i * BEAT / 2)
    for i, mi in enumerate([81, 84, 88]):
        m.place(tonal, m.bell(mi, level=0.06), sec(T["sections"]["credits"]["from"]) + i * BEAT)

    duck = np.ones(n)
    duck[int(gap * SR):int(impact * SR)] = 0
    drums *= duck[:, None]
    tonal *= duck[:, None]
    mix = pads + drums * 0.9 + m.reverb(tonal, 2.4, 6000, 0.35)
    mix = m.reverb(mix, 1.4, 4000, 0.12)
    tt = m.tvec(DUR)[:n]
    fade = np.minimum(1, tt / 0.3) * np.clip((DUR - tt) / 2.5, 0, 1)
    return m.norm(np.tanh(1.2 * m.norm(mix, 1.0)) * fade[:, None], 0.8)


def success_chime():
    s = sum(m.bell(mi, 1.6, 1.0) * lv for mi, lv in ((81, 0.6), (88, 0.45), (93, 0.3)))
    return m.norm(m.reverb(s, 1.6, 9000, 0.35), 0.6)


if __name__ == "__main__":
    m.save("public/audio/full-bed.wav", bed())
    m.save("public/sfx/success.wav", success_chime())
