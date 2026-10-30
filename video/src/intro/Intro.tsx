import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { AbsoluteFill } from "remotion";
import { TL } from "../theme";
import { blurZoom } from "../components/blurZoom";
import { CityScene } from "./CityScene";
import { IssuesScene } from "./IssuesScene";
import { TrackScene } from "./TrackScene";
import { LogoScene } from "./LogoScene";
import { IntroAudio } from "./IntroAudio";

const S = TL.scenes;
const transition = linearTiming({ durationInFrames: TL.transitionFrames });

/** 10 s intro: problem -> report -> track -> logo. Timing lives in src/timeline.json. */
export const Intro: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: "#0a1310" }}>
    <TransitionSeries>
      <TransitionSeries.Sequence name="1 · City problems" durationInFrames={S.city.durationInFrames}>
        <CityScene />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={blurZoom()} timing={transition} />
      <TransitionSeries.Sequence name="2 · Report in a few taps" durationInFrames={S.issues.durationInFrames}>
        <IssuesScene />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={blurZoom()} timing={transition} />
      <TransitionSeries.Sequence name="3 · Follow every step" durationInFrames={S.track.durationInFrames}>
        <TrackScene />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={blurZoom()} timing={transition} />
      <TransitionSeries.Sequence name="4 · iREPORT logo" durationInFrames={S.logo.durationInFrames}>
        <LogoScene />
      </TransitionSeries.Sequence>
    </TransitionSeries>
    <IntroAudio />
  </AbsoluteFill>
);
