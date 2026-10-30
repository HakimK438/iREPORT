import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT, TL, local } from "../theme";
import { Icon, type IconName } from "../components/Icon";
import { CalloutPill, CaptionChip, Cursor, GridBackdrop, RevealLine } from "../components/ui";


/** The five citizen-facing categories, labels from iREPORT_Copy/src/brand.tsx CATEGORY_LABEL. */
const TILES: { label: string; icon: IconName; tone: string }[] = [
  { label: "Potholes & Road Damage", icon: "road", tone: "#9fb3c4" },
  { label: "Garbage & Waste", icon: "waste", tone: "#3fbf8a" },
  { label: "Broken Streetlights", icon: "light", tone: "#e7ae4a" },
  { label: "Water & Drainage", icon: "water", tone: "#58ade9" },
  { label: "Electrical Hazards", icon: "bolt", tone: "#e46a5f" },
];

const W = 280;
const H = 320;
const GAP = 30;
const ROW = TILES.length * W + (TILES.length - 1) * GAP;
const LEFT = (1920 - ROW) / 2;
const TOP = 400;

const Tile: React.FC<{ i: number; at: number; selectAt: number }> = ({ i, at, selectAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = TILES[i];
  const enter = spring({ frame: frame - at, fps, config: { damping: 15, stiffness: 170 } });
  const sel = spring({ frame: frame - selectAt, fps, config: { damping: 16, stiffness: 160 } });
  const chosen = i === 0;
  return (
    <div
      style={{
        position: "absolute",
        left: LEFT + i * (W + GAP),
        top: TOP,
        width: W,
        height: H,
        borderRadius: 28,
        background: C.card,
        border: `1px solid ${C.line}`,
        outline: chosen ? `${3 * sel}px solid ${C.lime}` : undefined,
        boxShadow: chosen ? `0 0 ${60 * sel}px rgba(201,239,83,${0.25 * sel})` : "0 20px 50px rgba(0,0,0,0.35)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 30,
        boxSizing: "border-box",
        opacity: interpolate(enter, [0, 1], [0, 1]) * (chosen ? 1 : interpolate(sel, [0, 1], [1, 0.35])),
        translate: `0px ${interpolate(enter, [0, 1], [70, 0])}px`,
        scale: String(interpolate(enter, [0, 1], [0.86, 1]) * (chosen ? interpolate(sel, [0, 1], [1, 1.05]) : 1)),
      }}
    >
      <div
        style={{
          width: 96,
          height: 96,
          borderRadius: 24,
          display: "grid",
          placeItems: "center",
          color: t.tone,
          background: `${t.tone}22`,
        }}
      >
        <Icon name={t.icon} size={54} />
      </div>
      <div style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 34, lineHeight: 1.12, letterSpacing: -0.6, color: C.text }}>{t.label}</div>
    </div>
  );
};

export const IssuesScene: React.FC = () => {
  const click = local("issues", TL.events.click);
  const tileCenter = { x: LEFT + W / 2 + 40, y: TOP + H / 2 + 20 };
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <GridBackdrop />
      <div style={{ position: "absolute", top: 170, width: "100%", display: "flex", justifyContent: "center" }}>
        <RevealLine
          text="Report it in a few taps."
          start={6}
          accent={["taps."]}
          style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 96, letterSpacing: -2.5, color: C.text, justifyContent: "center" }}
        />
      </div>
      {TILES.map((t, i) => (
        <Tile key={t.label} i={i} at={local("issues", TL.events.tiles[i])} selectAt={click} />
      ))}
      <CalloutPill from="category" to="Pothole" start={click + 3} style={{ left: LEFT + 10, top: TOP - 64 }} />
      <Cursor
        appear={36}
        clicks={[click]}
        keys={[
          { frame: 36, x: 1500, y: 980 },
          { frame: click - 2, x: tileCenter.x, y: tileCenter.y },
          { frame: click + 20, x: tileCenter.x + 30, y: tileCenter.y + 24 },
        ]}
      />
      <CaptionChip text="Category · photo · map pin" start={44} />
    </AbsoluteFill>
  );
};
