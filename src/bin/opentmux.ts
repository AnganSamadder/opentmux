#!/usr/bin/env node

import { spawn, execSync } from "node:child_process";
import { createServer } from "node:net";
import { env, platform, exit, argv } from "node:process";
import { existsSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { ZombieReaper } from "../zombie-reaper";
import { loadConfig } from "../utils/config-loader";
import {
  safeExec,
  getListeningPids,
  isProcessAlive,
  getProcessCommand,
  safeKill,
  waitForProcessExit,
  getProcessStartTime,
} from "../utils/process";

/**
 * Deterministic 8-char hex hash of a working directory, for tmux session naming.
 * DJB2-style — no crypto dependency, good enough for session-name uniqueness.
 */
function hashCwd(cwd: string): string {
  let hash = 5381;
  for (let i = 0; i < cwd.length; i++) {
    hash = ((hash << 5) + hash) + cwd.charCodeAt(i);
    hash = hash & hash; // coerce to 32-bit
  }
  return Math.abs(hash).toString(16).padStart(8, "0").slice(0, 8);
}

/**
 * Build the deterministic tmux session name for a working directory.
 */
function sessionNameForCwd(cwd: string): string {
  return `opencode-${hashCwd(cwd)}`;
}

interface TmuxSessionMap {
  /** pane_pid → session_name */
  panePidToSession: Map<number, string>;
  /** session names that currently have at least one attached client */
  attachedSessions: Set<string>;
}

/**
 * Build a map of every tmux pane PID to its session name, plus the set of
 * sessions that currently have attached clients. Returns empty structures if
 * tmux is unavailable or no sessions exist.
 */
function buildTmuxSessionMap(): TmuxSessionMap {
  const panePidToSession = new Map<number, string>();
  const attachedSessions = new Set<string>();

  if (!hasTmux()) return { panePidToSession, attachedSessions };

  const paneOutput = safeExec(
    "tmux list-panes -a -F '#{pane_pid} #{session_name}' 2>/dev/null",
  );
  if (paneOutput) {
    for (const line of paneOutput.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const spaceIdx = trimmed.indexOf(" ");
      if (spaceIdx === -1) continue;
      const pid = Number.parseInt(trimmed.slice(0, spaceIdx), 10);
      const name = trimmed.slice(spaceIdx + 1).trim();
      if (Number.isFinite(pid) && name) {
        panePidToSession.set(pid, name);
      }
    }
  }

  const clientOutput = safeExec(
    "tmux list-clients -F '#{client_session}' 2>/dev/null",
  );
  if (clientOutput) {
    for (const name of clientOutput.split("\n")) {
      const trimmed = name.trim();
      if (trimmed) attachedSessions.add(trimmed);
    }
  }

  return { panePidToSession, attachedSessions };
}

/**
 * Walk up the process tree from `pid` and return the name of the tmux session
 * whose pane_pid is an ancestor of `pid`, or null if the process is not inside
 * any tmux session.
 */
function findTmuxSessionForPid(
  pid: number,
  map: TmuxSessionMap,
): string | null {
  let current = pid;
  const visited = new Set<number>();
  while (current > 1 && !visited.has(current)) {
    if (map.panePidToSession.has(current)) {
      return map.panePidToSession.get(current)!;
    }
    visited.add(current);
    const parent = getParentPid(current);
    if (!parent || parent <= 1) break;
    current = parent;
  }
  return null;
}

/**
 * Retrieve the OPENCODE_PORT stored in a tmux session's environment.
 * Returns the port number, or null if the session doesn't exist, doesn't have
 * the env var, or the value is not a finite integer.
 */
function getSessionPort(sessionName: string): number | null {
  const output = safeExec(
    `tmux show-environment -t ${shellQuote(sessionName)} OPENCODE_PORT 2>/dev/null`,
  );
  if (!output) return null;
  const match = output.match(/OPENCODE_PORT=(\d+)/);
  if (!match) return null;
  const port = Number.parseInt(match[1], 10);
  return Number.isFinite(port) ? port : null;
}

/**
 * Store OPENCODE_PORT in a tmux session's environment so future launcher
 * invocations can discover it for reuse.
 */
function setSessionPort(sessionName: string, port: number): void {
  safeExec(
    `tmux set-environment -t ${shellQuote(sessionName)} OPENCODE_PORT ${port}`,
  );
}

/**
 * Shell-quote a value for safe use inside a tmux command. Wraps in single
 * quotes and escapes any embedded single quotes.
 */
function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_.-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

// Load config
const config = loadConfig();
const OPENCODE_PORT_START =
  config.port || parseInt(env.OPENCODE_PORT || "4096", 10);
const OPENCODE_PORT_MAX = OPENCODE_PORT_START + (config.max_ports || 10);
const LOG_FILE = "/tmp/opentmux.log";
const HEALTH_TIMEOUT_MS = 1000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function log(...args: unknown[]): void {
  const timestamp = new Date().toISOString();
  const message = `[${timestamp}] ${args.join(" ")}\n`;
  try {
    appendFileSync(LOG_FILE, message);
  } catch {}
}

function spawnPluginUpdater(): void {
  if (env.OPENCODE_TMUX_DISABLE_UPDATES === "1") return;

  const updaterPath = join(__dirname, "../scripts/update-plugins.js");
  if (!existsSync(updaterPath)) return;

  try {
    const child = spawn(process.execPath, [updaterPath], {
      stdio: "ignore",
      detached: true,
      env: {
        ...process.env,
        OPENCODE_TMUX_UPDATE: "1",
      },
    });
    child.unref();
  } catch (error) {}
}

function findOpencodeBin(): string | null {
  try {
    const cmd = platform === "win32" ? "where opencode" : "which -a opencode";
    const output = execSync(cmd, { encoding: "utf-8" }).trim().split("\n");

    const currentScript = argv[1];

    for (const bin of output) {
      const normalizedBin = bin.trim();
      if (normalizedBin.includes("opentmux") || normalizedBin === currentScript)
        continue;
      if (normalizedBin) return normalizedBin;
    }
  } catch (e) {}

  const commonPaths = [
    join(
      homedir(),
      ".opencode",
      "bin",
      platform === "win32" ? "opencode.exe" : "opencode",
    ),
    join(homedir(), "AppData", "Local", "opencode", "bin", "opencode.exe"),
    "/usr/local/bin/opencode",
    "/usr/bin/opencode",
  ];

  for (const p of commonPaths) {
    if (existsSync(p)) return p;
  }

  return null;
}

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(port, "127.0.0.1");
    server.on("listening", () => {
      server.close();
      resolve(true);
    });
    server.on("error", () => {
      resolve(false);
    });
  });
}

async function isOpencodeHealthy(port: number): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  const healthUrl = `http://127.0.0.1:${port}/health`;

  try {
    const response = await fetch(healthUrl, {
      signal: controller.signal,
    }).catch(() => null);
    return response?.ok ?? false;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function getProcessStat(pid: number): string | null {
  const output = safeExec(`ps -p ${pid} -o stat=`);
  return output && output.length > 0 ? output.trim() : null;
}

function getProcessTty(pid: number): string | null {
  const output = safeExec(`ps -p ${pid} -o tty=`);
  return output && output.length > 0 ? output.trim() : null;
}

function getTtyProcessIds(tty: string): number[] {
  const output = safeExec(`ps -t ${tty} -o pid=`);
  if (!output) return [];
  return output
    .split("\n")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value));
}

function hasOtherTtyProcesses(tty: string | null, pid: number): boolean {
  if (!tty || tty === "?" || tty === "??") return false;
  const ttyPids = getTtyProcessIds(tty);
  return ttyPids.some((ttyPid) => ttyPid !== pid);
}

function getParentPid(pid: number): number | null {
  const output = safeExec(`ps -p ${pid} -o ppid=`);
  if (!output) return null;
  const value = Number.parseInt(output.trim(), 10);
  return Number.isFinite(value) ? value : null;
}

function isForegroundProcess(pid: number): boolean {
  const stat = safeExec(`ps -p ${pid} -o stat=`);
  if (!stat) return false;
  return stat.includes("+");
}

async function getOpencodeSessionCount(port: number): Promise<number | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  const statusUrl = `http://127.0.0.1:${port}/session/status`;

  try {
    const response = await fetch(statusUrl, {
      signal: controller.signal,
    }).catch(() => null);
    if (!response?.ok) return null;

    const payload = (await response.json().catch(() => null)) as unknown;
    if (!payload || typeof payload !== "object") return null;

    const maybeData = (payload as { data?: unknown }).data;
    if (
      maybeData &&
      typeof maybeData === "object" &&
      !Array.isArray(maybeData)
    ) {
      return Object.keys(maybeData as Record<string, unknown>).length;
    }

    if (!Array.isArray(payload)) {
      return Object.keys(payload as Record<string, unknown>).length;
    }

    return payload.length;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function tryReclaimPort(
  port: number,
  tmuxSessionMap: TmuxSessionMap,
): Promise<boolean> {
  if (platform === "win32") return false;

  const healthy = await isOpencodeHealthy(port);
  if (healthy) return false;

  const pids = getListeningPids(port);

  log(
    "Port scan:",
    port.toString(),
    "healthy",
    String(healthy),
    "pids",
    pids.length > 0 ? pids.join(",") : "none",
  );

  if (pids.length === 0) {
    return false;
  }

  let attemptedKill = false;
  for (const pid of pids) {
    const command = getProcessCommand(pid);
    const tty = getProcessTty(pid);
    const stat = getProcessStat(pid);
    const hasTtyPeers = hasOtherTtyProcesses(tty, pid);

    const sessionName = findTmuxSessionForPid(pid, tmuxSessionMap);
    const inAttachedTmux =
      sessionName !== null && tmuxSessionMap.attachedSessions.has(sessionName);

    log(
      "Port process:",
      port.toString(),
      "pid",
      pid.toString(),
      "tty",
      tty ?? "unknown",
      "stat",
      stat ?? "unknown",
      "tmuxSession",
      sessionName ?? "none",
      "attached",
      String(inAttachedTmux),
      "ttyPeers",
      String(hasTtyPeers),
      "command",
      command ?? "unknown",
    );

    if (command && command.includes("opencode")) {
      if (sessionName && inAttachedTmux) {
        log(
          "Port owned by attached tmux session, skipping:",
          port.toString(),
          pid.toString(),
          sessionName,
        );
        continue;
      }
      if (sessionName && !inAttachedTmux) {
        log(
          "Port owned by detached tmux session with unhealthy opencode, reclaiming:",
          port.toString(),
          pid.toString(),
          sessionName,
        );
      } else {
        if (hasTtyPeers) {
          log(
            "Port owned by active tty process, skipping:",
            port.toString(),
            pid.toString(),
          );
          continue;
        }
        if (isForegroundProcess(pid)) {
          log(
            "Port owned by potentially busy foreground process, skipping:",
            port.toString(),
            pid.toString(),
          );
          continue;
        }
      }
    }

    log(
      "Attempting to stop stale or non-opencode process:",
      port.toString(),
      pid.toString(),
    );
    attemptedKill = true;
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }

  if (!attemptedKill) return false;

  await new Promise((resolve) => setTimeout(resolve, 700));

  for (const pid of pids) {
    if (isProcessAlive(pid)) {
      log(
        "Process still alive, sending SIGKILL:",
        port.toString(),
        pid.toString(),
      );
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 400));
  return checkPort(port);
}

async function findAvailablePort(): Promise<number | null> {
  let tmuxSessionMap: TmuxSessionMap | null = null;
  for (let port = OPENCODE_PORT_START; port <= OPENCODE_PORT_MAX; port++) {
    if (await checkPort(port)) return port;

    if (!tmuxSessionMap) {
      tmuxSessionMap = buildTmuxSessionMap();
    }

    const reclaimed = await tryReclaimPort(port, tmuxSessionMap);
    if (reclaimed && (await checkPort(port))) return port;
  }
  return null;
}

async function tryReuseSession(cwd: string): Promise<boolean> {
  const sessionName = sessionNameForCwd(cwd);

  let sessionExists = false;
  try {
    execSync(`tmux has-session -t ${shellQuote(sessionName)}`, {
      stdio: "ignore",
    });
    sessionExists = true;
  } catch {
    sessionExists = false;
  }

  if (!sessionExists) return false;

  const port = getSessionPort(sessionName);
  if (port === null) {
    log(
      "Existing session found but no port env var, killing and recreating:",
      sessionName,
    );
    safeExec(`tmux kill-session -t ${shellQuote(sessionName)}`);
    return false;
  }

  const healthy = await isOpencodeHealthy(port);
  if (!healthy) {
    log(
      "Existing session has unhealthy opencode, killing and recreating:",
      sessionName,
      "port",
      port.toString(),
    );
    safeExec(`tmux kill-session -t ${shellQuote(sessionName)}`);
    return false;
  }

  log("Reusing existing session:", sessionName, "port:", port.toString());
  console.log(`🔄 Reconnecting to existing session (${sessionName})...`);

  const child = spawn("tmux", ["attach-session", "-t", sessionName], {
    stdio: "inherit",
    env: process.env,
  });

  return new Promise<boolean>((resolve) => {
    child.on("close", (code) => {
      exit(code ?? 0);
    });
    child.on("error", (err) => {
      log("ERROR attaching to existing session:", err.message);
      resolve(false);
    });
  });
}

function hasTmux(): boolean {
  try {
    execSync("tmux -V", { stdio: "ignore" });
    return true;
  } catch (e) {
    return false;
  }
}

async function main() {
  // Check if running as a script (node script.js) or a compiled binary
  // In script mode: argv[0]=node, argv[1]=script, argv[2]=arg1 -> slice(2)
  // In binary mode: argv[0]=binary, argv[1]=arg1 -> slice(1)
  // Use regex to securely match only actual node/bun executables
  const isRuntime = /\/?(node|bun)(\.exe)?$/i.test(argv[0]);

  // In script mode, argv[1] is the script file path.
  // In compiled/binary mode, argv[0] is the binary, and argv[1] is the first user argument.
  // If we are running via node/bun, we are ALWAYS in script mode for this wrapper.
  const args = isRuntime ? argv.slice(2) : argv.slice(1);

  const forceNew = args.includes("--new") || args.includes("-new");
  const userArgs = args.filter(
    (a) => a !== "--new" && a !== "-new",
  );

  // Check for opentmux-specific flags first
  if (userArgs.includes("--reap") || userArgs.includes("-reap")) {
    await ZombieReaper.reapAll();
    exit(0);
  }

  // Define known CLI commands that should NOT trigger a tmux session
  // These are commands that either:
  // 1. Run quickly and exit (CLI tools)
  // 2. Are server/daemon processes that manage their own lifecycle
  // 3. Are help/version flags
  const NON_TUI_COMMANDS = [
    // Core CLI commands
    "auth",
    "config",
    "plugins",
    "update",
    "upgrade",
    "completion",
    "stats",
    "run",
    "exec",
    "doctor",
    "debug",
    "clean",
    "uninstall",

    // Agent/Session management
    "agent",
    "session",
    "export",
    "import",
    "github",
    "pr",

    // Server commands (usually run in fg, don't need tmux wrapper)
    "serve",
    "web",
    "acp",
    "mcp",
    "models",

    // Flags
    "--version",
    "-v",
    "--help",
    "-h",
  ];

  const isCliCommand =
    userArgs.length > 0 && NON_TUI_COMMANDS.includes(userArgs[0]);
  const isInteractiveMode = userArgs.length === 0;

  // For CLI commands, bypass tmux
  if (isCliCommand) {
    const opencodeBin = findOpencodeBin();
    if (!opencodeBin) {
      console.error(
        'Error: Could not find "opencode" binary in PATH or common locations.',
      );
      exit(1);
    }

    const bypassArgs = [...userArgs];
    const hasPrintLogs = userArgs.includes("--print-logs");
    if (!hasPrintLogs && !userArgs.some((arg) => arg.startsWith("--log-level"))) {
      bypassArgs.push("--log-level", "ERROR");
    }

    const child = spawn(opencodeBin, bypassArgs, {
      stdio: ["inherit", "inherit", "pipe"],
      env: process.env,
    });

    child.stderr?.on("data", (data) => {
      const lines = data.toString().split("\n");
      const filtered = lines.filter(
        (line: string) =>
          !/^INFO\s+.*service=models\.dev.*refreshing/.test(line),
      );
      process.stderr.write(filtered.join("\n"));
    });

    child.on("close", (code) => {
      exit(code ?? 0);
    });
    return;
  }

  const inTmux = !!env.TMUX;
  const tmuxAvailable = hasTmux();

  if (!inTmux && tmuxAvailable && !forceNew) {
    const reused = await tryReuseSession(process.cwd());
    if (reused) return;
  }

  log("=== OpenCode Tmux Wrapper Started ===");
  log("Process argv:", JSON.stringify(argv));
  log("Current directory:", process.cwd());
  log("Force new session?", forceNew);

  const opencodeBin = findOpencodeBin();
  log("Found opencode binary:", opencodeBin);

  if (!opencodeBin) {
    console.error(
      'Error: Could not find "opencode" binary in PATH or common locations.',
    );
    log("ERROR: opencode binary not found");
    exit(1);
  }

  spawnPluginUpdater();

  let port = await findAvailablePort();
  log("Found available port:", port);

  if (!port) {
    if (config.rotate_port) {
      log("Port rotation enabled. Finding oldest session to kill...");
      let oldestPid: number | null = null;
      let oldestTime = Date.now();
      let targetPort = -1;

      for (let p = OPENCODE_PORT_START; p <= OPENCODE_PORT_MAX; p++) {
        const pids = getListeningPids(p);
        for (const pid of pids) {
          const cmd = getProcessCommand(pid);
          if (
            cmd &&
            (cmd.includes("opencode") ||
              cmd.includes("node") ||
              cmd.includes("bun"))
          ) {
            const startTime = getProcessStartTime(pid);
            if (startTime && startTime < oldestTime) {
              oldestTime = startTime;
              oldestPid = pid;
              targetPort = p;
            }
          }
        }
      }

      if (oldestPid && targetPort !== -1) {
        log("Rotating port:", targetPort, "Killing oldest PID:", oldestPid);
        console.log(
          `♻️  Port rotation: Killing oldest session (PID ${oldestPid}) on port ${targetPort} to make room...`,
        );
        safeKill(oldestPid, "SIGTERM");
        await waitForProcessExit(oldestPid, 2000);
        if (isProcessAlive(oldestPid)) {
          safeKill(oldestPid, "SIGKILL");
          await waitForProcessExit(oldestPid, 1000);
        }

        // Re-check the port to confirm it's free
        if (await checkPort(targetPort)) {
          port = targetPort;
          log("Port reclaimed successfully:", port);
        } else {
          console.error(
            `⚠️  Failed to reclaim port ${targetPort} even after killing PID ${oldestPid}.`,
          );
          exit(1);
        }
      } else {
        console.error(
          "Error: Could not find any valid OpenCode sessions to rotate.",
        );
        exit(1);
      }
    } else {
      console.error(
        `Error: No available ports found in range ${OPENCODE_PORT_START}-${OPENCODE_PORT_MAX}.`,
      );
      console.error('Tip: Run "opentmux -reap" to clean up stuck sessions.');
      console.error(
        '     Or enable "rotate_port": true in config to automatically recycle oldest sessions.',
      );
      log("ERROR: No available ports");
      exit(1);
    }
  }

  const env2 = { ...process.env };
  env2.OPENCODE_PORT = port.toString();

  log("User args:", JSON.stringify(userArgs));

  const childArgs = ["--port", port.toString(), ...userArgs];
  log("Final childArgs:", JSON.stringify(childArgs));

  log("In tmux?", inTmux);
  log("Tmux available?", tmuxAvailable);

  if (inTmux || !tmuxAvailable) {
    log("Running directly (in tmux or no tmux available)");

    const child = spawn(opencodeBin, childArgs, {
      stdio: "inherit",
      env: env2,
    });

    child.on("error", (err) => {
      log("ERROR spawning child:", err.message);
    });

    child.on("close", (code) => {
      log("Child exited with code:", code);
      exit(code ?? 0);
    });

    process.on("SIGINT", () => child.kill("SIGINT"));
    process.on("SIGTERM", () => child.kill("SIGTERM"));
  } else {
    const sessionName = forceNew
      ? `opencode-${hashCwd(process.cwd())}-${Date.now().toString(36)}`
      : sessionNameForCwd(process.cwd());

    console.log(`🚀 Launching tmux session (${sessionName})...`);
    log("Launching tmux session:", sessionName);

    const escapedBin = opencodeBin.includes(" ")
      ? `'${opencodeBin}'`
      : opencodeBin;
    const escapedArgs = childArgs.map((arg) => {
      if (arg.includes(" ") || arg.includes('"') || arg.includes("'")) {
        return `'${arg.replace(/'/g, "'\\''")}'`;
      }
      return arg;
    });

    const opencodeInvocation = `${escapedBin} ${escapedArgs.join(" ")}`;
    const shellCommand = config.auto_close
      ? opencodeInvocation
      : `${opencodeInvocation}; echo "Exit code: $?"; echo "Press Enter to close..."; read`;

    log("Shell command for tmux:", shellCommand);
    log("auto_close:", config.auto_close);

    const tmuxArgs = [
      "new-session",
      "-s",
      sessionName,
      shellCommand,
    ];

    log("Tmux args:", JSON.stringify(tmuxArgs));

    const child = spawn("tmux", tmuxArgs, { stdio: "inherit", env: env2 });

    child.on("error", (err) => {
      log("ERROR spawning tmux:", err.message);
    });

    child.on("spawn", () => {
      setSessionPort(sessionName, port);
    });

    child.on("close", (code) => {
      log("Tmux exited with code:", code);
      exit(code ?? 0);
    });
  }
}

if (!env.OPENCODE_TMUX_NO_RUN) {
  main().catch((err) => {
    if (err.name === "AbortError" || err.code === 20) {
      exit(0);
    }

    log("FATAL ERROR:", err.message, err.stack);
    console.error(err);
    exit(1);
  });
}

// main() runs on import, so tests gate it via the OPENCODE_TMUX_NO_RUN env var.
export {
  hashCwd,
  sessionNameForCwd,
  buildTmuxSessionMap,
  findTmuxSessionForPid,
  getSessionPort,
  setSessionPort,
  shellQuote,
  tryReuseSession,
  tryReclaimPort,
  findAvailablePort,
  type TmuxSessionMap,
};
