import type React from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT } from "../theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const outExpo = Easing.bezier(0.16, 1, 0.3, 1);

/** Dark canvas with a faint grid and a soft green glow, as in the reference video. */
export const GridBackdrop: React.FC<{ glow?: string }> = ({ glow = "rgba(47,181,131,0.16)" }) => (
  <AbsoluteFill
    style={{
      backgroundColor: C.night,
      backgroundImage: `radial-gradient(ellipse 70% 60% at 50% 45%, ${glow}, transparent 70%),
        linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)`,
      backgroundSize: "100% 100%, 64px 64px, 64px 64px",
      backgroundPosition: "center, center, center",
    }}
  />
);

/** Bottom-left monospace caption chip that types itself in. */
export const CaptionChip: React.FC<{ text: string; start: number; dark?: boolean }> = ({ text, start, dark = true }) => {
  const frame = useCurrentFrame();
  const chars = Math.floor(interpolate(frame, [start, start + text.length * 0.9], [0, text.length], clamp));
  return (
    <div
      style={{
        position: "absolute",
        left: 120,
        bottom: 96,
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 20px",
        borderRadius: 12,
        background: dark ? "rgba(17,28,24,0.82)" : "rgba(255,255,255,0.85)",
        border: `1px solid ${dark ? C.line : "rgba(0,0,0,0.08)"}`,
        fontFamily: FONT.mono,
        fontSize: 26,
        color: dark ? C.textDim : C.muted,
        opacity: interpolate(frame, [start - 4, start], [0, 1], clamp),
        translate: `0px ${interpolate(frame, [start - 4, start + 6], [12, 0], { ...clamp, easing: outExpo })}px`,
      }}
    >
      <span style={{ width: 10, height: 10, borderRadius: 2, background: C.lime }} />
      <span>
        {text.slice(0, chars)}
        <span style={{ opacity: chars < text.length ? 1 : 0, color: C.lime }}>▍</span>
      </span>
    </div>
  );
};

/** Words that rise out of a blur, one after another. */
export const RevealLine: React.FC<{
  text: string;
  start: number;
  stagger?: number;
  style?: React.CSSProperties;
  accent?: string[];
  accentColor?: string;
}> = ({ text, start, stagger = 3, style, accent = [], accentColor = C.lime }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ display: "flex", flexWrap: "wrap", columnGap: "0.26em", ...style }}>
      {text.split(" ").map((w, i) => {
        const s = start + i * stagger;
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              color: accent.includes(w) ? accentColor : undefined,
              opacity: interpolate(frame, [s, s + 8], [0, 1], clamp),
              translate: `0px ${interpolate(frame, [s, s + 14], [36, 0], { ...clamp, easing: outExpo })}px`,
              filter: `blur(${interpolate(frame, [s, s + 10], [12, 0], clamp)}px)`,
            }}
          >
            {w}
          </span>
        );
      })}
    </div>
  );
};

/** White callout pill ("category -> Pothole"), the annotation style of the reference. */
export const CalloutPill: React.FC<{ from: string; to: string; start: number; style?: React.CSSProperties }> = ({ from, to, start, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: frame - start, fps, config: { damping: 14, stiffness: 180 } });
  return (
    <div
      style={{
        position: "absolute",
        padding: "10px 18px",
        borderRadius: 999,
        background: "#fff",
        color: C.ink,
        fontFamily: FONT.mono,
        fontSize: 24,
        whiteSpace: "nowrap",
        boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
        opacity: interpolate(frame, [start, start + 4], [0, 1], clamp),
        scale: String(interpolate(pop, [0, 1], [0.7, 1])),
        ...style,
      }}
    >
      {from} <span style={{ color: C.muted }}>→</span> <b style={{ color: C.green }}>{to}</b>
    </div>
  );
};

type CursorKey = { frame: number; x: number; y: number };

/** Pointer that glides between keyframes and dips on click frames. */
export const Cursor: React.FC<{ keys: CursorKey[]; clicks: number[]; appear: number }> = ({ keys, clicks, appear }) => {
  const frame = useCurrentFrame();
  const frames = keys.map((k) => k.frame);
  const ease = { ...clamp, easing: Easing.bezier(0.45, 0, 0.2, 1) };
  const x = interpolate(frame, frames, keys.map((k) => k.x), ease);
  const y = interpolate(frame, frames, keys.map((k) => k.y), ease);
  const press = clicks.reduce((m, c) => Math.max(m, interpolate(frame, [c - 2, c, c + 6], [0, 1, 0], clamp)), 0);
  const ring = clicks.map((c) => frame - c).find((d) => d >= 0 && d < 16);
  return (
    <div style={{ position: "absolute", left: x, top: y, opacity: interpolate(frame, [appear, appear + 6], [0, 1], clamp) }}>
      {ring !== undefined && (
        <div
          style={{
            position: "absolute",
            left: -30,
            top: -30,
            width: 60,
            height: 60,
            borderRadius: "50%",
            border: `3px solid ${C.lime}`,
            scale: String(interpolate(ring, [0, 16], [0.3, 1.6])),
            opacity: interpolate(ring, [0, 16], [0.9, 0]),
          }}
        />
      )}
      <svg width="46" height="54" viewBox="0 0 23 27" style={{ scale: String(1 - press * 0.16), transformOrigin: "0 0", filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.45))" }}>
        <path d="M1.5 1.5v20.5l5.6-5.2 3.7 8.4 3.7-1.6-3.7-8.3 7.7-.4z" fill="#fff" stroke="#0a1310" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </div>
  );
};
