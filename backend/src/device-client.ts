import { Settings } from "./types";

export async function readLiveWeight(settings: Settings) {
  const weighbridge = settings.weighbridges.find((item) => item.active) || settings.weighbridges[0];
  const device = weighbridge || settings.device;
  const serviceUrl = process.env.DEVICE_SERVICE_URL || "";
  let deviceError = "";
  if (serviceUrl) {
    try {
      const response = await fetch(`${serviceUrl}/weight`);
      if (response.ok) {
        const reading = await response.json();
        return { ...reading, weighbridgeId: weighbridge?.id, weighbridgeName: weighbridge?.name };
      }
      deviceError = `Device service returned ${response.status}`;
      console.error(`[${new Date().toISOString()}] ${deviceError}`);
    } catch (error) {
      deviceError = error instanceof Error ? error.message : "Device service unavailable";
      console.error(`[${new Date().toISOString()}] Device service error: ${deviceError}`);
    }
  }

  const base = 8200 + Math.sin(Date.now() / 2400) * 1200;
  return {
    weight: Math.max(0, Math.round(base + Math.random() * 70 - 35)),
    stable: Math.random() > 0.18,
    source: device.connectionType === "simulator"
      ? `${weighbridge?.name || "Weighbridge"} simulator`
      : `${weighbridge?.name || "Weighbridge"} ${device.connectionType} fallback${deviceError ? ` (${deviceError})` : ""}`,
    weighbridgeId: weighbridge?.id,
    weighbridgeName: weighbridge?.name
  };
}
