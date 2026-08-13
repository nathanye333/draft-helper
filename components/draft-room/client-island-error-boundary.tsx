"use client";

import { Component, type ReactNode } from "react";

interface Props {
  name: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Keeps one broken client island from blanking the whole draft room. */
export class ClientIslandErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-md border border-red-900/50 bg-red-950/40 p-3 text-sm text-red-200">
          <p className="font-medium">{this.props.name} failed to render</p>
          <p className="mt-1 text-xs text-red-300/80">{this.state.error.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
