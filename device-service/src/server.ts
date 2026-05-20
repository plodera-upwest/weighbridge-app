import express from "express";
import net from "node:net";

const PORT = Number(process.env.DEVICE_PORT || 4180);
const app = express();

app.get("/weight", async (_req, res) => {
  const mode = process.env.SCALE_MODE || "simulator";
  if (mode === "tcp") {
    res.json(await readTcpWeight());
    return;
  }
  if (mode === "serial") {
    res.json(await readSerialWeight());
    return;
  }
  res.json(readSimulatedWeight());
});

function readSimulatedWeight() {
  const base = 8200 + Math.sin(Date.now() / 2400) * 1200;
  return {
    weight: Math.max(0, Math.round(base + Math.random() * 70 - 35)),
    stable: Math.random() > 0.18,
    source: "device-service simulator"
  };
}

async function readTcpWeight() {
  const host = process.env.SCALE_TCP_HOST || "127.0.0.1";
  const port = Number(process.env.SCALE_TCP_PORT || 4001);
  const raw = await new Promise<string>((resolve, reject) => {
    const socket = net.createConnection({ host, port }, () => socket.write("W\r\n"));
    socket.setTimeout(2500);
    socket.on("data", (chunk) => {
      resolve(chunk.toString());
      socket.destroy();
    });
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("Scale TCP timeout"));
    });
    socket.on("error", reject);
  });
  return parseWeight(raw, "tcp");
}

async function readSerialWeight() {
  throw new Error("Serial support requires installing and wiring the serialport package for the target machine");
}

function parseWeight(raw: string, source: string) {
  const match = raw.match(/[-+]?\d+(\.\d+)?/);
  return {
    weight: match ? Math.round(Number(match[0])) : 0,
    stable: /ST|stable/i.test(raw),
    source,
    raw
  };
}

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Device service running at http://127.0.0.1:${PORT}`);
});
