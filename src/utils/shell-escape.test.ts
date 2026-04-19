import { test, expect } from 'bun:test';
import { shellEscape } from './shell-escape';

test('simple string wrapped in single quotes', () => {
  expect(shellEscape('abc')).toBe("'abc'");
});

test('apostrophe escaped as single-quote sequence', () => {
  expect(shellEscape("a'b")).toBe("'a'\\''b'");
});

test('dollar sign not expanded', () => {
  const result = shellEscape('$(rm -rf /)');
  expect(result).toBe("'$(rm -rf /)'");
});

test('semicolon neutralized', () => {
  expect(shellEscape('a;b')).toBe("'a;b'");
});

test('space preserved as literal', () => {
  expect(shellEscape('hello world')).toBe("'hello world'");
});

test('empty string', () => {
  expect(shellEscape('')).toBe("''");
});
