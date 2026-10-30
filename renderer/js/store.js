// Tiny in-memory store shared by the shell and all views.
// Keys: overview, scan, wifi, survey, dns, speed, devices, connections, providers,
//       agentLog, scanProgress, speedProgress.

const state = new Map();
const listeners = new Map();

export const store = {
  get(key) {
    return state.get(key);
  },

  set(key, value) {
    state.set(key, value);
    const set = listeners.get(key);
    if (!set) return;
    for (const cb of [...set]) {
      try {
        cb(value);
      } catch (err) {
        console.error(`[store] listener for "${key}" failed`, err);
      }
    }
  },

  // Returns an unsubscribe function. The callback is not called with the current value;
  // read it with get() first if you need it.
  on(key, cb) {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(cb);
    return () => listeners.get(key)?.delete(cb);
  },

  // Shell helper: updates an object value shallowly.
  patch(key, partial) {
    this.set(key, { ...(state.get(key) || {}), ...partial });
  },
};

export default store;
