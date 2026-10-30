import type React from "react";
import { FONT } from "../theme";

export const CHROME_H = 46;

/** A macOS browser window frame. The page content is passed as children and clipped to the viewport. */
export const BrowserWindow: React.FC<{ width: number; height: number; url: string; title: string; children: React.ReactNode; style?: React.CSSProperties }> = ({
  width,
  height,
  url,
  title,
  children,
  style,
}) => (
  <div
    style={{
      position: "absolute",
      width,
      height: height + CHROME_H,
      borderRadius: 18,
      overflow: "hidden",
      background: "#fff",
      boxShadow: "0 40px 120px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.08)",
      ...style,
    }}
  >
    <div style={{ height: CHROME_H, display: "flex", alignItems: "center", gap: 18, padding: "0 18px", background: "#ecebe6", borderBottom: "1px solid #d9d8d2" }}>
      <div style={{ display: "flex", gap: 8 }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
          <span key={c} style={{ width: 13, height: 13, borderRadius: "50%", background: c, boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.15)" }} />
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", borderRadius: 9, background: "#fff", fontFamily: FONT.body, fontSize: 15, fontWeight: 500, color: "#18201d", maxWidth: 300 }}>
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#c9ef53", boxShadow: "0 0 0 2px #126b50" }} />
        {title}
      </div>
      <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
        <div style={{ width: "46%", padding: "6px 16px", borderRadius: 9, background: "#f7f7f4", border: "1px solid #dedcd5", fontFamily: FONT.body, fontSize: 15, color: "#5c6661", textAlign: "center" }}>
          {url}
        </div>
      </div>
      <div style={{ width: 120 }} />
    </div>
    <div style={{ position: "relative", width, height, overflow: "hidden", background: "#f6f6f1" }}>{children}</div>
  </div>
);
