/**
 * LeadPulse — Per-provider circuit breaker (in memory, per process).
 *
 * 3 failures within 5 minutes open the breaker for 10 minutes; then one trial
 * call is let through (half-open). Success closes it, failure re-opens it.
 */

'use strict';

/**
 * @param {{ threshold?: number, windowMs?: number, openMs?: number, now?: () => number }} [options]
 */
function createBreaker({ threshold = 3, windowMs = 5 * 60_000, openMs = 10 * 60_000, now = Date.now } = {}) {
  const states = new Map(); // provider -> { failures: number[], openedAt: number|null, trial: boolean }

  const get = (name) => {
    if (!states.has(name)) states.set(name, { failures: [], openedAt: null, trial: false });
    return states.get(name);
  };

  return {
    /** True when a call may go to this provider. In half-open state only one caller gets true. */
    allow(name) {
      const s = get(name);
      if (s.openedAt === null) return true;
      if (now() - s.openedAt < openMs || s.trial) return false;
      s.trial = true;
      return true;
    },

    success(name) {
      states.set(name, { failures: [], openedAt: null, trial: false });
    },

    failure(name) {
      const s = get(name);
      const t = now();
      if (s.trial) {
        s.trial = false;
        s.openedAt = t;
        return;
      }
      s.failures = s.failures.filter((at) => t - at < windowMs).concat(t);
      if (s.failures.length >= threshold) {
        s.openedAt = t;
        s.failures = [];
      }
    },

    /** 'closed' | 'open' | 'half-open', for /health/ready. */
    state(name) {
      const s = get(name);
      if (s.openedAt === null) return 'closed';
      return now() - s.openedAt < openMs ? 'open' : 'half-open';
    },
  };
}

module.exports = { createBreaker };
