import { CameraImage, Settings } from "./types";
import { uid } from "./repository";

export async function captureCameras(settings: Settings, weighmentType: "FIRST" | "FINAL"): Promise<CameraImage[]> {
  const now = new Date().toISOString();
  return settings.cameras
    .filter((camera) => camera.active && camera.displayOnSlip)
    .filter((camera) => camera.captureTiming === "BOTH" || camera.captureTiming === weighmentType)
    .sort((left, right) => left.displayOrder - right.displayOrder)
    .map((camera) => ({
      id: uid("img"),
      cameraId: camera.id,
      cameraName: camera.name,
      weighmentType,
      position: camera.position,
      imageUrl: `/api/camera-snapshots/${camera.id}/${weighmentType}/${encodeURIComponent(now)}.svg`,
      capturedAt: now
    }));
}

export function renderCameraSvg(input: {
  cameraId: string;
  cameraName: string;
  position: string;
  weighmentType: string;
  capturedAt: string;
  mode: "preview" | "snapshot";
}) {
  const title = escapeXml(input.cameraName);
  const subtitle = escapeXml(`${input.position} ${input.mode === "preview" ? "live preview" : `${input.weighmentType} capture`}`);
  const time = escapeXml(new Date(input.capturedAt).toLocaleString());
  const accent = input.position === "FRONT" ? "#14b8a6" : input.position === "REAR" ? "#f59e0b" : "#64748b";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="720" height="405" viewBox="0 0 720 405" role="img" aria-label="${title}">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#0f172a"/>
      <stop offset="1" stop-color="#1e293b"/>
    </linearGradient>
    <pattern id="grid" width="36" height="36" patternUnits="userSpaceOnUse">
      <path d="M 36 0 L 0 0 0 36" fill="none" stroke="#334155" stroke-width="1" opacity="0.55"/>
    </pattern>
  </defs>
  <rect width="720" height="405" fill="url(#bg)"/>
  <rect width="720" height="405" fill="url(#grid)" opacity="0.5"/>
  <rect x="22" y="22" width="676" height="361" rx="12" fill="none" stroke="${accent}" stroke-width="4"/>
  <circle cx="85" cy="82" r="34" fill="${accent}" opacity="0.9"/>
  <path d="M118 116h120l34 54H84z" fill="#94a3b8" opacity="0.35"/>
  <path d="M432 126h136l52 110H384z" fill="#cbd5e1" opacity="0.22"/>
  <path d="M386 236h244" stroke="#cbd5e1" stroke-width="18" stroke-linecap="round" opacity="0.35"/>
  <text x="44" y="185" fill="#f8fafc" font-family="Arial, sans-serif" font-size="34" font-weight="700">${title}</text>
  <text x="44" y="226" fill="${accent}" font-family="Arial, sans-serif" font-size="24" font-weight="700">${subtitle}</text>
  <text x="44" y="263" fill="#cbd5e1" font-family="Arial, sans-serif" font-size="20">${time}</text>
  <text x="44" y="340" fill="#94a3b8" font-family="Arial, sans-serif" font-size="16">RTSP/ONVIF placeholder. Connect camera service to replace with real snapshots.</text>
  <circle cx="656" cy="58" r="9" fill="${input.mode === "preview" ? "#22c55e" : "#ef4444"}"/>
</svg>`;
}

function escapeXml(value: string) {
  return value.replace(/[<>&'"]/g, (char) => {
    const map: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      "'": "&apos;",
      "\"": "&quot;"
    };
    return map[char];
  });
}
