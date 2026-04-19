import * as fs from 'node:fs/promises';

import { tmuxExec } from './fresh-tmux';

function quoteForSingleShellArgument(filePath: string): string {
  return `'${filePath.replaceAll("'", `'\\''`)}'`;
}

export async function startPipePane(
  socket: string,
  paneId: string,
  artifactPath: string,
): Promise<void> {
  const pipeCommand = `cat >> ${quoteForSingleShellArgument(artifactPath)}`;
  const pipePaneResult = await tmuxExec(socket, ['pipe-pane', '-o', '-t', paneId, pipeCommand]);

  if (pipePaneResult.exitCode !== 0) {
    throw new Error(pipePaneResult.stderr.trim() || 'failed to start pipe-pane');
  }
}

export async function stopPipePane(socket: string, paneId: string): Promise<void> {
  const pipePaneResult = await tmuxExec(socket, ['pipe-pane', '-t', paneId]);

  if (pipePaneResult.exitCode !== 0) {
    throw new Error(pipePaneResult.stderr.trim() || 'failed to stop pipe-pane');
  }
}

export async function readCapturedBytes(artifactPath: string): Promise<Buffer> {
  return fs.readFile(artifactPath);
}

export function countEscapeSeq(bytes: Buffer, seq: string): number {
  const needle = Buffer.from(seq);

  if (needle.length === 0) {
    return 0;
  }

  let count = 0;
  let offset = 0;

  while (offset < bytes.length) {
    const matchIndex = bytes.indexOf(needle, offset);

    if (matchIndex === -1) {
      break;
    }

    count += 1;
    offset = matchIndex + needle.length;
  }

  return count;
}
