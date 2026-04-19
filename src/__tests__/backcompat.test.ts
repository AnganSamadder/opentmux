import type { TmuxConfig } from '../config';

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';

import { TmuxConfigSchema } from '../config';
import {
  countCallsMatching,
  findCallContaining,
} from './helpers/command-assertions';
import * as processUtils from '../utils/process';
import {
  closeTmuxPane,
  resetServerCheck,
  resetSpawnAsyncFn,
  resetTmuxPathCache,
  setSpawnAsyncFn,
  setStoredTmuxConfigForTests,
  spawnTmuxPane,
} from '../utils/tmux';

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface SpawnCall {
  command: string[];
  options?: { ignoreOutput?: boolean };
}

interface GoldenFixture {
  spawnCommands: string[][];
  closeCommands: string[][];
}

type MockSpawnFn = (
  command: string[],
  options?: { ignoreOutput?: boolean },
) => Promise<SpawnResult>;

const goldenFixture = JSON.parse(
  readFileSync(new URL('./fixtures/pre-fix-commands.json', import.meta.url), 'utf8'),
) as GoldenFixture;

function createMockSpawnFn(): {
  fn: MockSpawnFn;
  calls: SpawnCall[];
  results: SpawnResult[];
} {
  const calls: SpawnCall[] = [];
  const results: SpawnResult[] = [];

  const fn: MockSpawnFn = async (command, options) => {
    calls.push({ command, options });
    const result = results.shift();
    if (!result) {
      throw new Error(`No more mock results configured for: ${command.join(' ')}`);
    }
    return result;
  };

  return { fn, calls, results };
}

function createDefaultConfig(): TmuxConfig {
  return TmuxConfigSchema.parse({});
}

function normalizeCommand(command: string[]): string[] {
  const [binary = '', ...args] = command;
  const tool = basename(binary);

  if (tool === 'which' || tool === 'where') {
    return ['which', ...args];
  }

  if (tool === 'tmux') {
    return ['tmux', ...args];
  }

  return [tool, ...args];
}

function normalizeCalls(calls: SpawnCall[]): string[][] {
  return calls.map(({ command }) => normalizeCommand(command));
}

const originalEnv = process.env.TMUX;
let mockSpawnData: ReturnType<typeof createMockSpawnFn>;

beforeEach(() => {
  process.env.TMUX = '/tmp/tmux-1000/default,12345,0';
  resetServerCheck();
  resetTmuxPathCache();
  resetSpawnAsyncFn();
  setStoredTmuxConfigForTests(null);

  mockSpawnData = createMockSpawnFn();
  setSpawnAsyncFn(mockSpawnData.fn);

  spyOn(processUtils, 'getProcessChildren').mockReturnValue([]);
  spyOn(processUtils, 'safeKill').mockReturnValue(true);
  spyOn(processUtils, 'waitForProcessExit').mockResolvedValue(true);
  spyOn(processUtils, 'getProcessCommand').mockReturnValue('opencode attach');
});

afterEach(() => {
  if (originalEnv) {
    process.env.TMUX = originalEnv;
  } else {
    delete process.env.TMUX;
  }

  setStoredTmuxConfigForTests(null);
  resetSpawnAsyncFn();
  mock.restore();
});

test('default config spawn sequence matches golden fixture', async () => {
  mockSpawnData.results.push(
    { exitCode: 0, stdout: '/usr/bin/tmux\n', stderr: '' },
    { exitCode: 0, stdout: 'tmux 3.3\n', stderr: '' },
    { exitCode: 0, stdout: '%5\n', stderr: '' },
    { exitCode: 0, stdout: '', stderr: '' },
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(async () => new Response('ok', { status: 200 })) as unknown as typeof fetch;

  try {
    const result = await spawnTmuxPane(
      'session-default',
      'Default Config Regression',
      createDefaultConfig(),
      'http://localhost:4096',
    );

    expect(result).toEqual({ success: true, paneId: '%5' });
    expect(findCallContaining(mockSpawnData.calls, 'split-window')).toBeDefined();
    expect(countCallsMatching(mockSpawnData.calls, () => true)).toBe(goldenFixture.spawnCommands.length);
    expect(normalizeCalls(mockSpawnData.calls)).toEqual(goldenFixture.spawnCommands);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('default config close sequence matches golden fixture when two panes remain', async () => {
  mockSpawnData.results.push(
    { exitCode: 0, stdout: '/usr/bin/tmux\n', stderr: '' },
    { exitCode: 0, stdout: 'tmux 3.3\n', stderr: '' },
    { exitCode: 0, stdout: '12345\n', stderr: '' },
    { exitCode: 0, stdout: '', stderr: '' },
    { exitCode: 0, stdout: '%1\n%2\n', stderr: '' },
    { exitCode: 0, stdout: '200 50\n', stderr: '' },
    { exitCode: 0, stdout: '%1\n', stderr: '' },
    { exitCode: 0, stdout: '%1\n%2\n', stderr: '' },
    { exitCode: 0, stdout: '', stderr: '' },
    { exitCode: 0, stdout: '', stderr: '' },
  );

  setStoredTmuxConfigForTests(createDefaultConfig());

  const result = await closeTmuxPane('%1');

  expect(result).toBe(true);
  expect(findCallContaining(mockSpawnData.calls, 'kill-pane')).toBeDefined();
  expect(countCallsMatching(mockSpawnData.calls, () => true)).toBe(goldenFixture.closeCommands.length);
  expect(normalizeCalls(mockSpawnData.calls)).toEqual(goldenFixture.closeCommands);
});
