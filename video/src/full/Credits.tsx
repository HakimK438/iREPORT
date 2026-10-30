import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { C, FONT } from "../theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const outExpo = Easing.bezier(0.16, 1, 0.3, 1);

/** Team names from the project report (SB Project Doc). */
export const TEAM = ["Shaikh Abdul Hakim", "Amaan Siddique", "Sairaj Khandagale"];
export const NAME_AT = [22, 30, 38];

const Rise: React.FC<{ at: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ at, children, style }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        opacity: interpolate(frame, [at, at + 8], [0, 1], clamp),
        translate: `0px ${interpolate(frame, [at, at + 16], [28, 0], { ...clamp, easing: outExpo })}px`,
        filter: `blur(${interpolate(frame, [at, at + 10], [8, 0], clamp)}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const Credits: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        backgroundColor: C.warm,
        backgroundImage: "linear-gradient(rgba(24,32,29,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(24,32,29,0.04) 1px, transparent 1px)",
        backgroundSize: "64px 64px",
        backgroundPosition: "center",
        alignItems: "center",
        justifyContent: "center",
        opacity: interpolate(frame, [0, 12], [0, 1], clamp),
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 26 }}>
        <Rise at={4}>
          <div style={{ display: "flex", alignItems: "center", fontFamily: FONT.display, fontWeight: 800, letterSpacing: -3, color: C.ink, lineHeight: 1 }}>
            <span style={{ fontSize: 94, color: C.green }}>i</span>
            <span style={{ fontSize: 72 }}>REPORT</span>
            <span style={{ width: 25, height: 25, borderRadius: "50%", background: C.lime, margin: "-50px 0 0 10px" }} />
          </div>
        </Rise>
        <Rise at={12}>
          <div style={{ fontFamily: FONT.mono, fontSize: 24, letterSpacing: 4, color: C.muted }}>BUILT BY</div>
        </Rise>
        <div style={{ display: "flex", gap: 22 }}>
          {TEAM.map((n, i) => (
            <Rise key={n} at={NAME_AT[i]}>
              <div style={{ padding: "18px 30px", borderRadius: 18, background: "#fff", border: "1px solid #e1e5e1", boxShadow: "0 18px 50px rgba(27,43,36,0.1)", fontFamily: FONT.display, fontWeight: 800, fontSize: 44, letterSpacing: -1, color: C.ink }}>
                {n}
              </div>
            </Rise>
          ))}
        </div>
        <Rise at={50}>
          <div style={{ fontFamily: FONT.body, fontSize: 32, color: C.ink, textAlign: "center", lineHeight: 1.45 }}>
            Project guide <b>Dr. Vidya Chitre</b>
            <br />
            <span style={{ color: C.muted }}>Department of Information Technology · Vidyalankar Institute of Technology, Mumbai</span>
          </div>
        </Rise>
        <Rise at={66} style={{ marginTop: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 28px", borderRadius: 999, background: C.ink, color: "#fff", fontFamily: FONT.body, fontWeight: 700, fontSize: 30 }}>
            Explore iREPORT <span style={{ color: C.lime }}>→</span>
          </div>
        </Rise>
      </div>
      <AbsoluteFill style={{ backgroundColor: C.warm, opacity: interpolate(frame, [168, 180], [0, 1], clamp), pointerEvents: "none" }} />
    </AbsoluteFill>
  );
};
