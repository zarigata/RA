// Line-based diff — a minimal unified diff for the TUI diff viewer.

export interface DiffLine {
  type: "context" | "add" | "remove";
  text: string;
}

/** Compute a simple line diff between two texts (LCS-based). */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");

  // LCS table.
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "context", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "remove", text: a[i] });
      i++;
    } else {
      out.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ type: "remove", text: a[i++] });
  while (j < m) out.push({ type: "add", text: b[j++] });
  return out;
}

/** Render a diff with +/- prefixes. */
export function formatDiff(lines: DiffLine[]): string {
  return lines
    .map((l) => (l.type === "add" ? `+ ${l.text}` : l.type === "remove" ? `- ${l.text}` : `  ${l.text}`))
    .join("\n");
}

export interface DiffStyle {
  add: (s: string) => string;
  remove: (s: string) => string;
  context: (s: string) => string;
  hunk: (s: string) => string;
}

/** Group diff lines into hunks with @@ headers (context padding, pure). */
export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export function intoHunks(lines: DiffLine[], context = 3): DiffHunk[] {
  const interesting = lines.map((l, i) => (l.type === "context" ? -1 : i)).filter((i) => i >= 0);
  if (!interesting.length) return [];
  const keep = new Set<number>();
  for (const i of interesting) {
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep.add(k);
  }
  const sorted = [...keep].sort((a, b) => a - b);
  const hunks: DiffHunk[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  let oldLn = 1, newLn = 1;
  // walk to compute starting line numbers for the first hunk
  for (let i = 0; i < start; i++) {
    if (lines[i].type === "remove") oldLn++;
    else if (lines[i].type === "add") newLn++;
    else { oldLn++; newLn++; }
  }
  let hOld = oldLn, hNew = newLn;
  const flush = (end: number) => {
    const slice = lines.slice(start, end + 1);
    const oldCount = slice.filter((l) => l.type !== "add").length;
    const newCount = slice.filter((l) => l.type !== "remove").length;
    hunks.push({ header: `@@ -${hOld},${oldCount} +${hNew},${newCount} @@`, lines: slice });
    // advance counters over the flushed hunk
    for (const l of slice) {
      if (l.type === "remove") oldLn++;
      else if (l.type === "add") newLn++;
      else { oldLn++; newLn++; }
    }
  };
  for (const i of sorted) {
    if (i > prev + 1) {
      flush(prev);
      start = i;
      hOld = oldLn; hNew = newLn;
    }
    prev = i;
  }
  flush(prev);
  return hunks;
}

/** ANSI-styled unified diff for the TUI (ra.76 diff viewer). */
export function renderDiffStyled(lines: DiffLine[], style: DiffStyle, maxLines = 400): string[] {
  const out: string[] = [];
  for (const hunk of intoHunks(lines)) {
    if (out.length >= maxLines) { out.push(style.hunk("… diff truncated")); break; }
    out.push(style.hunk(hunk.header));
    for (const l of hunk.lines) {
      if (out.length >= maxLines) { out.push(style.hunk("… diff truncated")); break; }
      if (l.type === "add") out.push(style.add(`+ ${l.text}`));
      else if (l.type === "remove") out.push(style.remove(`- ${l.text}`));
      else out.push(style.context(`  ${l.text}`));
    }
  }
  return out;
}

/** Summary counts for chips and board cards. */
export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  return {
    added: lines.filter((l) => l.type === "add").length,
    removed: lines.filter((l) => l.type === "remove").length,
  };
}
