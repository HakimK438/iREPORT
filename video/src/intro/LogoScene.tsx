import { useEffect, useState } from "react";
import { measureText } from "@remotion/layout-utils";
import { AbsoluteFill, Easing, continueRender, delayRender, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT, TL, local, manrope } from "../theme";
import { RevealLine } from "../components/ui";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const outExpo = Easing.bezier(0.16, 1, 0.3, 1);

/* Proportions of the app's .brand-word: "i" 26px, "REPORT" 20px, dot 7px raised 14px with a 3px gap, letter-spacing -1px. */
const F = 210;
const I_SIZE = F * 1.3;
const DOT = F * 0.35;
const DOT_GAP = F * 0.15;
const LS = -F * 0.05;
const ROW_Y = 470; // vertical centre of the wordmark row

const useWordmarkWidth = () => {
  const [handle] = useState(() => delayRender("Measuring wordmark"));
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    manrope.waitUntilDone().then(() => {
      const font = { fontFamily: FONT.display, fontWeight: "800", letterSpacing: `${LS}px` } as const;
      const i = measureText({ text: "i", fontSize: I_SIZE, ...font }).width;
      const report = measureText({ text: "REPORT", fontSize: F, ...font }).width;
      setWidth(i + report + DOT_GAP + DOT);
      continueRender(handle);
    });
  }, [handle]);
  return width;
};

const Letter: React.FC<{ ch: string; at: number; size: number; color: string }> = ({ ch, at, size, color }) => {
  const frame = useCurrentFrame();
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: size,
        color,
        letterSpacing: LS,
        opacity: interpolate(frame, [at, at + 6], [0, 1], clamp),
        translate: `0px ${interpolate(frame, [at, at + 16], [90, 0], { ...clamp, easing: outExpo })}px`,
        filter: `blur(${interpolate(frame, [at, at + 10], [14, 0], clamp)}px)`,
      }}
    >
      {ch}
    </span>
  );
};

type LogoProps = { dotAt?: number; impact?: number; tagline?: number; taglineText?: string; taglineAccent?: string[] };

export const LogoScene: React.FC<LogoProps> = ({
  dotAt = local("logo", TL.events.dot),
  impact = local("logo", TL.events.impact),
  tagline = local("logo", TL.events.tagline),
  taglineText = "A simpler way to report civic issues.",
  taglineAccent = ["simpler"],
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const width = useWordmarkWidth();

  // Dot: centre of screen before the impact, then flies to the end of the wordmark.
  const dotX = (width ?? 0) / 2 - DOT / 2;
  const dotY = -F * 0.36;
  const fly = spring({ frame: frame - impact, fps, config: { damping: 15, stiffness: 120 } });
  const appear = spring({ frame: frame - dotAt, fps, config: { damping: 10, stiffness: 160 } });
  const breathe = 1 + 0.08 * Math.sin(((frame - dotAt) / fps) * Math.PI * 4) * (frame < impact ? 1 : 0);
  const reveal = interpolate(frame, [impact, impact + 18], [0, 1300], { ...clamp, easing: Easing.bezier(0.3, 0.9, 0.3, 1) });
  const shock = frame - impact;

  return (
    <AbsoluteFill style={{ backgroundColor: C.night, overflow: "hidden" }}>
      {/* Light brand canvas, revealed as a circle from the dot. */}
      <AbsoluteFill
        style={{
          backgroundColor: C.warm,
          backgroundImage:
            "linear-gradient(rgba(24,32,29,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(24,32,29,0.04) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          backgroundPosition: "center",
          clipPath: `circle(${reveal}px at 960px 540px)`,
        }}
      />
      {shock >= 0 && (
        <div
          style={{
            position: "absolute",
            left: 960 - 200,
            top: 540 - 200,
            width: 400,
            height: 400,
            borderRadius: "50%",
            border: `6px solid ${C.green}`,
            scale: String(interpolate(shock, [0, 26], [0.2, 4.2], { ...clamp, easing: outExpo })),
            opacity: interpolate(shock, [0, 26], [0.6, 0], clamp),
          }}
        />
      )}

      <AbsoluteFill style={{ scale: String(interpolate(frame, [impact, durationInFrames], [1.06, 1], { ...clamp, easing: outExpo })) }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: ROW_Y,
            height: 0,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            fontFamily: FONT.display,
            fontWeight: 800,
            lineHeight: 1,
          }}
        >
          <Letter ch="i" at={impact + 1} size={I_SIZE} color={C.green} />
          {"REPORT".split("").map((ch, i) => (
            <Letter key={i} ch={ch} at={impact + 3 + i * 2} size={F} color={C.ink} />
          ))}
          <span style={{ display: "inline-block", width: DOT_GAP + DOT }} />
        </div>

        <div style={{ position: "absolute", top: ROW_Y + 150, width: "100%", textAlign: "center" }}>
          <span
            style={{
              fontFamily: FONT.body,
              fontWeight: 700,
              fontSize: 30,
              color: C.muted,
              letterSpacing: interpolate(frame, [impact + 12, impact + 36], [26, 11], { ...clamp, easing: outExpo }),
              opacity: interpolate(frame, [impact + 12, impact + 22], [0, 1], clamp),
            }}
          >
            METROPOLITAN MUMBAI
          </span>
        </div>
        <div style={{ position: "absolute", top: ROW_Y + 240, width: "100%", display: "flex", justifyContent: "center" }}>
          <RevealLine
            text={taglineText}
            start={tagline}
            stagger={2}
            accent={taglineAccent}
            accentColor={C.green}
            style={{ fontFamily: FONT.body, fontWeight: 500, fontSize: 46, color: C.ink, justifyContent: "center" }}
          />
        </div>
      </AbsoluteFill>

      {/* The lime dot travels on its own layer so it can start at the centre of the screen. */}
      <div
        style={{
          position: "absolute",
          left: 960 - DOT / 2,
          top: 540 - DOT / 2,
          width: DOT,
          height: DOT,
          borderRadius: "50%",
          background: C.lime,
          boxShadow: frame < impact ? `0 0 ${50 * appear}px rgba(201,239,83,0.7)` : "none",
          scale: String(appear * breathe * interpolate(fly, [0, 1], [1.35, 1])),
          translate: `${interpolate(fly, [0, 1], [0, dotX])}px ${interpolate(fly, [0, 1], [0, ROW_Y - 540 + dotY])}px`,
        }}
      />
    </AbsoluteFill>
  );
};
