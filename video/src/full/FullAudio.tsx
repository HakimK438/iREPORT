import { Audio } from "@remotion/media";
import { staticFile } from "remotion";
import { TL } from "../theme";
import FT from "./timeline.json";
import { SHOTS, STARTS } from "./shots";
import { NAME_AT } from "./Credits";

/*
 * Every sound in the LinkedIn video. Music and effects come from scripts/make_full_audio.py and
 * scripts/make_intro_audio.py; mouse-click.wav is from remotion.media. Cue frames are derived from
 * the shot list, so moving a click in shots.ts moves its sound too.
 */
const S = FT.sections;
const DEMO = S.home.from;
const LOGO = S.logo.from;
const CREDITS = S.credits.from;
const WHOOSH_PEAK = 12;

const clicks = SHOTS.flatMap((s, i) => (s.clicks ?? []).map((c) => DEMO + STARTS[i] + c));
const chapterStarts = SHOTS.map((s, i) => (i > 0 && s.chapter !== SHOTS[i - 1].chapter ? DEMO + STARTS[i] : null)).filter((f): f is number => f !== null);
const chimes = SHOTS.flatMap((s, i) => (s.chime !== undefined ? [DEMO + STARTS[i] + s.chime] : []));
// Soft rising notes after the officer's three status buttons and when the site photo is accepted.
const statusNotes = ["o03-brief", "o04-acknowledged", "o05-in-progress"].map((id) => {
  const i = SHOTS.findIndex((s) => s.file === id);
  return DEMO + STARTS[i] + (SHOTS[i].clicks?.[0] ?? 0) + 4;
});
const proofOk = DEMO + STARTS[SHOTS.findIndex((s) => s.file === "o07-proof-ready")] + 2;

export const FullAudio: React.FC = () => (
  <>
    <Audio name="Music bed" src={staticFile("audio/full-bed.wav")} volume={0.5} />

    {TL.events.cityPins.map((f, i) => (
      <Audio key={`pin${i}`} name={`City pin ${i + 1}`} from={f} src={staticFile("sfx/pop.wav")} volume={0.3} />
    ))}
    <Audio name="Window in" from={DEMO + 6 - WHOOSH_PEAK} src={staticFile("sfx/whoosh-soft.wav")} volume={0.5} />
    {chapterStarts.map((f, i) => (
      <Audio key={`ch${i}`} name={`Chapter ${i + 2}`} from={f - WHOOSH_PEAK} src={staticFile("sfx/whoosh-soft.wav")} volume={0.32} />
    ))}
    {clicks.map((f, i) => (
      <Audio key={`cl${i}`} name={`Click ${i + 1}`} from={f - 1} src={staticFile("sfx/mouse-click.wav")} volume={0.9} />
    ))}
    {statusNotes.map((f, i) => (
      <Audio key={`st${i}`} name={`Status ${i + 1}`} from={f} src={staticFile(`sfx/status-${i + 1}.wav`)} volume={0.28} />
    ))}
    <Audio name="Proof accepted" from={proofOk} src={staticFile("sfx/status-4.wav")} volume={0.3} />
    {chimes.map((f, i) => (
      <Audio key={`ok${i}`} name={`Success ${i + 1}`} from={f} src={staticFile("sfx/success.wav")} volume={0.45} />
    ))}
    <Audio name="Dot chime" from={LOGO + 8} src={staticFile("sfx/dot-chime.wav")} volume={0.42} />
    <Audio name="Logo impact" from={FT.music.impact} src={staticFile("sfx/logo-impact.wav")} volume={0.85} />
    {NAME_AT.map((f, i) => (
      <Audio key={`nm${i}`} name={`Name ${i + 1}`} from={CREDITS + f} src={staticFile("sfx/pop.wav")} volume={0.26} />
    ))}
  </>
);
