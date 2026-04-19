type SpawnCall = { command: string[]; options?: Record<string, unknown> };

export function assertCommandSequence(
  calls: SpawnCall[],
  expectedSequence: string[][]
): void {
  for (let i = 0; i < expectedSequence.length; i++) {
    const seq = expectedSequence[i];
    const actual = (calls[i]?.command ?? []).join(' ');
    const ok = seq.every((token) => actual.includes(token));
    if (!ok) {
      throw new Error(`Unexpected command sequence at index ${i}: ${describeCalls(calls)}`);
    }
  }
}

export function findCallContaining(
  calls: SpawnCall[],
  needle: string
): SpawnCall | undefined {
  return calls.find((c) => c.command.join(' ').includes(needle));
}

export function countCallsMatching(
  calls: SpawnCall[],
  predicate: (cmd: string[]) => boolean
): number {
  return calls.filter((c) => predicate(c.command)).length;
}

export function describeCalls(calls: SpawnCall[]): string {
  return calls.map((c, idx) => `${idx + 1}. ${c.command.join(' ')}`).join('\n');
}
