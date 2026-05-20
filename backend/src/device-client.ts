import { Settings } from "./types";

export async function readLiveWeight(settings: Settings) {
  const weighbridge = settings.weighbridges.find((item) => item.active) || settings.weighbridges[0];
  const device = weighbridge || settings.device;
  const serviceUrl = process.env.DEVICE_SERVICE_URL || "";
  if (serviceUrl) {
    try {
      const response = await fetch(`${serviceUrl}/weight`);
      if (response.ok) {
        const reading = await response.json();
        return { ...reading, weighbridgeId: weighbridge?.id, weighbridgeName: weighbridge?.name };
      }
    } catch {
      // Fall through to simulator when the local device service is not available.
    }
  }

  const base = 8200 + Math.sin(Date.now() / 2400) * 1200;
  return {
    weight: Math.max(0, Math.round(base + Math.random() * 70 - 35)),
    stable: Math.random() > 0.18,
    source: device.connectionType === "simulator" ? `${weighbridge?.name || "Weighbridge"} simulator` : `${weighbridge?.name || "Weighbridge"} ${device.connectionType} fallback`,
    weighbridgeId: weighbridge?.id,
    weighbridgeName: weighbridge?.name
  };
}
