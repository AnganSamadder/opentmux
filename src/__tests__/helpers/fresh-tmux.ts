import { test } from 'bun:test';
import * as childProcess from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as os from 'node:os';

export interface TmuxExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function resolveTmuxBinary(): Promise<string> {
  const lookupCommand = os.platform() === 'win32' ? 'where' : 'which';
  const lookupResult = await execFileAsync(lookupCommand, ['tmux']);

  if (lookupResult.exitCode !== 0) {
    test.skip('tmux not found');
    throw new Error('tmux not found');
  }

  const tmuxPath = lookupResult.stdout
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);

  if (!tmuxPath) {
    test.skip('tmux not found');
    throw new Error('tmux not found');
  }

  const verifyResult = await execFileAsync(tmuxPath, ['-V']);

  if (verifyResult.exitCode !== 0) {
    test.skip('tmux not found');
    throw new Error('tmux not found');
  }

  return tmuxPath;
}

function execFileAsync(file: string, args: string[]): Promise<TmuxExecResult> {
  return new Promise((resolve, reject) => {
    const spawnedProcess = childProcess.spawn(file, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    spawnedProcess.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    spawnedProcess.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    spawnedProcess.on('error', reject);
    spawnedProcess.on('close', (exitCode) => {
      resolve({
        stdout,
        stderr,
        exitCode: exitCode ?? 1,
      });
    });
  });
}

export async function tmuxExec(socket: string, args: string[]): Promise<TmuxExecResult> {
  const tmuxPath = await resolveTmuxBinary();
  return execFileAsync(tmuxPath, ['-L', socket, ...args]);
}

export async function startFreshTmuxServer(): Promise<{
  socket: string;
  cleanup: () => Promise<void>;
}> {
  const socket = `opentmux-test-${randomUUID().slice(0, 8)}`;
  let cleanupStarted = false;

  const cleanup = async (): Promise<void> => {
    if (cleanupStarted) {
      return;
    }

    cleanupStarted = true;

    try {
      await tmuxExec(socket, ['kill-server']);
    } finally {
      cleanupStarted = true;
    }
  };

  try {
    const startResult = await tmuxExec(socket, [
      '-f',
      '/dev/null',
      'new-session',
      '-d',
      '-s',
      'test',
      '-x',
      '200',
      '-y',
      '50',
      'sh',
    ]);

    if (startResult.exitCode !== 0) {
      throw new Error(startResult.stderr.trim() || 'failed to start fresh tmux server');
    }

    return { socket, cleanup };
  } catch (error) {
    try {
      await cleanup();
    } finally {
      throw error;
    }
  }
}
