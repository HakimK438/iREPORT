import type { TransitionPresentation, TransitionPresentationComponentProps } from "@remotion/transitions";
import { AbsoluteFill, Easing, interpolate } from "remotion";

type Props = Record<string, never>;

/** Outgoing scene pushes forward into a blur; incoming scene settles out of one. */
const BlurZoom: React.FC<TransitionPresentationComponentProps<Props>> = ({ children, presentationDirection, presentationProgress }) => {
  const p = Easing.bezier(0.65, 0, 0.35, 1)(presentationProgress);
  const exiting = presentationDirection === "exiting";
  return (
    <AbsoluteFill
      style={{
        opacity: exiting ? interpolate(p, [0, 1], [1, 0]) : interpolate(p, [0, 0.5, 1], [0, 1, 1]),
        scale: String(exiting ? interpolate(p, [0, 1], [1, 1.12]) : interpolate(p, [0, 1], [0.94, 1])),
        filter: `blur(${exiting ? interpolate(p, [0, 1], [0, 18]) : interpolate(p, [0, 1], [18, 0])}px)`,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

export const blurZoom = (): TransitionPresentation<Props> => ({ component: BlurZoom, props: {} });
