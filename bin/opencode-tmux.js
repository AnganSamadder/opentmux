#!/usr/bin/env node

import { spawn, execSync } from 'child_process';
import { createServer } from 'net';
import { env, platform, exit, argv } from 'process';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const OPENCODE_PORT_START = parseInt(env.OPENCODE_PORT || '4096', 10);
const OPENCODE_PORT_MAX = OPENCODE_PORT_START + 10;

function findOpencodeBin() {
  try {
    const cmd = platform === 'win32' ? 'where opencode' : 'which -a opencode';
    const output = execSync(cmd, { encoding: 'utf-8' }).trim().split('\n');
    const currentScript = process.argv[1];
    
    for (const bin of output) {
      const normalizedBin = bin.trim();
      if (normalizedBin.includes('opencode-tmux') || normalizedBin === currentScript) continue;
      if (normalizedBin) return normalizedBin;
    }
  } catch (e) {
  }

  const commonPaths = [
    join(homedir(), '.opencode', 'bin', platform === 'win32' ? 'opencode.exe' : 'opencode'),
    join(homedir(), 'AppData', 'Local', 'opencode', 'bin', 'opencode.exe'),
    '/usr/local/bin/opencode',
    '/usr/bin/opencode'
  ];

  for (const p of commonPaths) {
    if (existsSync(p)) return p;
  }

  return null;
}

function checkPort(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(port, '127.0.0.1');
    server.on('listening', () => {
      server.close();
      resolve(true);
    });
    server.on('error', () => {
      resolve(false);
    });
  });
}

async function findAvailablePort() {
  for (let port = OPENCODE_PORT_START; port <= OPENCODE_PORT_MAX; port++) {
    if (await checkPort(port)) return port;
  }
  return null;
}

function hasTmux() {
  try {
    execSync('tmux -V', { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

async function main() {
  const opencodeBin = findOpencodeBin();
  if (!opencodeBin) {
    console.error("❌ Error: Could not find 'opencode' binary.");
    console.error("   Please ensure OpenCode is installed and in your PATH.");
    exit(1);
  }

  const port = await findAvailablePort();
  if (!port) {
    console.error("❌ No ports available in range " + OPENCODE_PORT_START + "-" + OPENCODE_PORT_MAX);
    exit(1);
  }

  if (port !== OPENCODE_PORT_START) {
    console.warn(`⚠️  Port ${OPENCODE_PORT_START} is in use, using port ${port} instead`);
  }

  env.OPENCODE_PORT = port.toString();
  const args = argv.slice(2);
  const childArgs = ['--port', port.toString(), ...args];

  const inTmux = !!env.TMUX;
  const tmuxAvailable = hasTmux();

  if (inTmux || !tmuxAvailable) {
    const child = spawn(opencodeBin, childArgs, { stdio: 'inherit' });
    child.on('close', (code) => exit(code));
    
    process.on('SIGINT', () => child.kill('SIGINT'));
    process.on('SIGTERM', () => child.kill('SIGTERM'));

  } else {
    console.log("🚀 Launching tmux session...");
    
    const safeCommand = [
      `"${opencodeBin}"`,
      `--port ${port}`,
      ...args.map(a => `"${a}"`)
    ].join(' ');

    const shellCommand = `${safeCommand} || { echo "Exit code: $?"; echo "Press Enter to close..."; read; }`;

    const tmuxArgs = [
      'new-session',
      shellCommand
    ];

    const child = spawn('tmux', tmuxArgs, { stdio: 'inherit' });
    child.on('close', (code) => exit(code));
  }
}

main().catch(err => {
  console.error(err);
  exit(1);
});
