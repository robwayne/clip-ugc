// Timestamp parsing and formatting helpers.
//
// The UI accepts flexible timestamp strings:
//   "ss"            -> seconds
//   "mm:ss"         -> minutes:seconds
//   "hh:mm:ss"      -> hours:minutes:seconds
// Any part may include a fractional component, e.g. "01:23.5" or "00:00:09.250".

/** Parse a timestamp string into seconds. Returns null if it is not valid. */
export function parseTimestamp(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;

  const parts = trimmed.split(':');
  if (parts.length > 3) return null;

  let seconds = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    // Only the last (seconds) part may contain a decimal point.
    const isLast = i === parts.length - 1;
    const numberPattern = isLast ? /^\d*\.?\d+$|^\d+\.?\d*$/ : /^\d+$/;
    if (!numberPattern.test(part)) return null;
    const value = Number(part);
    if (Number.isNaN(value)) return null;
    if (!isLast && value >= 60) return null; // minutes/hours segments < 60 when combined
    seconds = seconds * 60 + value;
  }

  if (seconds < 0 || !Number.isFinite(seconds)) return null;
  return seconds;
}

/** Format seconds as mm:ss or hh:mm:ss, dropping fractional part by default. */
export function formatTimestamp(totalSeconds: number, withMillis = false): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) totalSeconds = 0;

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secondsFloat = totalSeconds % 60;
  const seconds = Math.floor(secondsFloat);
  const millis = Math.round((secondsFloat - seconds) * 1000);

  const pad = (n: number, len = 2) => String(n).padStart(len, '0');

  let base: string;
  if (hours > 0) {
    base = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  } else {
    base = `${pad(minutes)}:${pad(seconds)}`;
  }

  if (withMillis) {
    return `${base}.${pad(millis, 3)}`;
  }
  return base;
}

/** Human-friendly duration like "1m 04s" or "9s". */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) totalSeconds = 0;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.round(totalSeconds % 60);
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

/** Format a file size in bytes as a readable string. */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
