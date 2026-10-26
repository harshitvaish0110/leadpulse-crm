/**
 * LeadPulse — Per-provider circuit breaker (in memory, per process).
 *
 * 3 failures within 5 minutes open the breaker for 10 minutes; then one trial
 * call is let through (half-open). Success closes it, failure re-opens it.
 * trip() opens it for a given time instead, for a provider that said when it
 * will take calls again (a spent daily quota).
 */

'use strict';

/**
 * @param {{ threshold?: number, windowMs?: number, openMs?: number, now?: () => number }} [options]
 */
function createBreaker({ threshold = 3, windowMs = 5 * 60_000, openMs = 10 * 60_000, now = Date.now } = {}) {
  const states = new Map(); // provider -> { failures: number[], openUntil: number|null, trial: boolean }

  const get = (name) => {
    if (!states.has(name)) states.set(name, { failures: [], openUntil: null, trial: false });
    return states.get(name);
  };

  return {
    /** True when a call may go to this provider. In half-open state only one caller gets true. */
    allow(name) {
      const s = get(name);
      if (s.openUntil === null) return true;
      if (now() < s.openUntil || s.trial) return false;
      s.trial = true;
      return true;
    },

    success(name) {
      states.set(name, { failures: [], openUntil: null, trial: false });
    },

    failure(name) {
      const s = get(name);
      const t = now();
      if (s.trial) {
        s.trial = false;
        s.openUntil = t + openMs;
        return;
      }
      s.failures = s.failures.filter((at) => t - at < windowMs).concat(t);
      if (s.failures.length >= threshold) {
        s.openUntil = t + openMs;
        s.failures = [];
      }
    },

    /** Opens the breaker for `ms`, whatever its state. */
    trip(name, ms) {
      states.set(name, { failures: [], openUntil: now() + ms, trial: false });
    },

    /** 'closed' | 'open' | 'half-open', for /health/ready. */
    state(name) {
      const s = get(name);
      if (s.openUntil === null) return 'closed';
      return now() < s.openUntil ? 'open' : 'half-open';
    },

    /** When an open breaker lets the next trial through (ms since epoch), or null. */
    reopensAt(name) {
      const s = get(name);
      return s.openUntil !== null && now() < s.openUntil ? s.openUntil : null;
    },
  };
}

module.exports = { createBreaker };
