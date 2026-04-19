import { afterEach, describe, expect, it, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  countEscapeSeq,
  readCapturedBytes,
  startPipePane,
  stopPipePane,
} from './pipe-pane';
import { startFreshTmuxServer, tmuxExec } from './fresh-tmux';

const PIPE_PANE_SETTLE_MS = 100;

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function sendHexKeys(socket: string, paneId: string, hexBytes: string[]): Promise<void> {
  const commandArgs = ['send-keys', '-t', paneId];

  for (const hexByte of hexBytes) {
    commandArgs.push('-H', hexByte);
  }

  const sendKeysResult = await tmuxExec(socket, commandArgs);
  expect(sendKeysResult.exitCode).toBe(0);
}

async function createCaptureArtifactPath(): Promise<string> {
  const artifactDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'opentmux-pipe-pane-'));
  return path.join(artifactDirectory, 'capture.bin');
}

describe('fresh tmux integration helpers', () => {
  let cleanupFreshServer: (() => Promise<void>) | null = null;
  let freshServerSocket = '';

  afterEach(async () => {
    try {
      if (cleanupFreshServer) {
        await cleanupFreshServer();
      }
    } finally {
      cleanupFreshServer = null;
      freshServerSocket = '';
    }
  });

  it('starts an isolated tmux server and lists a single pane', async () => {
    if (!process.env.INTEGRATION_TMUX) {
      test.skip('requires INTEGRATION_TMUX=1');
      return;
    }

    try {
      const freshServer = await startFreshTmuxServer();
      cleanupFreshServer = freshServer.cleanup;
      freshServerSocket = freshServer.socket;

      const listPanesResult = await tmuxExec(freshServer.socket, ['list-panes', '-F', '#{pane_id}']);

      expect(listPanesResult.exitCode).toBe(0);
      const paneIds = listPanesResult.stdout
        .split('\n')
        .map((paneId) => paneId.trim())
        .filter((paneId) => paneId.length > 0);

      expect(paneIds).toHaveLength(1);
    } catch (error) {
      if (error instanceof Error && error.message === 'tmux not found') {
        test.skip('tmux not found');
        return;
      }

      throw error;
    }
  });

  it('captures raw pane output bytes via pipe-pane', async () => {
    if (!process.env.INTEGRATION_TMUX) {
      test.skip('requires INTEGRATION_TMUX=1');
      return;
    }

    let pipePaneStarted = false;
    let paneId = '';

    try {
      const freshServer = await startFreshTmuxServer();
      cleanupFreshServer = freshServer.cleanup;
      freshServerSocket = freshServer.socket;

      const paneLookupResult = await tmuxExec(freshServer.socket, ['list-panes', '-F', '#{pane_id}']);
      expect(paneLookupResult.exitCode).toBe(0);

      const paneIds = paneLookupResult.stdout
        .split('\n')
        .map((currentPaneId) => currentPaneId.trim())
        .filter((currentPaneId) => currentPaneId.length > 0);

      expect(paneIds).toHaveLength(1);
      paneId = paneIds[0];

      const artifactPath = await createCaptureArtifactPath();
      await startPipePane(freshServer.socket, paneId, artifactPath);
      pipePaneStarted = true;

      await sleep(PIPE_PANE_SETTLE_MS);

      await sendHexKeys(freshServer.socket, paneId, [
        '70', '72', '69', '6e', '74', '66', '20', '22', '5c', '30', '33', '33', '5b',
        '33', '31', '6d', '58', '5c', '30', '33', '33', '5b', '30', '6d', '22', '0d',
      ]);

      await sleep(PIPE_PANE_SETTLE_MS);
      await stopPipePane(freshServer.socket, paneId);
      pipePaneStarted = false;

      const capturedBytes = await readCapturedBytes(artifactPath);
      expect(countEscapeSeq(capturedBytes, '\u001b[31m')).toBe(1);
      expect(countEscapeSeq(capturedBytes, '\u001b[0m')).toBe(1);
    } catch (error) {
      if (error instanceof Error && error.message === 'tmux not found') {
        test.skip('tmux not found');
        return;
      }

      throw error;
    } finally {
      if (pipePaneStarted && paneId && freshServerSocket) {
        await stopPipePane(freshServerSocket, paneId);
      }
    }
  });
});
