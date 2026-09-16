/**
 * Reference-only implementation sketch for RA's clock-driven TUI scene.
 * Adapt to RA's actual TUI framework after inspecting the repository.
 */

export type ScenePeriod = "dawn" | "day" | "sunset" | "night";

export interface SceneClockState {
  period: ScenePeriod;
  progress: number; // 0..1 within the current period
  hour: number;
  minute: number;
}

const MINUTES = 24 * 60;

function m(h: number, minute = 0) {
  return h * 60 + minute;
}

function wrapProgress(now: number, start: number, end: number) {
  const length = end >= start ? end - start : MINUTES - start + end;
  const offset = now >= start ? now - start : MINUTES - start + now;
  return Math.max(0, Math.min(1, offset / length));
}

export function sceneClock(date = new Date()): SceneClockState {
  const now = m(date.getHours(), date.getMinutes());

  if (now >= m(5) && now < m(7, 30)) {
    return {
      period: "dawn",
      progress: wrapProgress(now, m(5), m(7, 30)),
      hour: date.getHours(),
      minute: date.getMinutes(),
    };
  }

  if (now >= m(7, 30) && now < m(17)) {
    return {
      period: "day",
      progress: wrapProgress(now, m(7, 30), m(17)),
      hour: date.getHours(),
      minute: date.getMinutes(),
    };
  }

  if (now >= m(17) && now < m(19, 30)) {
    return {
      period: "sunset",
      progress: wrapProgress(now, m(17), m(19, 30)),
      hour: date.getHours(),
      minute: date.getMinutes(),
    };
  }

  return {
    period: "night",
    progress: wrapProgress(now, m(19, 30), m(5)),
    hour: date.getHours(),
    minute: date.getMinutes(),
  };
}

/**
 * Rendering recommendation:
 * Keep renderScene(state, width, runtimeState) pure.
 * Animation ticks mutate only a tiny SceneAnimationState.
 * Snapshot-test each period at widths 40, 80 and 120.
 */
