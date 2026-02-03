import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { spawn } from 'node:child_process';
import {
  isProcessAlive,
  getProcessCommand,
  getProcessChildren,
  safeKill,
  waitForProcessExit,
  findProcessIds
} from '../utils/process';

describe('Process Utilities', () => {
  let childPid: number;
  let childProcess: any;

  beforeAll(() => {
    // Spawn a long-running process (sleep) for testing
    // Use a unique argument to identify it easily
    childProcess = spawn('sleep', ['103']);
    childPid = childProcess.pid;
    console.log('Spawned test process:', childPid);
  });

  afterAll(() => {
    try {
      if (childProcess) childProcess.kill('SIGKILL');
    } catch {}
  });

  test('isProcessAlive returns true for running process', () => {
    expect(isProcessAlive(childPid)).toBe(true);
  });

  test('isProcessAlive returns false for non-existent process', () => {
    expect(isProcessAlive(99999999)).toBe(false);
  });

  test('getProcessCommand returns command string', () => {
    const cmd = getProcessCommand(childPid);
    expect(cmd).toBeDefined();
    expect(cmd).toContain('sleep');
  });

  test('getProcessChildren returns array of children', () => {
    const children = getProcessChildren(process.pid);
    expect(Array.isArray(children)).toBe(true);
  });

  test('safeKill sends signal', () => {
    const proc = spawn('sleep', ['50']);
    const pid = proc.pid as number;
    expect(isProcessAlive(pid)).toBe(true);
    
    const result = safeKill(pid, 'SIGTERM');
    expect(result).toBe(true);
    
    proc.kill('SIGKILL');
  });

  test('waitForProcessExit waits for process to die', async () => {
    const proc = spawn('sleep', ['0.1']);
    const pid = proc.pid as number;
    
    const start = Date.now();
    const exited = await waitForProcessExit(pid, 1000);
    const end = Date.now();
    
    expect(exited).toBe(true);
    expect(isProcessAlive(pid)).toBe(false);
    expect(end - start).toBeLessThan(1100);
  });
  
  test('findProcessIds returns matching pids', () => {
    const pids = findProcessIds('sleep 103');
    expect(pids).toContain(childPid);
  });
});
