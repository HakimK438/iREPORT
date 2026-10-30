import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT, TL, local } from "../theme";
import { Icon } from "../components/Icon";
import { CaptionChip, GridBackdrop, RevealLine } from "../components/ui";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** The citizen-visible path of a complaint (iREPORT_Copy/src/store.ts STATUSES; "Reported" is shown as received). */
const STEPS = [
  { label: "Reported", note: "photo + pin received" },
  { label: "Acknowledged", note: "ward office has it" },
  { label: "In progress", note: "work under way" },
  { label: "Resolved", note: "you confirm the fix, or reopen" },
];

const MAP = { left: 150, top: 330, w: 820, h: 560 };

const MapCard: React.FC<{ dropAt: number }> = ({ dropAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const drop = spring({ frame: frame - dropAt, fps, config: { damping: 9, stiffness: 170, mass: 0.8 } });
  const ring = frame - dropAt - 6;
  const px = MAP.w * 0.52;
  const py = MAP.h * 0.5;
  return (
    <div
      style={{
        position: "absolute",
        left: MAP.left,
        top: MAP.top,
        width: MAP.w,
        height: MAP.h,
        borderRadius: 32,
        overflow: "hidden",
        background: "#0f1a16",
        border: `1px solid ${C.line}`,
        boxShadow: "0 30px 80px rgba(0,0,0,0.45)",
        opacity: interpolate(frame, [0, 8], [0, 1], clamp),
        translate: `0px ${interpolate(frame, [0, 12], [40, 0], clamp)}px`,
      }}
    >
      {/* A schematic street map: sea, park and a few roads. Not a real map tile. */}
      <svg width={MAP.w} height={MAP.h} style={{ position: "absolute", inset: 0 }}>
        <path d={`M0 ${MAP.h * 0.72} C 140 ${MAP.h * 0.66}, 180 ${MAP.h}, 300 ${MAP.h} L 0 ${MAP.h} Z`} fill="rgba(88,173,233,0.14)" />
        <ellipse cx={MAP.w * 0.8} cy={MAP.h * 0.24} rx={110} ry={70} fill="rgba(63,191,138,0.12)" />
        <g stroke="rgba(255,255,255,0.12)" strokeWidth={14} fill="none" strokeLinecap="round">
          <path d={`M-20 ${MAP.h * 0.38} C 260 ${MAP.h * 0.3}, 520 ${MAP.h * 0.62}, ${MAP.w + 20} ${MAP.h * 0.5}`} />
          <path d={`M${MAP.w * 0.36} -20 L ${MAP.w * 0.6} ${MAP.h + 20}`} />
        </g>
        <g stroke="rgba(255,255,255,0.06)" strokeWidth={6} fill="none">
          <path d={`M-20 ${MAP.h * 0.82} L ${MAP.w + 20} ${MAP.h * 0.74}`} />
          <path d={`M${MAP.w * 0.12} -20 L ${MAP.w * 0.2} ${MAP.h + 20}`} />
          <path d={`M${MAP.w * 0.82} -20 L ${MAP.w * 0.74} ${MAP.h + 20}`} />
          <path d={`M-20 ${MAP.h * 0.14} L ${MAP.w + 20} ${MAP.h * 0.2}`} />
        </g>
      </svg>
      {ring > 0 && [0, 10].map((d) => (
        <div
          key={d}
          style={{
            position: "absolute",
            left: px - 80,
            top: py - 30,
            width: 160,
            height: 60,
            borderRadius: "50%",
            border: `3px solid ${C.lime}`,
            scale: String(interpolate(ring - d, [0, 24], [0.2, 1.8], clamp)),
            opacity: interpolate(ring - d, [0, 24], [0.9, 0], clamp),
          }}
        />
      ))}
      <div style={{ position: "absolute", left: px - 34, top: py - 10, width: 68, height: 20, borderRadius: "50%", background: "rgba(0,0,0,0.5)", scale: String(drop), opacity: frame >= dropAt ? 1 : 0 }} />
      <div
        style={{
          position: "absolute",
          left: px - 44,
          top: py - 92,
          color: C.lime,
          opacity: frame >= dropAt ? 1 : 0,
          translate: `0px ${interpolate(drop, [0, 1], [-340, 0])}px`,
          filter: "drop-shadow(0 8px 14px rgba(0,0,0,0.5))",
        }}
      >
        <Icon name="pin" size={88} />
      </div>
      <div
        style={{
          position: "absolute",
          left: px + 54,
          top: py - 92,
          padding: "10px 18px",
          borderRadius: 14,
          background: "#fff",
          color: C.ink,
          fontFamily: FONT.body,
          fontWeight: 700,
          fontSize: 26,
          whiteSpace: "nowrap",
          opacity: interpolate(frame, [dropAt + 8, dropAt + 14], [0, 1], clamp),
          translate: `${interpolate(frame, [dropAt + 8, dropAt + 18], [-14, 0], clamp)}px 0px`,
        }}
      >
        Pothole <span style={{ color: C.muted, fontWeight: 500 }}>· Andheri West</span>
      </div>
    </div>
  );
};

const StatusList: React.FC<{ ats: number[] }> = ({ ats }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ROW_H = 132;
  const fill = interpolate(frame, ats, ats.map((_, i) => i / (ats.length - 1)), clamp);
  return (
    <div style={{ position: "absolute", left: 1090, top: 360, width: 700, height: ROW_H * 3 + 60 }}>
      <div style={{ position: "absolute", left: 29, top: 30, width: 4, height: ROW_H * 3, background: "rgba(255,255,255,0.1)", borderRadius: 2 }} />
      <div style={{ position: "absolute", left: 29, top: 30, width: 4, height: ROW_H * 3 * fill, background: C.greenBright, borderRadius: 2 }} />
      {STEPS.map((s, i) => {
        const on = spring({ frame: frame - ats[i], fps, config: { damping: 13, stiffness: 200 } });
        const lit = frame >= ats[i];
        return (
          <div key={s.label} style={{ position: "absolute", left: 0, top: i * ROW_H, display: "flex", alignItems: "center", gap: 30 }}>
            <div
              style={{
                width: 62,
                height: 62,
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                background: lit ? C.greenBright : C.card,
                border: `2px solid ${lit ? C.greenBright : "rgba(255,255,255,0.16)"}`,
                color: C.night,
                scale: String(lit ? interpolate(on, [0, 1], [0.6, 1]) : 1),
                boxShadow: lit ? `0 0 ${30 * on}px rgba(47,181,131,0.5)` : "none",
              }}
            >
              {lit && <Icon name="check" size={34} />}
            </div>
            <div style={{ opacity: interpolate(frame, [ats[i] - 10, ats[i]], [0.35, 1], clamp) }}>
              <div style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 46, letterSpacing: -1, color: C.text }}>{s.label}</div>
              <div style={{ fontFamily: FONT.mono, fontSize: 24, color: C.textDim }}>{s.note}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const TrackScene: React.FC = () => (
  <AbsoluteFill style={{ overflow: "hidden" }}>
    <GridBackdrop glow="rgba(201,239,83,0.08)" />
    <div style={{ position: "absolute", top: 150, left: 150 }}>
      <RevealLine
        text="…then follow every step."
        start={4}
        accent={["step."]}
        style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 96, letterSpacing: -2.5, color: C.text }}
      />
    </div>
    <MapCard dropAt={local("track", TL.events.pinDrop)} />
    <StatusList ats={TL.events.statuses.map((f) => local("track", f))} />
    <CaptionChip text="Live status for every complaint" start={14} />
  </AbsoluteFill>
);
