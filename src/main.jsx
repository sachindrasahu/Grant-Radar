import React from "react";
import ReactDOM from "react-dom/client";
import GrantRfpRadar from "./App.jsx";

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, fontFamily: "monospace", background: "#fff" }}>
          <h2 style={{ color: "#a00" }}>App crashed — please share this with your developer:</h2>
          <pre style={{ background: "#f5f5f5", padding: 16, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {this.state.error.toString()}{"\n\n"}{this.state.error.stack}
          </pre>
          <button onClick={() => this.setState({ error: null })} style={{ marginTop: 16, padding: "8px 16px" }}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <GrantRfpRadar />
    </ErrorBoundary>
  </React.StrictMode>
);
