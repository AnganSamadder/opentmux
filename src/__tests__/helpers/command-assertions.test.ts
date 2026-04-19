import {
  assertCommandSequence,
  findCallContaining,
  countCallsMatching,
  describeCalls,
} from './command-assertions';

test('assertCommandSequence passes with matching calls', () => {
  expect(() =>
    assertCommandSequence(
      [
        { command: ['tmux', 'split-window', '-h'] },
        { command: ['tmux', 'select-pane'] },
      ],
      [['split-window', '-h'], ['select-pane']]
    )
  ).not.toThrow();
});

test('assertCommandSequence throws on mismatch', () => {
  expect(() =>
    assertCommandSequence(
      [{ command: ['tmux', 'kill-pane'] }],
      [['split-window']]
    )
  ).toThrow();
});

test('findCallContaining finds correct call', () => {
  const call = findCallContaining(
    [
      { command: ['tmux', 'split-window'] },
      { command: ['tmux', 'kill-pane'] },
    ],
    'kill-pane'
  );
  expect(call?.command).toContain('kill-pane');
});

test('countCallsMatching counts correctly', () => {
  const n = countCallsMatching(
    [
      { command: ['tmux', 'kill-pane', '-t', 'a'] },
      { command: ['tmux', 'kill-pane', '-t', 'b'] },
      { command: ['tmux', 'split-window'] },
    ],
    (cmd) => cmd.includes('kill-pane')
  );
  expect(n).toBe(2);
});

test('describeCalls formats output', () => {
  const desc = describeCalls([
    { command: ['tmux', 'split-window'] },
    { command: ['tmux', 'kill-pane'] },
  ]);
  expect(desc).toContain('1.');
  expect(desc).toContain('split-window');
});
