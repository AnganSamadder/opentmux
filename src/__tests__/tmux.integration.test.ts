import { afterEach, describe, expect, it, mock, spyOn, test } from 'bun:test';
import * as childProcess from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  countEscapeSeq,
  readCapturedBytes,
  startPipePane,
  stopPipePane,
} from './helpers/pipe-pane';
import { startFreshTmuxServer, tmuxExec } from './helpers/fresh-tmux';
import { scanLeakedModes } from '../utils/escape-codes';

const PIPE_PANE_SETTLE_MS = 100;
const PANE_SETTLE_MS = 200;
const SELF_EXIT_SETTLE_MS = 300;

function isTmuxAvailable(): boolean {
  const lookupCommand = process.platform === 'win32' ? 'where' : 'which';
  const lookupResult = childProcess.spawnSync(lookupCommand, ['tmux'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });

  if (lookupResult.status !== 0) {
    return false;
  }

  const tmuxPath = lookupResult.stdout
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);

  if (!tmuxPath) {
    return false;
  }

  const verifyResult = childProcess.spawnSync(tmuxPath, ['-V'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });

  return verifyResult.status === 0;
}

const tmuxAvailable = isTmuxAvailable();

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function createCaptureArtifactPath(): Promise<string> {
  const artifactDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'opentmux-tmux-integration-'));
  return path.join(artifactDirectory, 'capture.bin');
}

async function listPaneIds(socket: string): Promise<string[]> {
  const listPanesResult = await tmuxExec(socket, ['list-panes', '-F', '#{pane_id}']);
  expect(listPanesResult.exitCode).toBe(0);

  return listPanesResult.stdout
    .split('\n')
    .map((paneId) => paneId.trim())
    .filter((paneId) => paneId.length > 0);
}

async function splitAgentPane(socket: string, shellCommand: string): Promise<string> {
  const splitPaneResult = await tmuxExec(socket, [
    'split-window',
    '-h',
    '-d',
    '-P',
    '-F',
    '#{pane_id}',
    shellCommand,
  ]);

  expect(splitPaneResult.exitCode).toBe(0);
  const paneId = splitPaneResult.stdout.trim();
  expect(paneId.length).toBeGreaterThan(0);
  return paneId;
}

describe('tmux integration close edge cases', () => {
  if (!process.env.INTEGRATION_TMUX) {
    test.skip('requires INTEGRATION_TMUX=1', () => {});
    return;
  }

  if (!tmuxAvailable) {
    test.skip('tmux not found', () => {});
    return;
  }

  let cleanupFreshServer: (() => Promise<void>) | null = null;

  afterEach(async () => {
    try {
      if (cleanupFreshServer) {
        await cleanupFreshServer();
      }
    } finally {
      cleanupFreshServer = null;
      mock.restore();
    }
  });

  it('concurrent close keeps the parent pane state clean', async () => {
    let captureStarted = false;
    let parentPaneId = '';
    let freshServerSocket = '';

    try {
      const freshServer = await startFreshTmuxServer();
      cleanupFreshServer = freshServer.cleanup;
      freshServerSocket = freshServer.socket;

      const [initialParentPaneId] = await listPaneIds(freshServer.socket);
      expect(initialParentPaneId).toBeDefined();
      parentPaneId = initialParentPaneId;

      const agentPaneIds = await Promise.all([
        splitAgentPane(
          freshServer.socket,
          `sh -c 'printf "\\033[?2004h\\033[?1049h"; sleep 60'`,
        ),
        splitAgentPane(
          freshServer.socket,
          `sh -c 'printf "\\033[?2004h\\033[?1049h"; sleep 60'`,
        ),
      ]);

      await sleep(PANE_SETTLE_MS);
      expect(await listPaneIds(freshServer.socket)).toHaveLength(3);

      const artifactPath = await createCaptureArtifactPath();
      await startPipePane(freshServer.socket, parentPaneId, artifactPath);
      captureStarted = true;

      await sleep(PIPE_PANE_SETTLE_MS);

      const closeResults = await Promise.all(
        agentPaneIds.map((paneId) => tmuxExec(freshServer.socket, ['kill-pane', '-t', paneId])),
      );

      expect(closeResults.map((result) => result.exitCode)).toEqual([0, 0]);

      const layoutResult = await tmuxExec(freshServer.socket, ['select-layout', 'main-vertical']);
      expect(layoutResult.exitCode).toBe(0);

      const refreshResult = await tmuxExec(freshServer.socket, ['refresh-client', '-S']);
      expect([0, 1]).toContain(refreshResult.exitCode);

      await sleep(PIPE_PANE_SETTLE_MS);
      await stopPipePane(freshServer.socket, parentPaneId);
      captureStarted = false;

      const capturedBytes = await readCapturedBytes(artifactPath);
      const leakedModes = scanLeakedModes(capturedBytes).filter((mode) => mode.leaked);

      expect(countEscapeSeq(capturedBytes, '\u001b[2J')).toBeLessThanOrEqual(1);
      expect(leakedModes).toEqual([]);
      expect(await listPaneIds(freshServer.socket)).toHaveLength(1);
    } finally {
      if (captureStarted && freshServerSocket && parentPaneId) {
        await stopPipePane(freshServerSocket, parentPaneId).catch(() => {});
      }
    }
  });

  it('handles agent self-exit during close without crashing', async () => {
    const freshServer = await startFreshTmuxServer();
    cleanupFreshServer = freshServer.cleanup;

    const [parentPaneId] = await listPaneIds(freshServer.socket);
    expect(parentPaneId).toBeDefined();

    const agentPaneId = await splitAgentPane(freshServer.socket, `sh -c 'sleep 0.1; exit 0'`);

    await sleep(SELF_EXIT_SETTLE_MS);

    const killPaneResult = await tmuxExec(freshServer.socket, ['kill-pane', '-t', agentPaneId]);

    expect([0, 1]).toContain(killPaneResult.exitCode);
    expect(await listPaneIds(freshServer.socket)).toHaveLength(1);
  });
});
