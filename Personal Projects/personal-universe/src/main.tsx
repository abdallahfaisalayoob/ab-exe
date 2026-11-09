import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "./styles/base.css";
import App from "./App";

class Boundary extends React.Component<{ children: React.ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: any) { return { error: String(e?.message ?? e) }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ height: "100%", display: "grid", placeItems: "center", padding: 40 }}>
        <div className="col gap4" style={{ maxWidth: 520, textAlign: "center", alignItems: "center" }}>
          <h1 className="display" style={{ fontSize: 40 }}>Something went wrong</h1>
          <p className="dim">The interface hit an unexpected error. Your data is safe on disk — nothing was lost.</p>
          <code className="mono small faint selectable">{this.state.error}</code>
          <button className="btn primary" onClick={() => location.reload()}>Reload the interface</button>
        </div>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Boundary><App /></Boundary>);
