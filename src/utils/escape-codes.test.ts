import { test, expect } from 'bun:test';
import {
  modeReset,
  countMode,
  scanLeakedModes,
  MODE_RESET_ALL,
  DEC_MODES,
} from './escape-codes';

test('modeReset concatenates individual resets (no combined semicolon)', () => {
  const result = modeReset(['2004', '1049']);
  expect(result).toBe("\x1b[?2004l\x1b[?1049l");
});

test('modeReset empty returns empty string', () => {
  expect(modeReset([])).toBe('');
});

test('countMode counts enable sequences (true)', () => {
  const bytes = Buffer.from("\x1b[?2004h\x1b[?2004h");
  const count = countMode(bytes, '2004', true);
  expect(count).toBe(2);
});

test('countMode counts disable sequences (false)', () => {
  const bytes = Buffer.from("\x1b[?2004l");
  const count = countMode(bytes, '2004', false);
  expect(count).toBe(1);
});

test('countMode balanced when enable present but not disable', () => {
  const bytes = Buffer.from("\x1b[?2004h");
  const count = countMode(bytes, '2004', false);
  expect(count).toBe(0);
});

test('scanLeakedModes detects leaks for multiple modes', () => {
  const bytes = Buffer.from("\x1b[?2004h\x1b[?1049h");
  const results = scanLeakedModes(bytes);
  const m2004 = results.find((r) => r.mode === '2004');
  const m1049 = results.find((r) => r.mode === '1049');
  expect(m2004).toBeDefined();
  expect(m1049).toBeDefined();
  expect(m2004?.leaked).toBe(true);
  expect(m1049?.leaked).toBe(true);
});

test('scanLeakedModes balances when both enabled and disabled for a mode', () => {
  const bytes = Buffer.from("\x1b[?2004h\x1b[?2004l");
  const results = scanLeakedModes(bytes);
  const m2004 = results.find((r) => r.mode === '2004');
  expect(m2004).toBeDefined();
  expect(m2004?.leaked).toBe(false);
});

test('MODE_RESET_ALL contains known resets', () => {
  expect(MODE_RESET_ALL).toContain("\x1b[?1000l");
  expect(MODE_RESET_ALL).toContain("\x1b[?2004l");
});
