// DEC private mode numbers (as strings, not enums)
export const DEC_MODES = {
  MOUSE_BASIC: '1000',
  MOUSE_BUTTON: '1002', 
  MOUSE_ANY: '1003',
  MOUSE_SGR: '1006',
  ALT_SCREEN: '1049',
  BRACKETED_PASTE: '2004',
  APP_CURSOR: '1',
  FOCUS_EVENTS: '1004',
} as const;

// Returns individual reset sequences concatenated: "\x1b[?2004l\x1b[?1049l"
// NOT combined ("\x1b[?2004;1049l") — some terminals only honor first param
export function modeReset(modes: string[]): string {
  return modes.map((m) => `\x1b[?${m}l`).join('');
}

// Precomputed full reset for all DEC_MODES values
export const MODE_RESET_ALL: string = (() => {
  const modes = Object.values(DEC_MODES) as string[];
  return modeReset(modes);
})();

// Counts "\x1b[?<mode>h" (enable=true) or "\x1b[?<mode>l" (enable=false) in bytes
// Use Buffer.indexOf loop, NOT regex
export function countMode(bytes: Buffer, mode: string, enable: boolean): number {
  const seq = `\x1b[?${mode}${enable ? 'h' : 'l'}`;
  const needle = Buffer.from(seq);
  if (needle.length === 0) return 0;

  let count = 0;
  let offset = 0;
  while (offset <= bytes.length - needle.length) {
    const idx = bytes.indexOf(needle, offset);
    if (idx === -1) break;
    count += 1;
    offset = idx + needle.length;
  }
  return count;
}

// Returns which modes are unbalanced (enableCount !== disableCount)
export function scanLeakedModes(bytes: Buffer): Array<{
  mode: string;
  enableCount: number;
  disableCount: number;
  leaked: boolean;  // true when enableCount !== disableCount
}> {
  const results: Array<{
    mode: string;
    enableCount: number;
    disableCount: number;
    leaked: boolean;
  }> = [];

  const modes = Object.values(DEC_MODES) as string[];
  for (const m of modes) {
    const enable = countMode(bytes, m, true);
    const disable = countMode(bytes, m, false);
    const leaked = enable !== disable;
    results.push({ mode: m, enableCount: enable, disableCount: disable, leaked });
  }

  return results;
}
