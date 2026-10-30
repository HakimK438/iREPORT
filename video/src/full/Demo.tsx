import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT } from "../theme";
import { BrowserWindow, CHROME_H } from "../components/BrowserWindow";
import { MacCursor } from "../components/MacCursor";
import { GridBackdrop } from "../components/ui";
import { CHAPTERS, SHOTS, STARTS, type Shot } from "./shots";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.45, 0, 0.2, 1);
const VW = 1600; // captured viewport, CSS px
const VH = 900;
const K = 0.95; // viewport -> video px
const WIN_LEFT = (1920 - VW * K) / 2;
const WIN_TOP = 40;
const FADE = 8; // crossfade between shots
const CURSOR = 54;

type Cam = { s: number; x: number; y: number };

const camAt = (shot: Shot, f: number): Cam => {
  const keys = shot.cam ?? [[0, 1, VW / 2, VH / 2]];
  if (keys.length === 1) return clampCam({ s: keys[0][1], x: keys[0][2], y: keys[0][3] });
  const fs = keys.map((k) => k[0]);
  const o = { ...clamp, easing: ease };
  return clampCam({
    s: interpolate(f, fs, keys.map((k) => k[1]), o),
    x: interpolate(f, fs, keys.map((k) => k[2]), o),
    y: interpolate(f, fs, keys.map((k) => k[3]), o),
  });
};
// Keep the zoomed view inside the screenshot.
const clampCam = (c: Cam): Cam => ({
  s: c.s,
  x: Math.min(Math.max(c.x, VW / 2 / c.s), VW - VW / 2 / c.s),
  y: Math.min(Math.max(c.y, VH / 2 / c.s), VH - VH / 2 / c.s),
});
const project = (c: Cam, x: number, y: number) => ({ x: (x - c.x) * c.s + VW / 2, y: (y - c.y) * c.s + VH / 2 });

/** One cursor path through the whole demo; each shot continues from where the last one left off. */
const CURSOR_KEYS = (() => {
  const keys: [number, number, number][] = [];
  SHOTS.forEach((s, i) => {
    (s.moves ?? []).forEach(([f, x, y], j) => {
      if (j === 0 && keys.length) return; // continuity: ignore the authored start of later shots
      const g = STARTS[i] + f;
      if (!keys.length || g > keys[keys.length - 1][0]) keys.push([g, x, y]);
    });
  });
  return keys;
})();
const CLICKS = SHOTS.flatMap((s, i) => (s.clicks ?? []).map((c) => STARTS[i] + c));

const activeIndex = (frame: number) => {
  let i = 0;
  while (i + 1 < SHOTS.length && frame >= STARTS[i + 1]) i++;
  return i;
};

const ShotLayer: React.FC<{ i: number }> = ({ i }) => {
  const frame = useCurrentFrame();
  const shot = SHOTS[i];
  const f = frame - STARTS[i];
  if (f < 0 || f > shot.dur + FADE) return null;
  const cam = camAt(shot, f);
  return (
    <div style={{ position: "absolute", inset: 0, opacity: i === 0 ? 1 : interpolate(f, [0, FADE], [0, 1], clamp) }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: VW, height: VH, transformOrigin: "0 0", transform: `translate(${VW / 2 - cam.x * cam.s}px, ${VH / 2 - cam.y * cam.s}px) scale(${cam.s})` }}>
        <Img src={staticFile(`screens/${shot.file}.jpg`)} style={{ width: VW, height: VH, display: "block" }} />
      </div>
      {(shot.marks ?? []).map(([a, b, r], k) => {
        const p0 = project(cam, r.x, r.y);
        const p1 = project(cam, r.x + r.w, r.y + r.h);
        const op = interpolate(f, [a, a + 5, b - 5, b], [0, 1, 1, 0], clamp);
        const pulse = 1 + 0.5 * Math.max(0, Math.sin(((f - a) / 30) * Math.PI * 2));
        return (
          <div
            key={k}
            style={{
              position: "absolute",
              left: p0.x - 6,
              top: p0.y - 6,
              width: p1.x - p0.x + 12,
              height: p1.y - p0.y + 12,
              borderRadius: 14,
              outline: `3px solid ${C.lime}`,
              boxShadow: `0 0 ${18 * pulse}px rgba(201,239,83,0.55), inset 0 0 0 9999px rgba(201,239,83,0.06)`,
              opacity: op,
            }}
          />
        );
      })}
    </div>
  );
};

const CursorLayer: React.FC = () => {
  const frame = useCurrentFrame();
  const i = activeIndex(frame);
  const fs = CURSOR_KEYS.map((k) => k[0]);
  const o = { ...clamp, easing: ease };
  const x = interpolate(frame, fs, CURSOR_KEYS.map((k) => k[1]), o);
  const y = interpolate(frame, fs, CURSOR_KEYS.map((k) => k[2]), o);
  // During a crossfade, blend the previous shot's camera into the new one so the pointer glides instead of jumping.
  const cur = camAt(SHOTS[i], frame - STARTS[i]);
  const prev = i > 0 ? camAt(SHOTS[i - 1], frame - STARTS[i - 1]) : cur;
  const t = i > 0 ? interpolate(frame - STARTS[i], [0, FADE], [0, 1], clamp) : 1;
  const a = project(prev, x, y);
  const b = project(cur, x, y);
  const px = a.x + (b.x - a.x) * t;
  const py = a.y + (b.y - a.y) * t;
  const press = CLICKS.reduce((m, c) => Math.max(m, interpolate(frame, [c - 3, c, c + 5], [0, 1, 0], clamp)), 0);
  const ring = CLICKS.map((c) => frame - c).find((d) => d >= 0 && d < 18);
  return (
    <div style={{ position: "absolute", left: px, top: py }}>
      {ring !== undefined && (
        <div
          style={{
            position: "absolute",
            left: -34,
            top: -34,
            width: 68,
            height: 68,
            borderRadius: "50%",
            background: "rgba(18,107,80,0.18)",
            border: `3px solid ${C.green}`,
            scale: String(interpolate(ring, [0, 18], [0.2, 1.5])),
            opacity: interpolate(ring, [0, 18], [0.9, 0]),
          }}
        />
      )}
      <MacCursor size={CURSOR / K} press={press} />
    </div>
  );
};

const CaptionBar: React.FC = () => {
  const frame = useCurrentFrame();
  const i = activeIndex(frame);
  const shot = SHOTS[i];
  const firstOfCaption = (() => {
    let j = i;
    while (j > 0 && SHOTS[j - 1].caption === shot.caption) j--;
    return STARTS[j];
  })();
  const firstOfChapter = (() => {
    let j = i;
    while (j > 0 && SHOTS[j - 1].chapter === shot.chapter) j--;
    return STARTS[j];
  })();
  const ch = CHAPTERS[shot.chapter];
  const since = frame - firstOfCaption;
  const chSince = frame - firstOfChapter;
  return (
    <div style={{ position: "absolute", left: WIN_LEFT, right: WIN_LEFT, top: WIN_TOP + VH * K + CHROME_H + 26, display: "flex", alignItems: "center", gap: 22 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 18px",
          borderRadius: 12,
          background: C.lime,
          color: C.night,
          fontFamily: FONT.mono,
          fontSize: 24,
          whiteSpace: "nowrap",
          scale: String(interpolate(chSince, [0, 8], [0.85, 1], { ...clamp, easing: Easing.bezier(0.16, 1, 0.3, 1) })),
        }}
      >
        <b>{ch.n}</b> {ch.title.toUpperCase()}
      </div>
      <div
        style={{
          fontFamily: FONT.display,
          fontWeight: 800,
          fontSize: 34,
          letterSpacing: -0.5,
          color: C.text,
          whiteSpace: "nowrap",
          opacity: interpolate(since, [0, 7], [0, 1], clamp),
          translate: `0px ${interpolate(since, [0, 10], [14, 0], { ...clamp, easing: Easing.bezier(0.16, 1, 0.3, 1) })}px`,
        }}
      >
        {shot.caption}
      </div>
    </div>
  );
};

/** The whole product walkthrough on the real screens. */
export const Demo: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const enter = interpolate(frame, [0, 22], [0, 1], { ...clamp, easing: Easing.bezier(0.16, 1, 0.3, 1) });
  return (
    <AbsoluteFill style={{ opacity: interpolate(frame, [0, 10, durationInFrames - 12, durationInFrames], [0, 1, 1, 0], clamp) }}>
      <GridBackdrop />
      <BrowserWindow
        width={VW * K}
        height={VH * K}
        url="localhost:8443  ·  iREPORT (local demo)"
        title="iREPORT · Metropolitan Mumbai"
        style={{ left: WIN_LEFT, top: WIN_TOP, translate: `0px ${(1 - enter) * 80}px`, scale: String(0.94 + 0.06 * enter), filter: `blur(${(1 - enter) * 10}px)` }}
      >
        <div style={{ position: "absolute", left: 0, top: 0, width: VW, height: VH, scale: String(K), transformOrigin: "0 0" }}>
          {SHOTS.map((s, i) => (
            <ShotLayer key={s.file} i={i} />
          ))}
          <CursorLayer />
        </div>
      </BrowserWindow>
      <CaptionBar />
    </AbsoluteFill>
  );
};
