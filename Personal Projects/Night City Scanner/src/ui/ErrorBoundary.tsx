import { Component, type ReactNode } from 'react';

/**
 * Last-resort guard: a rendering bug shows a recovery screen instead of a
 * blank page. Stored documents are unaffected (they live in IndexedDB), and
 * reloading re-locks the app.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Log only the error type: messages could contain document details.
    console.error('UI error', error instanceof Error ? error.name : typeof error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="lock">
        <div className="lock__inner">
          <h1 className="lock__title">Something broke</h1>
          <p className="lock__lead">The screen hit an unexpected error. Your saved documents are safe on this device.</p>
          <button type="button" className="btn btn--primary btn--lg btn--block" onClick={() => location.reload()}>
            Reload app
          </button>
        </div>
      </main>
    );
  }
}
