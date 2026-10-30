import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT, TL, local } from "../theme";
import { CaptionChip, RevealLine } from "../components/ui";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Problem markers dropped over the skyline, one per beat. Positions are % of the frame. */
const PINS = [
  { x: 30, y: 47, label: "Pothole" },
  { x: 61, y: 58, label: "Garbage" },
  { x: 78, y: 36, label: "Streetlight out" },
  { x: 47, y: 30, label: "Water leak" },
];

const ProblemPin: React.FC<{ x: number; y: number; label: string; at: number }> = ({ x, y, label, at }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: frame - at, fps, config: { damping: 12, stiffness: 200 } });
  const pulse = (frame - at) % 30;
  return (
    <div style={{ position: "absolute", left: `${x}%`, top: `${y}%`, opacity: frame >= at ? 1 : 0 }}>
      <div
        style={{
          position: "absolute",
          left: -40,
          top: -40,
          width: 80,
          height: 80,
          borderRadius: "50%",
          border: `2px solid ${C.red}`,
          scale: String(interpolate(pulse, [0, 30], [0.3, 1.4])),
          opacity: interpolate(pulse, [0, 30], [0.8, 0]),
        }}
      />
      <div style={{ position: "absolute", left: -11, top: -11, width: 22, height: 22, borderRadius: "50%", background: C.red, boxShadow: `0 0 0 5px rgba(201,71,62,0.3)`, scale: String(pop) }} />
      <div
        style={{
          position: "absolute",
          left: 22,
          top: -20,
          padding: "6px 14px",
          borderRadius: 999,
          background: "rgba(10,19,16,0.82)",
          border: "1px solid rgba(201,71,62,0.5)",
          color: C.text,
          fontFamily: FONT.mono,
          fontSize: 22,
          whiteSpace: "nowrap",
          opacity: interpolate(frame, [at + 3, at + 9], [0, 1], clamp),
          translate: `${interpolate(frame, [at + 3, at + 12], [-10, 0], clamp)}px 0px`,
        }}
      >
        {label}
      </div>
    </div>
  );
};

export const CityScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <AbsoluteFill style={{ backgroundColor: C.night, overflow: "hidden" }}>
      <AbsoluteFill style={{ opacity: interpolate(frame, [0, 18], [0, 1], clamp) }}>
        <Img
          src={staticFile("images/mumbai-andheri-west.jpg")}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "50% 40%",
            filter: "saturate(0.7) brightness(0.62) contrast(1.05)",
            scale: String(interpolate(frame, [0, durationInFrames], [1.0, 1.12], { easing: Easing.out(Easing.quad) })),
          }}
        />
      </AbsoluteFill>
      {/* Dark green grade + readable floor for the headline. */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, rgba(10,19,16,0.35) 0%, rgba(10,19,16,0.15) 35%, rgba(10,19,16,0.92) 82%, ${C.night} 100%)`,
        }}
      />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 40%, transparent 40%, rgba(5,10,8,0.7) 100%)" }} />

      {PINS.map((p, i) => (
        <ProblemPin key={p.label} {...p} at={local("city", TL.events.cityPins[i])} />
      ))}

      <div style={{ position: "absolute", left: 120, bottom: 190, width: 1500 }}>
        <RevealLine
          text="Everyday civic problems"
          start={10}
          style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 112, lineHeight: 1.04, letterSpacing: -3, color: C.text }}
        />
        <RevealLine
          text="affect our neighbourhoods."
          start={22}
          accent={["neighbourhoods."]}
          style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 112, lineHeight: 1.04, letterSpacing: -3, color: C.text }}
        />
      </div>
      <CaptionChip text="Mumbai · 24 BMC ward offices" start={6} />
    </AbsoluteFill>
  );
};
