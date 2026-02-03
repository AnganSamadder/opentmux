import { test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { ZombieReaper } from '../zombie-reaper';
import * as processUtils from '../utils/process';

// Mock dependencies
const mockFetch = mock();
globalThis.fetch = mockFetch as any;

const DEFAULT_OPTIONS = {
  enabled: true,
  intervalMs: 100,
  minZombieChecks: 3,
  gracePeriodMs: 5000,
};

let reaper: ZombieReaper;

beforeEach(() => {
  mockFetch.mockReset();
  // Return a NEW response every time
  mockFetch.mockImplementation(async (url: string) => new Response(JSON.stringify({ data: [] }), { status: 200 }));
  
  // Default mocks
  spyOn(processUtils, 'findProcessIds').mockReturnValue([]);
  spyOn(processUtils, 'getProcessCommand').mockReturnValue('opencode attach --session ses_123');
  spyOn(processUtils, 'safeKill').mockReturnValue(true);
  
  reaper = new ZombieReaper('http://localhost:4096', DEFAULT_OPTIONS);
});

afterEach(() => {
  reaper.stop();
  mock.restore();
});

test('findAllAttachProcesses parses session IDs', async () => {
  spyOn(processUtils, 'findProcessIds').mockReturnValue([100, 101]);
  spyOn(processUtils, 'getProcessCommand').mockImplementation((pid) => {
    if (pid === 100) return 'opencode attach http://localhost:4096 --session ses_active';
    if (pid === 101) return 'opencode attach http://localhost:4096 --session ses_zombie';
    return null;
  });

  const processes = await reaper.findAllAttachProcesses();
  
  expect(processes.length).toBe(2);
  expect(processes[0]).toEqual({ 
    pid: 100, 
    sessionId: 'ses_active', 
    targetUrl: 'http://localhost:4096',
    command: expect.stringContaining('ses_active') 
  });
  expect(processes[1]).toEqual({ 
    pid: 101, 
    sessionId: 'ses_zombie', 
    targetUrl: 'http://localhost:4096',
    command: expect.stringContaining('ses_zombie') 
  });
});

test('scanOnce filters by serverUrl', async () => {
  // Reaper configured for 4096
  reaper = new ZombieReaper('http://localhost:4096', DEFAULT_OPTIONS);
  
  spyOn(processUtils, 'findProcessIds').mockReturnValue([200, 201]);
  spyOn(processUtils, 'getProcessCommand').mockImplementation((pid) => {
    if (pid === 200) return 'opencode attach http://localhost:4096 --session ses_mine';
    if (pid === 201) return 'opencode attach http://localhost:4097 --session ses_other';
    return null;
  });

  // Mock server 4096 to have NO sessions (so ses_mine is zombie)
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes('4096')) return new Response(JSON.stringify({ data: {} }), { status: 200 });
    return new Response(JSON.stringify({ data: { ses_other: {} } }), { status: 200 }); // 4097 has session
  });

  // Spy on kill
  const safeKillSpy = spyOn(processUtils, 'safeKill');
  
  // Mock Date.now to force kill condition
  spyOn(Date, 'now').mockReturnValue(1000000);
  
  // Scan 1
  await reaper.scanOnce();
  
  // Should only track 200 (mine), not 201 (other)
  // But wait, it needs 3 checks to kill.
  // We can't check internal map easily without exposing it, but we can verify calls.
  
  // ... (Test logic simplified: verifying filtering is hard without checking internal state or mocking fetch calls strictly)
  // Let's verify fetch is ONLY called for 4096
  expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('4096'), expect.anything());
  expect(mockFetch).not.toHaveBeenCalledWith(expect.stringContaining('4097'), expect.anything());
});

test('classifyProcess identifies active sessions', async () => {
  mockFetch.mockImplementation(async () => new Response(JSON.stringify({
    data: { 'ses_active': { type: 'idle' } }
  }), { status: 200 }));

  const status = await reaper.classifyProcess('ses_active');
  expect(status).toBe('active');
});

test('classifyProcess identifies zombie sessions', async () => {
  mockFetch.mockImplementation(async () => new Response(JSON.stringify({
    data: { 'ses_other': { type: 'idle' } }
  }), { status: 200 }));

  const status = await reaper.classifyProcess('ses_zombie');
  expect(status).toBe('zombie');
});

test('classifyProcess returns unknown if server fails', async () => {
  mockFetch.mockRejectedValue(new Error('Network error'));

  const status = await reaper.classifyProcess('ses_any');
  expect(status).toBe('unknown');
});

test('shouldKill requires consecutive checks and grace period', () => {
  const fastReaper = new ZombieReaper('url', { ...DEFAULT_OPTIONS, gracePeriodMs: 0 });
  const pid = 123;
  
  fastReaper.markAsZombie(pid);
  expect(fastReaper.shouldKill(pid)).toBe(false);
  
  fastReaper.markAsZombie(pid);
  expect(fastReaper.shouldKill(pid)).toBe(false);
  
  fastReaper.markAsZombie(pid);
  expect(fastReaper.shouldKill(pid)).toBe(true);
});

test('grace period prevents killing new processes', async () => {
  const pid = 999;
  
  reaper.markAsZombie(pid);
  reaper.markAsZombie(pid);
  reaper.markAsZombie(pid);
  
  expect(reaper.shouldKill(pid)).toBe(false);
});

test('scanOnce kills confirmed zombies', async () => {
  // Setup: 1 zombie process
  spyOn(processUtils, 'findProcessIds').mockReturnValue([500]);
  spyOn(processUtils, 'getProcessCommand').mockReturnValue('opencode attach http://localhost:4096 --session ses_zombie');
  
  // Server says no sessions
  mockFetch.mockImplementation(async () => new Response(JSON.stringify({ data: {} }), { status: 200 }));
  
  const safeKillSpy = spyOn(processUtils, 'safeKill');
  
  // Mock Date.now
  let time = 1000000;
  spyOn(Date, 'now').mockImplementation(() => time);
  
  // 1st scan
  await reaper.scanOnce();
  expect(safeKillSpy).not.toHaveBeenCalled();
  
  // 2nd scan
  await reaper.scanOnce();
  expect(safeKillSpy).not.toHaveBeenCalled();
  
  // 3rd scan
  await reaper.scanOnce();
  expect(safeKillSpy).not.toHaveBeenCalled();
  
  // Advance time > 5s
  time += 6000;
  
  // 4th scan
  await reaper.scanOnce();
  expect(safeKillSpy).toHaveBeenCalledWith(500, 'SIGTERM');
});

test('reapAll (manual CLI) kills zombies immediately without grace period', async () => {
  spyOn(processUtils, 'findProcessIds').mockReturnValue([800, 801]);
  spyOn(processUtils, 'getProcessCommand').mockImplementation((pid) => {
    if (pid === 800) return 'opencode attach http://localhost:4096 --session ses_zombie';
    if (pid === 801) return 'opencode attach http://localhost:4097 --session ses_active';
    return null;
  });

  // Mock server responses based on URL
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes('4096')) return new Response(JSON.stringify({ data: {} }), { status: 200 }); // 4096: No sessions -> ses_zombie is zombie
    if (url.includes('4097')) return new Response(JSON.stringify({ data: { ses_active: {} } }), { status: 200 }); // 4097: Has session -> active
    return new Response(JSON.stringify({ data: {} }), { status: 200 });
  });
  
  // Spy on process.kill since reapAll uses forceKill (direct process.kill) instead of safeKill
  const killSpy = spyOn(process, 'kill');

  await ZombieReaper.reapAll();

  // Should kill 800 (zombie)
  expect(killSpy).toHaveBeenCalledWith(800, 'SIGTERM');
  
  // Should NOT kill 801 (active)
  expect(killSpy).not.toHaveBeenCalledWith(801, 'SIGTERM');
});
