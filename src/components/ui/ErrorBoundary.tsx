"use client";

import { CircleAlert, RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./Button";
import { Card } from "./Card";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Leave the broken screen (e.g. go back to setup). */
  onReset(): void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Keeps a crash in one screen (or a code chunk that failed to download) from blanking the
 * whole app: shows what happened and a way back to the start.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("GD Arena screen crashed", error, info.componentStack);
  }

  private reset = () => {
    this.setState({ error: null });
    this.props.onReset();
  };

  render() {
    if (!this.state.error) return this.props.children;
    // A failed dynamic import means the app was updated or the network dropped: reload fixes it.
    const chunkFailed = /loading (css )?chunk|dynamically imported module|failed to fetch/i.test(
      this.state.error.message,
    );
    return (
      <Card role="alert" className="mx-auto mt-6 flex max-w-lg flex-col items-center gap-4 p-6 text-center sm:p-8">
        <CircleAlert aria-hidden className="size-10 text-bad" />
        <div>
          <h1 className="text-xl font-semibold text-ink">Something went wrong</h1>
          <p className="mt-2 text-sm text-ink-2">
            {chunkFailed
              ? "Part of the app couldn't be downloaded. Check your connection and reload the page."
              : "This screen hit an unexpected error. Head back to the start and try again."}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {chunkFailed && (
            <Button
              variant="primary"
              icon={<RotateCcw aria-hidden className="size-4" />}
              onClick={() => window.location.reload()}
            >
              Reload page
            </Button>
          )}
          <Button variant={chunkFailed ? "secondary" : "primary"} onClick={this.reset}>
            Back to start
          </Button>
        </div>
      </Card>
    );
  }
}
