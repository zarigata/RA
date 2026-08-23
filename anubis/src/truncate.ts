// src/truncate.ts — dcp dynamic context pruning (pure, testable)

export function truncate(text: string, threshold = 20000, head = 2000, tail = 1000): string {
  if (text.length <= threshold) return text;
  // scale head/tail to the threshold so truncation always reduces size
  const h = Math.min(head, Math.floor(threshold / 4));
  const t = Math.min(tail, Math.floor(threshold / 4));
  if (h + t >= text.length) return text;
  return (
    text.slice(0, h) +
    `\n\n...[truncated by dcp: ${text.length - h - t} chars elided]...\n\n` +
    text.slice(text.length - t)
  );
}

export function truncateJson(value: unknown, threshold = 20000): string {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return truncate(s, threshold);
}
