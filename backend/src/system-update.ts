import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type SystemUpdateStatus = {
  enabled: boolean;
  running: boolean;
  scriptPath: string;
  scriptExists: boolean;
  workingDirectory: string;
  currentCommit: string;
  runner: "direct" | "systemd-run";
  lastStartedAt?: string;
  lastFinishedAt?: string;
  lastExitCode?: number | null;
  lastError?: string;
  lastOutput: string;
};

const workingDirectory = process.cwd();
const dataDirectory = path.join(workingDirectory, "data");
const logPath = path.join(dataDirectory, "system-update.log");
const maxLogBytes = 60_000;

let running = false;
let lastStartedAt: string | undefined;
let lastFinishedAt: string | undefined;
let lastExitCode: number | null | undefined;
let lastError: string | undefined;

function envEnabled() {
  return process.env.ENABLE_SELF_UPDATE === "true";
}

function updateScriptPath() {
  return process.env.UPDATE_SCRIPT_PATH || (process.platform === "win32" ? "" : "/usr/local/bin/weighbridge-update");
}

function runner(): "direct" | "systemd-run" {
  return process.platform !== "win32" && process.env.UPDATE_USE_SYSTEMD_RUN !== "false" ? "systemd-run" : "direct";
}

function ensureDataDirectory() {
  fs.mkdirSync(dataDirectory, { recursive: true });
}

function appendLog(message: string) {
  ensureDataDirectory();
  fs.appendFileSync(logPath, message);
}

function readLogTail() {
  try {
    const stats = fs.statSync(logPath);
    const start = Math.max(0, stats.size - maxLogBytes);
    const fd = fs.openSync(logPath, "r");
    const buffer = Buffer.alloc(stats.size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    fs.closeSync(fd);
    return buffer.toString("utf8");
  } catch {
    return "";
  }
}

function scriptExists(scriptPath: string) {
  if (!scriptPath) return false;
  try {
    return fs.statSync(scriptPath).isFile();
  } catch {
    return false;
  }
}

function currentCommit() {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: workingDirectory,
    encoding: "utf8",
    windowsHide: true
  });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

function systemdRunAvailable() {
  if (process.platform === "win32") return false;
  const result = spawnSync("systemd-run", ["--version"], {
    encoding: "utf8",
    windowsHide: true
  });
  return result.status === 0;
}

export function getSystemUpdateStatus(): SystemUpdateStatus {
  const scriptPath = updateScriptPath();
  return {
    enabled: envEnabled() && Boolean(scriptPath),
    running,
    scriptPath,
    scriptExists: scriptExists(scriptPath),
    workingDirectory,
    currentCommit: currentCommit(),
    runner: runner(),
    lastStartedAt,
    lastFinishedAt,
    lastExitCode: lastExitCode ?? null,
    lastError,
    lastOutput: readLogTail()
  };
}

export function startSystemUpdate(requestedBy: string): SystemUpdateStatus {
  const scriptPath = updateScriptPath();
  if (!envEnabled()) {
    throw new Error("System update is disabled. Enable it on the server before using this button.");
  }
  if (!scriptPath) {
    throw new Error("No update script path is configured.");
  }
  if (!scriptExists(scriptPath)) {
    throw new Error(`Update script was not found at ${scriptPath}.`);
  }
  if (running) {
    throw new Error("A system update is already running.");
  }

  running = true;
  lastStartedAt = new Date().toISOString();
  lastFinishedAt = undefined;
  lastExitCode = undefined;
  lastError = undefined;
  appendLog(`\n\n=== Weighbridge update started ${lastStartedAt} by ${requestedBy} ===\n`);

  const useSystemdRun = runner() === "systemd-run" && systemdRunAvailable();
  const unitName = `weighbridge-self-update-${Date.now()}`;
  const command = useSystemdRun
    ? "systemd-run"
    : process.platform === "win32"
      ? "powershell.exe"
      : "bash";
  const args = useSystemdRun
    ? [
        "--unit",
        unitName,
        "--collect",
        "--property=Type=oneshot",
        `--property=WorkingDirectory=${workingDirectory}`,
        `--setenv=WEIGHBRIDGE_UPDATE_REQUESTED_BY=${requestedBy}`,
        `--setenv=WEIGHBRIDGE_UPDATE_LOG=${logPath}`,
        "/bin/bash",
        scriptPath
      ]
    : process.platform === "win32"
      ? ["-ExecutionPolicy", "Bypass", "-File", scriptPath]
      : [scriptPath];

  appendLog(`Runner: ${useSystemdRun ? "systemd-run" : "direct"}\n`);

  const child = spawn(command, args, {
    cwd: workingDirectory,
    env: {
      ...process.env,
      WEIGHBRIDGE_UPDATE_REQUESTED_BY: requestedBy,
      WEIGHBRIDGE_UPDATE_LOG: logPath
    },
    windowsHide: true
  });

  child.stdout?.on("data", (chunk) => appendLog(chunk.toString()));
  child.stderr?.on("data", (chunk) => appendLog(chunk.toString()));
  child.on("error", (error) => {
    running = false;
    lastFinishedAt = new Date().toISOString();
    lastExitCode = null;
    lastError = error.message;
    appendLog(`\nUpdate failed to start: ${error.message}\n`);
  });
  child.on("close", (code) => {
    running = false;
    lastFinishedAt = new Date().toISOString();
    lastExitCode = code;
    appendLog(`\n=== Weighbridge update runner finished ${lastFinishedAt} with code ${code ?? "unknown"} ===\n`);
  });

  return getSystemUpdateStatus();
}
