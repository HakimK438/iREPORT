import { loadFont as loadManrope } from "@remotion/google-fonts/Manrope";
import { loadFont as loadDMSans } from "@remotion/google-fonts/DMSans";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import timeline from "./timeline.json";

/** Brand tokens, taken from iREPORT_Copy/src/index.css (:root and .brand). */
export const C = {
  ink: "#18201d",
  muted: "#68736e",
  green: "#126b50",
  greenBright: "#2fb583", // the brand green lifted for use on dark backgrounds
  green2: "#e3f3ec",
  lime: "#c9ef53",
  warm: "#f6f6f1",
  red: "#c9473e",
  amber: "#b86718",
  night: "#0a1310", // dark canvas: the ink colour pushed darker, green-tinted
  card: "#111c18",
  line: "rgba(255,255,255,0.08)",
  text: "#eef3ef",
  textDim: "rgba(238,243,239,0.62)",
};

export const manrope = loadManrope("normal", { weights: ["700", "800"], subsets: ["latin"] });
export const dmSans = loadDMSans("normal", { weights: ["400", "500", "700"], subsets: ["latin"] });
export const mono = loadMono("normal", { weights: ["500"], subsets: ["latin"] });

export const FONT = {
  display: manrope.fontFamily,
  body: dmSans.fontFamily,
  mono: mono.fontFamily,
};

export const TL = timeline;
export type SceneName = keyof typeof timeline.scenes;

/** A global event frame expressed in a scene's local frames. */
export const local = (scene: SceneName, globalFrame: number) => globalFrame - timeline.scenes[scene].from;
