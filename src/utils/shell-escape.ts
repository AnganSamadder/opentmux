export function shellEscape(value: string): string {
  // POSIX-safe single-quoted string
  // Replace every ' with the sequence: '\''
  return "'" + value.replace(/'/g, "'\\''") + "'";
}
