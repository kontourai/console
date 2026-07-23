import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureSurfaceTrustPanel,
  __resetSurfaceTrustPanelLoaderForTests,
  type SurfaceTrustPanelImporter,
} from "../src/surface-trust-panel-loader";

// console#255 review MED finding 2: the loader used to mark itself `loaded`
// BEFORE its fire-and-forget dynamic import settled, so a failed chunk fetch
// (offline, a CDN hiccup) left an unhandled rejection AND permanently
// disabled every future load attempt. These tests exercise the promise-based
// contract directly, injecting a fake importer (the loader's own import seam)
// since a real dynamic import of the published package can't be forced to
// fail/succeed on demand in this repo's no-jsdom unit-test convention (see
// GateTrustPanel.test.ts's module doc comment) — the live-browser contract
// (an actually-registered custom element) is covered by
// tests/browser/gate-trust-panel.spec.ts.

class FakeCustomElementRegistry {
  #registered = new Set<string>();
  get(name: string): unknown {
    return this.#registered.has(name) ? class {} : undefined;
  }
  define(name: string): void {
    this.#registered.add(name);
  }
}

async function withFakeCustomElements<T>(fn: (registry: FakeCustomElementRegistry) => Promise<T> | T): Promise<T> {
  const registry = new FakeCustomElementRegistry();
  const previous = (globalThis as { customElements?: unknown }).customElements;
  (globalThis as { customElements?: unknown }).customElements = registry;
  try {
    // MUST await here (not `return fn(registry)`): without it, `finally`
    // fires as soon as `fn` returns its pending promise — BEFORE the
    // callback's own internal awaits (and the loader's async importer calls)
    // actually settle — un-stubbing `customElements` mid-test and making a
    // SECOND `ensureSurfaceTrustPanel` call inside the same test see
    // `customElements === undefined` again.
    return await fn(registry);
  } finally {
    (globalThis as { customElements?: unknown }).customElements = previous;
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("ensureSurfaceTrustPanel resolves false without calling the importer when customElements is undefined (SSR/test environment)", async () => {
  __resetSurfaceTrustPanelLoaderForTests();
  const previous = (globalThis as { customElements?: unknown }).customElements;
  delete (globalThis as { customElements?: unknown }).customElements;
  try {
    let calls = 0;
    const importer: SurfaceTrustPanelImporter = () => {
      calls += 1;
      return Promise.resolve();
    };
    const ok = await ensureSurfaceTrustPanel(importer);
    assert.equal(ok, false);
    assert.equal(calls, 0);
  } finally {
    (globalThis as { customElements?: unknown }).customElements = previous;
  }
});

test("ensureSurfaceTrustPanel resolves true without calling the importer when the element is already registered", async () => {
  await withFakeCustomElements(async (registry) => {
    __resetSurfaceTrustPanelLoaderForTests();
    registry.define("surface-trust-panel");
    let calls = 0;
    const importer: SurfaceTrustPanelImporter = () => {
      calls += 1;
      return Promise.resolve();
    };
    const ok = await ensureSurfaceTrustPanel(importer);
    assert.equal(ok, true);
    assert.equal(calls, 0);
  });
});

test("a resolving importer registers the element: resolves true, and a second call does not re-invoke the importer", async () => {
  await withFakeCustomElements(async () => {
    __resetSurfaceTrustPanelLoaderForTests();
    let calls = 0;
    const importer: SurfaceTrustPanelImporter = () => {
      calls += 1;
      return Promise.resolve();
    };
    const first = await ensureSurfaceTrustPanel(importer);
    assert.equal(first, true);
    assert.equal(calls, 1);

    const second = await ensureSurfaceTrustPanel(importer);
    assert.equal(second, true);
    assert.equal(calls, 1, "already loaded — the importer must not run again");
  });
});

test("a rejecting importer resolves false and resets state so the NEXT call retries the import (console#255 review MED finding 2)", async () => {
  await withFakeCustomElements(async () => {
    __resetSurfaceTrustPanelLoaderForTests();
    let calls = 0;
    const importer: SurfaceTrustPanelImporter = () => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error("chunk load failed (offline)"));
      return Promise.resolve();
    };

    const originalError = console.error;
    console.error = () => undefined;
    try {
      const first = await ensureSurfaceTrustPanel(importer);
      assert.equal(first, false, "a rejected import must resolve false, never throw");
      assert.equal(calls, 1);

      // Retry: a later call (e.g. the consumer component remounts after the
      // gate is reselected) must attempt the import again, not stay
      // permanently disabled by the first failure.
      const second = await ensureSurfaceTrustPanel(importer);
      assert.equal(second, true, "the retry succeeds once the transient failure clears");
      assert.equal(calls, 2);
    } finally {
      console.error = originalError;
    }
  });
});

test("concurrent calls while an import is in flight share the SAME promise — the importer runs exactly once", async () => {
  await withFakeCustomElements(async () => {
    __resetSurfaceTrustPanelLoaderForTests();
    let calls = 0;
    const gate = deferred<void>();
    const importer: SurfaceTrustPanelImporter = () => {
      calls += 1;
      return gate.promise;
    };

    const first = ensureSurfaceTrustPanel(importer);
    const second = ensureSurfaceTrustPanel(importer);
    assert.equal(calls, 1, "a second call made before the first settles must not start a second import");

    gate.resolve();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.equal(firstResult, true);
    assert.equal(secondResult, true);
    assert.equal(calls, 1);
  });
});
