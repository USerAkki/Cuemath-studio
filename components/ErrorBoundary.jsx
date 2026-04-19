"use client";
// ─────────────────────────────────────────────────────────────────────────────
// components/ErrorBoundary.jsx
//
// Class component (required for React error boundaries).
// Catches any JS/render error inside the Studio and shows a recovery UI
// instead of a blank screen.
//
// In development: shows the full error and stack trace.
// In production:  shows a friendly message with a reload button.
// ─────────────────────────────────────────────────────────────────────────────

import { Component } from "react";

const IS_DEV = process.env.NODE_ENV !== "production";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // In production this would go to Sentry / Datadog etc.
    console.error("[ErrorBoundary] Caught render error:", error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const { error, info } = this.state;

    return (
      <div style={{
        minHeight: "100vh",
        background: "#03040A",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'DM Sans', sans-serif",
        padding: 32,
      }}>
        <div style={{
          maxWidth: 580,
          background: "#0B0C15",
          border: "1px solid #FF4A4A44",
          borderRadius: 14,
          padding: "32px 36px",
        }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, background: "#FF5500", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: "#fff" }}>C</div>
            <span style={{ fontSize: 13, color: "#E8E3D8", fontWeight: 700 }}>Cuemath Social Studio</span>
          </div>

          <div style={{ fontSize: 16, color: "#FF4A4A", fontWeight: 700, marginBottom: 8 }}>
            Something went wrong
          </div>
          <div style={{ fontSize: 13, color: "#A09B95", lineHeight: 1.75, marginBottom: 20 }}>
            The application encountered an unexpected error and could not continue rendering.
            Your progress has not been lost — refreshing the page will restore the app.
          </div>

          {/* Dev: show full error details */}
          {IS_DEV && error && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 9, color: "#FF4A4A", fontFamily: "monospace", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 8 }}>ERROR DETAILS (development only)</div>
              <div style={{
                background: "#0D0E17",
                border: "1px solid #FF4A4A33",
                borderRadius: 8,
                padding: "12px 14px",
                fontSize: 11,
                color: "#FF9090",
                fontFamily: "monospace",
                lineHeight: 1.7,
                wordBreak: "break-all",
                maxHeight: 200,
                overflow: "auto",
              }}>
                <strong>{error.name}: {error.message}</strong>
                {info?.componentStack && (
                  <pre style={{ margin: "8px 0 0", fontSize: 10, color: "#665555", whiteSpace: "pre-wrap" }}>
                    {info.componentStack.trim()}
                  </pre>
                )}
              </div>
            </div>
          )}

          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "10px 22px",
              background: "#FF5500",
              border: "none",
              borderRadius: 7,
              color: "#fff",
              fontSize: 11,
              fontWeight: 800,
              cursor: "pointer",
              letterSpacing: "0.07em",
            }}
          >
            RELOAD APPLICATION
          </button>
        </div>
      </div>
    );
  }
}
