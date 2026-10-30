import { AbsoluteFill, Sequence } from "remotion";
import { C } from "../theme";
import { CityScene } from "../intro/CityScene";
import { LogoScene } from "../intro/LogoScene";
import { Demo } from "./Demo";
import { Credits } from "./Credits";
import { FullAudio } from "./FullAudio";
import FT from "./timeline.json";
import { DEMO_FRAMES } from "./shots";

const S = FT.sections;

/** 46 s LinkedIn showcase: problem -> real product walkthrough -> logo -> team. */
export const LinkedInVideo: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: C.night }}>
    <Sequence name="1 · City problems" durationInFrames={S.city.durationInFrames + 12}>
      <CityScene />
    </Sequence>
    <Sequence name="5 · Logo" from={S.logo.from} durationInFrames={S.logo.durationInFrames}>
      <LogoScene
        dotAt={8}
        impact={FT.music.impact - S.logo.from}
        tagline={44}
        taglineText="Better visibility. Easier reporting. More accountable civic processes."
        taglineAccent={["visibility.", "reporting.", "accountable"]}
      />
    </Sequence>
    <Sequence name="2-4 · Product walkthrough" from={S.home.from} durationInFrames={DEMO_FRAMES}>
      <Demo />
    </Sequence>
    <Sequence name="6 · Team" from={FT.sections.credits.from} durationInFrames={FT.sections.credits.durationInFrames}>
      <Credits />
    </Sequence>
    <FullAudio />
  </AbsoluteFill>
);
