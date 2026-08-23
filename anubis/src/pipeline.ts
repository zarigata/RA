// src/pipeline.ts — sequential pipeline validation (pure, testable)

export const ORCHESTRATOR = "anubis";

export const DEFAULT_PIPELINE_STAGES = [
  "thoth",    // Reasoning / Planning
  "ptah",     // Implementation
  "maat",     // Diagnosis / Bug Hunting
  "sekhmet",  // Adversarial Review
  "ptah",     // Fix
  "sekhmet",  // Final Adversarial Check
  "seshat",   // Final Documentation
];

export function validateStages(stages: string[]): boolean {
  if (stages.length === 0) return false;
  // orchestrator may not appear as a stage (prevents infinite loop)
  if (stages.includes(ORCHESTRATOR)) return false;
  return true;
}

export interface PipelinePlan {
  task: string;
  stages: string[];
}

export function planPipeline(task: string, stages: string[] = DEFAULT_PIPELINE_STAGES): PipelinePlan | null {
  if (!validateStages(stages)) return null;
  return { task, stages };
}
