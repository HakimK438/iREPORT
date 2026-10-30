import { Composition, Folder } from "remotion";
import { Intro } from "./intro/Intro";
import { LinkedInVideo } from "./full/LinkedInVideo";
import { CityScene } from "./intro/CityScene";
import { IssuesScene } from "./intro/IssuesScene";
import { TrackScene } from "./intro/TrackScene";
import { LogoScene } from "./intro/LogoScene";

export const RemotionRoot = () => (
  <>
    <Composition id="LinkedIn" component={LinkedInVideo} width={1920} height={1080} fps={30} durationInFrames={1380} />
    <Composition id="Intro" component={Intro} width={1920} height={1080} fps={30} durationInFrames={300} />
    <Folder name="Intro-scenes">
      <Composition id="City" component={CityScene} width={1920} height={1080} fps={30} durationInFrames={90} />
      <Composition id="Issues" component={IssuesScene} width={1920} height={1080} fps={30} durationInFrames={90} />
      <Composition id="Track" component={TrackScene} width={1920} height={1080} fps={30} durationInFrames={72} />
      <Composition id="Logo" component={LogoScene} width={1920} height={1080} fps={30} durationInFrames={84} />
    </Folder>
  </>
);
