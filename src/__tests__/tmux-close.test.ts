import { test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import type { TmuxConfig } from '../config';
import {
  closeTmuxPane,
  resetSpawnAsyncFn,
  resetTmuxPathCache,
  setSpawnAsyncFn,
  setStoredTmuxConfigForTests,
} from '../utils/tmux';
import * as processUtils from '../utils/process';
import {
  countCallsMatching,
  findCallContaining,
} from './helpers/command-assertions';

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

type MockSpawnFn = (
  command: string[],
  options?: { ignoreOutput?: boolean },
) => Promise<SpawnResult>;

function createMockSpawnFn() {
  const calls: Array<{ command: string[]; options?: { ignoreOutput?: boolean } }> = [];
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

function createTestConfig(overrides: Partial<TmuxConfig> = {}): TmuxConfig {
  return {
    enabled: true,
    layout: 'main-vertical',
    main_pane_size: 60,
    spawn_delay_ms: 300,
    max_retry_attempts: 2,
    layout_debounce_ms: 150,
    max_agents_per_column: 3,
    tui_graceful_shutdown: true,
    tui_conditional_layout_reapply: true,
    tui_silent_refresh_after_close: true,
    tui_sh_exec_wrapper: false,
    tui_explicit_mode_reset: false,
    tui_ghostty_hardening: false,
    reaper_enabled: true,
    reaper_interval_ms: 30000,
    reaper_min_zombie_checks: 3,
    reaper_grace_period_ms: 5000,
    reaper_auto_self_destruct: true,
    reaper_self_destruct_timeout_ms: 600000,
    rotate_port: false,
    max_ports: 10,
    ...overrides,
  };
}

function queueCommonCloseResults(mockSpawnData: ReturnType<typeof createMockSpawnFn>): void {
  mockSpawnData.results.push(
    { exitCode: 0, stdout: '/usr/bin/tmux\n', stderr: '' },
    { exitCode: 0, stdout: 'tmux 3.3\n', stderr: '' },
    { exitCode: 0, stdout: '12345\n', stderr: '' },
    { exitCode: 0, stdout: '', stderr: '' },
    { exitCode: 0, stdout: '', stderr: '' },
  );
}

let mockSpawnData: ReturnType<typeof createMockSpawnFn>;

beforeEach(() => {
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
  setStoredTmuxConfigForTests(null);
  resetSpawnAsyncFn();
  mock.restore();
});

test('send-keys C-c before SIGTERM', async () => {
  queueCommonCloseResults(mockSpawnData);
  setStoredTmuxConfigForTests(createTestConfig({ tui_graceful_shutdown: true }));

  spyOn(processUtils, 'getProcessChildren').mockReturnValue([9999]);
  const safeKillSpy = spyOn(processUtils, 'safeKill');
  const waitSpy = spyOn(processUtils, 'waitForProcessExit')
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(true);

  const result = await closeTmuxPane('%1');

  expect(result).toBe(true);
  const sendKeysCall = findCallContaining(mockSpawnData.calls, 'send-keys');
  expect(sendKeysCall).toBeDefined();
  expect(sendKeysCall?.command).toEqual([
    '/usr/bin/tmux',
    'send-keys',
    '-t',
    '%1',
    'C-c',
    '',
  ]);
  expect(waitSpy).toHaveBeenNthCalledWith(1, 9999, 5000);
  expect(waitSpy).toHaveBeenNthCalledWith(2, 9999, 1000);
  expect(safeKillSpy).toHaveBeenCalledWith(9999, 'SIGTERM');
  expect(safeKillSpy).not.toHaveBeenCalledWith(9999, 'SIGKILL');
});

test('clean exit skips SIGKILL', async () => {
  queueCommonCloseResults(mockSpawnData);
  setStoredTmuxConfigForTests(createTestConfig({ tui_graceful_shutdown: true }));

  spyOn(processUtils, 'getProcessChildren').mockReturnValue([9999]);
  const safeKillSpy = spyOn(processUtils, 'safeKill');
  spyOn(processUtils, 'waitForProcessExit').mockResolvedValue(true);

  const result = await closeTmuxPane('%1');

  expect(result).toBe(true);
  expect(findCallContaining(mockSpawnData.calls, 'send-keys')).toBeDefined();
  expect(countCallsMatching(mockSpawnData.calls, (cmd) => cmd.includes('kill-pane'))).toBe(1);
  expect(safeKillSpy).not.toHaveBeenCalledWith(9999, 'SIGTERM');
  expect(safeKillSpy).not.toHaveBeenCalledWith(9999, 'SIGKILL');
});

test('backward compat with flag=false', async () => {
  queueCommonCloseResults(mockSpawnData);
  setStoredTmuxConfigForTests(createTestConfig({ tui_graceful_shutdown: false }));

  spyOn(processUtils, 'getProcessChildren').mockReturnValue([9999]);
  const safeKillSpy = spyOn(processUtils, 'safeKill');
  const waitSpy = spyOn(processUtils, 'waitForProcessExit').mockResolvedValue(false);

  const result = await closeTmuxPane('%1');

  expect(result).toBe(true);
  expect(findCallContaining(mockSpawnData.calls, 'send-keys')).toBeUndefined();
  expect(waitSpy).toHaveBeenCalledTimes(1);
  expect(waitSpy).toHaveBeenCalledWith(9999, 2000);
  expect(safeKillSpy.mock.calls).toEqual([
    [9999, 'SIGTERM'],
    [9999, 'SIGKILL'],
  ]);
});
