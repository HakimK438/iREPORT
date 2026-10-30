/** The standard macOS arrow pointer: black with a white outline. Tip is at (0, 0). */
export const MacCursor: React.FC<{ size?: number; press?: number }> = ({ size = 44, press = 0 }) => (
  <svg
    width={size}
    height={size * 1.5}
    viewBox="0 0 16 24"
    style={{ position: "absolute", left: -size * 0.12, top: -size * 0.06, scale: String(1 - press * 0.14), transformOrigin: "12% 4%", filter: "drop-shadow(0 3px 5px rgba(0,0,0,0.38))" }}
  >
    <path d="M1.5 1.2v18.6l4.6-4.4 3.1 7.2 3.2-1.4-3.1-7.1h6.3z" fill="#fff" />
    <path d="M2.9 4.5v12.1l3.6-3.4 3.3 7.4 1.1-.5-3.3-7.3h4.9z" fill="#000" />
  </svg>
);
