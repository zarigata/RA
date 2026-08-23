// src/intent.ts — horus prompt intent detection (pure, testable)

export type Intent =
  | "code"
  | "plan"
  | "review"
  | "debug"
  | "question"
  | "docs"
  | "unknown";

const RULES: Array<{ intent: Intent; re: RegExp }> = [
  // Specific intents first so generic code verbs don't shadow them.
  { intent: "review", re: /\b(review|audit|critique|inspect)\b/i },
  { intent: "debug", re: /\b(debug|error|crash|fail|broken|fix|bug|buggy|trace|exception|stacktrace)\b/i },
  { intent: "docs", re: /\b(document|docs|readme|comment|explain the code)\b/i },
  { intent: "plan", re: /\b(plan|design|architecture|approach|strategy|roadmap)\b/i },
  { intent: "code", re: /\b(implement|write|create|build|add|refactor|change|update|generate)\b/i },
  { intent: "question", re: /\b(what|why|how|when|where|is|are|does|can|should)\b/i },
];

export function detectIntent(text: string): Intent {
  const t = text.trim();
  if (!t) return "unknown";
  for (const { intent, re } of RULES) {
    if (re.test(t)) return intent;
  }
  return "unknown";
}

export const ENHANCEMENTS: Record<Intent, string> = {
  code: `
[horus enhancement]
- State target language/framework if known.
- List acceptance criteria the result must meet.
- Specify constraints: performance, security, compatibility.
- After implementing, verify with tests or a syntax check.
- Match existing code style. Do not add comments unless the codebase uses them.
- Report what changed and how it was verified.`,
  plan: `
[horus enhancement]
- Break into ordered steps, each with a verification.
- Identify risks, edge cases, and dependencies.
- Estimate effort and cost.`,
  review: `
[horus enhancement]
- Review for security, performance, correctness, maintainability.
- For each finding: location, problem, evidence, suggested fix, severity.
- Give a verdict: safe to ship or not.`,
  debug: `
[horus enhancement]
- Find root cause, not symptoms.
- Reproduce first, then hypothesize, then verify.
- Report evidence for each hypothesis.`,
  docs: `
[horus enhancement]
- Clear, concise, accurate to the code.
- Match the project's doc style.
- Include code examples where helpful.`,
  question: `
[horus enhancement]
- Answer directly first, then explain.
- If uncertain, say so and give a confidence level.`,
  unknown: `
[horus enhancement]
- If this is a coding task, state the language/framework and acceptance criteria.
- If a plan, break into steps with verification.
- If a review, use the review format.`,
};

export function enhancePrompt(text: string): string {
  if (!text.trim()) return text;
  const intent = detectIntent(text);
  return text + ENHANCEMENTS[intent];
}

export function isAmbiguousCode(text: string): boolean {
  return (
    detectIntent(text) === "code" &&
    !/\b(python|javascript|typescript|ts|js|rust|go|java|c\+\+|ruby|php|horus|kotlin|react|node|django|flask|bun|deno)\b/i.test(
      text,
    )
  );
}
