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
import * as tmuxModule from '../utils/tmux';
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

test('layout skipped when 1 pane remains', async () => {
  // Minimal close path: ensure we can control pane count after close
  const mockSpawn = createMockSpawnFn();
  // Sequence to satisfy closeTmuxPane until gating decision
  mockSpawn.results.push(
    { exitCode: 0, stdout: '/usr/bin/tmux\n', stderr: '' }, // path
    { exitCode: 0, stdout: 'tmux 3.3\n', stderr: '' }, // tmux -V
    { exitCode: 0, stdout: '12345\n', stderr: '' }, // list-panes pid
    { exitCode: 0, stdout: '', stderr: '' }, // kill-pane
    { exitCode: 0, stdout: '', stderr: '' }, // (fallback)
    { exitCode: 0, stdout: 'pane-1', stderr: '' }, // list-panes after close -> 1 pane remains
  );
  // No layout should be invoked in this scenario, but if accidentally invoked,
  // provide extra slots to satisfy any potential calls.
  mockSpawn.results.push(
    { exitCode: 0, stdout: '', stderr: '' },
    { exitCode: 0, stdout: '', stderr: '' }
  );
  setSpawnAsyncFn(mockSpawn.fn);
  setStoredTmuxConfigForTests(createTestConfig({ tui_conditional_layout_reapply: true }));

  spyOn(processUtils, 'getProcessChildren').mockReturnValue([]);
  const res = await closeTmuxPane('%1');
  expect(res).toBe(true);
  const selects = countCallsMatching(mockSpawn.calls, (cmd) => cmd.join(' ').includes('select-layout'));
  // Gate should skip layout when only 1 pane remains
  expect(selects).toBe(0);
});

test('layout applied when 3 panes remain', async () => {
  const mockSpawn = createMockSpawnFn();
  // Sequence: getTmuxPath, tmux -V, list-panes pid, kill-pane,
  //           list-panes after close (3 panes → gate passes), select-layout
  mockSpawn.results.push(
    { exitCode: 0, stdout: '/usr/bin/tmux\n', stderr: '' }, // getTmuxPath
    { exitCode: 0, stdout: 'tmux 3.3\n', stderr: '' },      // tmux -V
    { exitCode: 0, stdout: '12345\n', stderr: '' },          // list-panes pid
    { exitCode: 0, stdout: '', stderr: '' },                 // kill-pane
    { exitCode: 0, stdout: 'pane-1\npane-2\npane-3', stderr: '' }, // list-panes after close → 3 panes remain
    { exitCode: 0, stdout: '', stderr: '' },                 // select-layout (applyTmuxLayout)
  );
  setSpawnAsyncFn(mockSpawn.fn);
  setStoredTmuxConfigForTests(createTestConfig({ tui_conditional_layout_reapply: true }));

  const res = await closeTmuxPane('%1');
  expect(res).toBe(true);
  const selects = countCallsMatching(mockSpawn.calls, (cmd) => cmd.join(' ').includes('select-layout'));
  expect(selects).toBeGreaterThanOrEqual(1);
});

test('layout always applied when flag=false', async () => {
  const mockSpawn = createMockSpawnFn();
  mockSpawn.results.push(
    { exitCode: 0, stdout: '/usr/bin/tmux\n', stderr: '' }, // path
    { exitCode: 0, stdout: 'tmux 3.3\n', stderr: '' }, // tmux -V
    { exitCode: 0, stdout: '12345\n', stderr: '' }, // list-panes pid
    { exitCode: 0, stdout: '', stderr: '' }, // kill-pane
    { exitCode: 0, stdout: '', stderr: '' }, // (fallback)
    { exitCode: 0, stdout: 'pane-1', stderr: '' }, // list-panes after close -> 1 pane remains
    { exitCode: 0, stdout: '', stderr: '' }, // applyTmuxLayout internal calls
  );
  setSpawnAsyncFn(mockSpawn.fn);
  setStoredTmuxConfigForTests(createTestConfig({ tui_conditional_layout_reapply: false }));

  const res = await closeTmuxPane('%1');
  expect(res).toBe(true);
  const selects = countCallsMatching(mockSpawn.calls, (cmd) => cmd.join(' ').includes('select-layout'));
  expect(selects).toBeGreaterThanOrEqual(1);
});
