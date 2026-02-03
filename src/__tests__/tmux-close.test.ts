import { test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import {
  closeTmuxPane,
  setSpawnAsyncFn,
  resetSpawnAsyncFn,
  resetTmuxPathCache,
} from '../utils/tmux';
import * as processUtils from '../utils/process';

// Mock spawnAsync
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
      // Default success
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    return result;
  };

  return { fn, calls, results };
}

let mockSpawnData: ReturnType<typeof createMockSpawnFn>;

beforeEach(() => {
  resetTmuxPathCache();
  resetSpawnAsyncFn();
  mockSpawnData = createMockSpawnFn();
  setSpawnAsyncFn(mockSpawnData.fn);
  
  // Mock process utils
  spyOn(processUtils, 'getProcessChildren').mockReturnValue([]);
  spyOn(processUtils, 'safeKill').mockReturnValue(true);
  spyOn(processUtils, 'waitForProcessExit').mockResolvedValue(true);
  spyOn(processUtils, 'getProcessCommand').mockReturnValue('opencode attach');
});

afterEach(() => {
  resetSpawnAsyncFn();
  mock.restore();
});

test('closeTmuxPane kills attach process before closing pane', async () => {
  // Setup mocks
  mockSpawnData.results.push(
    { exitCode: 0, stdout: '/usr/bin/tmux\n', stderr: '' }, // find tmux
    { exitCode: 0, stdout: 'tmux 3.3\n', stderr: '' }, // verify tmux
    { exitCode: 0, stdout: '12345\n', stderr: '' }, // list-panes (get PID)
    { exitCode: 0, stdout: '', stderr: '' }, // kill-pane
    { exitCode: 0, stdout: '', stderr: '' }, // layout
  );

  spyOn(processUtils, 'getProcessChildren').mockReturnValue([9999]);
  const safeKillSpy = spyOn(processUtils, 'safeKill');
  const waitSpy = spyOn(processUtils, 'waitForProcessExit');

  const result = await closeTmuxPane('%1');

  expect(result).toBe(true);
  
  // Verify PID flow
  expect(processUtils.getProcessChildren).toHaveBeenCalledWith(12345); // Shell PID
  expect(safeKillSpy).toHaveBeenCalledWith(9999, 'SIGTERM');
  expect(waitSpy).toHaveBeenCalledWith(9999, 2000);
  
  // Verify tmux flow
  const killPaneCall = mockSpawnData.calls.find(c => c.command.includes('kill-pane'));
  expect(killPaneCall).toBeDefined();
});

test('closeTmuxPane sends SIGKILL if SIGTERM fails', async () => {
  mockSpawnData.results.push(
    { exitCode: 0, stdout: '/usr/bin/tmux\n', stderr: '' },
    { exitCode: 0, stdout: 'tmux 3.3\n', stderr: '' },
    { exitCode: 0, stdout: '12345\n', stderr: '' }, // list-panes
    { exitCode: 0, stdout: '', stderr: '' }, // kill-pane
    { exitCode: 0, stdout: '', stderr: '' }, // layout
  );

  spyOn(processUtils, 'getProcessChildren').mockReturnValue([9999]);
  spyOn(processUtils, 'waitForProcessExit').mockResolvedValue(false); // Timed out
  const safeKillSpy = spyOn(processUtils, 'safeKill');

  await closeTmuxPane('%1');

  expect(safeKillSpy).toHaveBeenCalledWith(9999, 'SIGTERM');
  expect(safeKillSpy).toHaveBeenCalledWith(9999, 'SIGKILL');
});

test('closeTmuxPane handles case where no attach process found', async () => {
  mockSpawnData.results.push(
    { exitCode: 0, stdout: '/usr/bin/tmux\n', stderr: '' },
    { exitCode: 0, stdout: 'tmux 3.3\n', stderr: '' },
    { exitCode: 0, stdout: '12345\n', stderr: '' }, // list-panes
    { exitCode: 0, stdout: '', stderr: '' }, // kill-pane
    { exitCode: 0, stdout: '', stderr: '' }, // layout
  );

  spyOn(processUtils, 'getProcessChildren').mockReturnValue([]); // No children
  const safeKillSpy = spyOn(processUtils, 'safeKill');

  await closeTmuxPane('%1');

  expect(safeKillSpy).not.toHaveBeenCalled();
});
