// teams/board.ts — persistent mixture/team state (ra.76, Cline-inspired).
// ~/.ra/teams/<name>/
//   board.json     — task cards with status/model/ms/note (resumable)
//   mailbox.jsonl  — coordinator ⇄ specialist messages (append-only)
//   mission.log    — human-readable activity log (append-only)

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type CardStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface BoardCard {
  agent: string;
  task: string;
  model?: string;
  layer?: number;
  status: CardStatus;
  ms?: number;
  note?: string;
  updatedAt: string;
}

export interface TeamBoardData {
  name: string;
  mission: string;
  status: "active" | "completed" | "partial" | "failed";
  createdAt: string;
  updatedAt: string;
  cards: BoardCard[];
}

export interface MailMessage {
  ts: string;
  from: string;
  to: string;
  text: string;
}

const teamsRoot = (override?: string): string => override ?? join(homedir(), ".ra", "teams");

const now = (): string => new Date().toISOString();

export class TeamBoard {
  readonly dir: string;
  private data: TeamBoardData;

  constructor(name: string, rootOverride?: string) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(name)) throw new Error(`Invalid team name: ${name}`);
    this.dir = join(teamsRoot(rootOverride), name);
    const path = join(this.dir, "board.json");
    if (existsSync(path)) {
      this.data = JSON.parse(readFileSync(path, "utf-8")) as TeamBoardData;
    } else {
      this.data = { name, mission: "", status: "active", createdAt: now(), updatedAt: now(), cards: [] };
      this.flush();
    }
  }

  get board(): Readonly<TeamBoardData> { return this.data; }

  private flush(): void {
    mkdirSync(this.dir, { recursive: true });
    this.data.updatedAt = now();
    writeFileSync(join(this.dir, "board.json"), JSON.stringify(this.data, null, 2));
  }

  /** Start (or restart) a mission; keeps completed cards for resume. */
  begin(mission: string, note = ""): void {
    this.data.mission = mission;
    this.data.status = "active";
    this.logMission(`mission start: ${mission}${note ? ` · ${note}` : ""}`);
    this.flush();
  }

  addCard(agent: string, task: string, model?: string, layer?: number): BoardCard {
    const existing = this.data.cards.find((c) => c.agent === agent && c.status !== "completed");
    if (existing) {
      existing.status = "running";
      existing.model = model ?? existing.model;
      existing.updatedAt = now();
      this.flush();
      return existing;
    }
    const card: BoardCard = { agent, task, model, layer, status: "running", updatedAt: now() };
    this.data.cards.push(card);
    this.flush();
    return card;
  }

  completeCard(agent: string, result: { model?: string; ms?: number; note?: string }): void {
    const card = this.latest(agent);
    if (!card) return;
    card.status = "completed";
    card.model = result.model ?? card.model;
    card.ms = result.ms ?? card.ms;
    card.note = result.note ?? card.note;
    card.updatedAt = now();
    this.flush();
  }

  failCard(agent: string, error: string): void {
    const card = this.latest(agent);
    if (!card) return;
    card.status = "failed";
    card.note = error.slice(0, 300);
    card.updatedAt = now();
    this.flush();
  }

  private latest(agent: string): BoardCard | undefined {
    return [...this.data.cards].reverse().find((c) => c.agent === agent && c.status === "running");
  }

  finish(status: TeamBoardData["status"], note = ""): void {
    this.data.status = status;
    this.logMission(`mission ${status}${note ? ` · ${note}` : ""}`);
    this.flush();
  }

  logMission(line: string): void {
    mkdirSync(this.dir, { recursive: true });
    appendFileSync(join(this.dir, "mission.log"), `${now()} ${line}\n`);
  }

  postMail(from: string, to: string, text: string): void {
    mkdirSync(this.dir, { recursive: true });
    const msg: MailMessage = { ts: now(), from, to, text: text.slice(0, 4000) };
    appendFileSync(join(this.dir, "mailbox.jsonl"), `${JSON.stringify(msg)}\n`);
  }

  readMail(to?: string, limit = 50): MailMessage[] {
    const path = join(this.dir, "mailbox.jsonl");
    if (!existsSync(path)) return [];
    const all = readFileSync(path, "utf-8").split("\n").filter(Boolean)
      .map((l) => { try { return JSON.parse(l) as MailMessage; } catch { return null; } })
      .filter((m): m is MailMessage => m !== null);
    return (to ? all.filter((m) => m.to === to || m.to === "*") : all).slice(-limit);
  }

  /** Cards worth re-running on resume. */
  pendingCards(): BoardCard[] {
    return this.data.cards.filter((c) => c.status === "pending" || c.status === "failed" || c.status === "running");
  }
}

export function listTeamBoards(rootOverride?: string): Array<{ name: string; status: string; mission: string; cards: number; updatedAt: string }> {
  const root = teamsRoot(rootOverride);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      try {
        const b = JSON.parse(readFileSync(join(root, d.name, "board.json"), "utf-8")) as TeamBoardData;
        return { name: d.name, status: b.status, mission: b.mission, cards: b.cards.length, updatedAt: b.updatedAt };
      } catch {
        return { name: d.name, status: "unknown", mission: "", cards: 0, updatedAt: "" };
      }
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Pure renderer for /board, `ra team status`, and the TUI overlay. */
export function formatBoard(board: TeamBoardData, mailCount = 0): string {
  const icon: Record<CardStatus, string> = { pending: "·", running: "◐", completed: "✓", failed: "✗", cancelled: "–" };
  const lines = [
    `BOARD ${board.name} · ${board.status} · ${board.cards.length} cards${mailCount ? ` · ${mailCount} mail` : ""}`,
    board.mission ? `mission: ${board.mission}` : "",
    "",
  ];
  for (const c of board.cards) {
    const meta = [c.layer ? `L${c.layer}` : "", c.model ?? "", c.ms ? `${(c.ms / 1000).toFixed(1)}s` : ""].filter(Boolean).join(" · ");
    lines.push(`  ${icon[c.status]} ${c.agent}${meta ? ` [${meta}]` : ""}`);
    if (c.note) lines.push(`      ${c.note.split("\n")[0].slice(0, 100)}`);
  }
  if (!board.cards.length) lines.push("  (no cards)");
  lines.push("", `updated ${board.updatedAt}`);
  return lines.filter((l) => l !== undefined).join("\n");
}
