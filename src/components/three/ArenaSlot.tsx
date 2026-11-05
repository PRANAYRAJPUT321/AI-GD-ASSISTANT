"use client";

import { Component, lazy, Suspense, type ReactNode } from "react";
import type { ArenaProps } from "./Arena";

export type { ArenaProps, ArenaReaction, ArenaSeat } from "./Arena";

// three.js is large: the arena loads only when a screen actually shows it.
const Arena = lazy(() => import("./Arena"));

class ArenaBoundary extends Component<{ children: ReactNode; onFail(): void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    // WebGL can still fail at runtime (blocked, out of contexts, driver issues): the caller
    // keeps showing its 2D version.
    this.props.onFail();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** The WebGL arena, loaded on demand; `onFail` lets the caller fall back to its 2D version. */
export function ArenaSlot({ onFail, ...props }: ArenaProps & { onFail(): void }) {
  return (
    <ArenaBoundary onFail={onFail}>
      <Suspense fallback={null}>
        <Arena {...props} />
      </Suspense>
    </ArenaBoundary>
  );
}
