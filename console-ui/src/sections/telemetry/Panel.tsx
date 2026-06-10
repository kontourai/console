import type { ReactNode } from "react";

export function TelemetryPanel({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  return (
    <section className="telemetry-panel">
      <p className="section-label">{label}</p>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
