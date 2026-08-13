import { ImageResponse } from "next/og";

import { searchSite, site } from "./site";

export const alt = searchSite.socialImage.alt;
export const contentType = "image/png";
export const size = { width: 1200, height: 630 };

export default function Image() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "stretch",
        background: "#f8f7f4",
        color: "#1c1917",
        display: "flex",
        flexDirection: "column",
        fontFamily: "Arial, sans-serif",
        height: "100%",
        justifyContent: "space-between",
        padding: "72px 82px",
        width: "100%",
      }}
    >
      <div style={{ alignItems: "center", display: "flex", fontSize: 28, gap: 14 }}>
        <div
          style={{
            alignItems: "center",
            border: `5px solid ${site.palette.chromatic.key}`,
            borderRadius: "50%",
            display: "flex",
            height: 36,
            justifyContent: "center",
            width: 36,
          }}
        >
          <div style={{ background: site.palette.chromatic.key, borderRadius: "50%", height: 12, width: 12 }} />
        </div>
        <span>{site.domain}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <div style={{ fontSize: 82, fontWeight: 700, letterSpacing: "-4px" }}>Compare coding agents</div>
        <div style={{ color: "#625d57", fontSize: 34 }}>Performance, cost, runtime, and token use in one chart.</div>
      </div>
      <div style={{ background: site.palette.chromatic.key, height: 10, width: "100%" }} />
    </div>,
    size,
  );
}
