/**
 * The smallest reactivity that makes a mod's panel live.
 *
 * A mod describes its UI once and then never calls anything named render: it writes to a `Ref`, and
 * whatever read that ref updates. Signals rather than a re-render callback because of where this
 * runs -- a panel is drawn in another document, often another process, so "the value changed" has to
 * be expressible as a patch addressed at one binding. Re-running a render function and diffing trees
 * would produce the same pixels for a great deal more traffic.
 *
 * Dependencies are tracked by reading rather than declared, the way Vue and Solid do it. The
 * alternative -- an explicit dependency list -- fails silently and permanently when somebody forgets
 * an entry, and "my panel stopped updating" is a far worse afternoon than the one caveat that comes
 * with tracking: a ref read *after* an `await` is read outside the effect that is running, so it is
 * not tracked. Keep the functions handed to `dynamic` and `each` synchronous.
 *
 * Flushing is batched onto a microtask. Ten writes inside one message handler are one frame's worth
 * of change and should cross the boundary once.
 */

/** A value the UI can be bound to. Writing to it is what makes a panel move. */
export interface Ref<T> {
  value: T;
}

/** A derived value. Recomputed when what it read changes; cannot be written to. */
export interface ReadonlyRef<T> {
  readonly value: T;
}

interface Watcher {
  /** Cleared and refilled on every run, so a branch that stops reading a ref stops depending on it. */
  readonly deps: Set<Set<Watcher>>;
  run(): void;
  /** Set when the owner is disposed, so a flush already in flight skips it. */
  dead: boolean;
}

let current: Watcher | null = null;
const queued = new Set<Watcher>();
let flushing = false;
let depth = 0;

function track(subscribers: Set<Watcher>): void {
  if (!current) return;
  subscribers.add(current);
  current.deps.add(subscribers);
}

function notify(subscribers: Set<Watcher>): void {
  // Only queues -- nothing runs here. A watcher's run clears and refills its dependencies, which
  // would mutate this very set mid-walk, and deferring it to the flush is what makes that safe.
  for (const watcher of subscribers) {
    if (watcher.dead || watcher === current) continue;
    queued.add(watcher);
  }
  schedule();
}

function schedule(): void {
  if (flushing || depth > 0 || queued.size === 0) return;
  flushing = true;
  queueMicrotask(() => {
    flushing = false;
    flush();
  });
}

function flush(): void {
  // A watcher may queue others as it runs (a computed feeding a dynamic), so this drains rather than
  // iterating a snapshot. Bounded by the fact that each pass only re-queues what actually changed.
  let guard = 0;
  while (queued.size > 0) {
    if (guard++ > 100) {
      queued.clear();
      throw new Error(
        "a mod's reactive update did not settle after 100 passes -- something it renders writes to " +
          "a value it also reads",
      );
    }
    const batchToRun = [...queued];
    queued.clear();
    for (const watcher of batchToRun) {
      if (!watcher.dead) watcher.run();
    }
  }
}

/**
 * Runs everything in `fn` before anything re-evaluates.
 *
 * Used around the delivery of one message and one UI event, which is where a mod most plausibly
 * writes several refs that a single piece of UI reads.
 */
export function batch<T>(fn: () => T): T {
  depth += 1;
  try {
    return fn();
  } finally {
    depth -= 1;
    schedule();
  }
}

/** Runs `fn` without subscribing to anything it reads. */
export function untracked<T>(fn: () => T): T {
  const previous = current;
  current = null;
  try {
    return fn();
  } finally {
    current = previous;
  }
}

export function ref<T>(initial: T): Ref<T> {
  const subscribers = new Set<Watcher>();
  let value = initial;
  return {
    get value() {
      track(subscribers);
      return value;
    },
    set value(next: T) {
      // Reference equality, not deep: the array-replacement idiom (`chat.value = [...chat.value, x]`)
      // has to register, and a mod that mutates an array in place is told to replace it instead --
      // by nothing happening, which is at least consistent with every other signal library.
      if (Object.is(value, next)) return;
      value = next;
      notify(subscribers);
    },
  };
}

export function computed<T>(fn: () => T): ReadonlyRef<T> {
  const subscribers = new Set<Watcher>();
  let value: T;
  let stale = true;
  const watcher: Watcher = {
    deps: new Set(),
    dead: false,
    run() {
      // Marked rather than recomputed: nothing has asked for the value yet, and a computed nobody
      // reads should not run somebody's code every time its inputs move.
      if (stale) return;
      stale = true;
      notify(subscribers);
    },
  };
  return {
    get value() {
      track(subscribers);
      if (stale) {
        for (const dep of watcher.deps) dep.delete(watcher);
        watcher.deps.clear();
        const previous = current;
        current = watcher;
        try {
          value = fn();
        } finally {
          current = previous;
        }
        stale = false;
      }
      return value;
    },
  };
}

/**
 * Runs `fn` now, and again whenever anything it read changes.
 *
 * Returns the stop function. Stopping is what a re-run of a parent region does to the effects its
 * old subtree owned -- without it, a `dynamic` that flipped away from a branch would keep the
 * branch's effects alive forever, re-emitting patches for nodes the host has already thrown away.
 */
export function effect(fn: () => void): () => void {
  const watcher: Watcher = {
    deps: new Set(),
    dead: false,
    run() {
      for (const dep of watcher.deps) dep.delete(watcher);
      watcher.deps.clear();
      const previous = current;
      current = watcher;
      try {
        fn();
      } finally {
        current = previous;
      }
    },
  };
  watcher.run();
  return () => {
    watcher.dead = true;
    for (const dep of watcher.deps) dep.delete(watcher);
    watcher.deps.clear();
    queued.delete(watcher);
  };
}

/** True for anything this module made, so a UI prop can tell a live value from a fixed one. */
export function isRef(value: unknown): value is Ref<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    // A plain `{ value: 1 }` from a mod would otherwise be mistaken for a ref. Every ref this module
    // makes defines `value` as an accessor; no object literal a mod writes does.
    Object.getOwnPropertyDescriptor(value, "value")?.get !== undefined
  );
}
