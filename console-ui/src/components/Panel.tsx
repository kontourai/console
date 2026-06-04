import type { ReactNode } from "react";

export function Panel({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        <span>{count}</span>
      </div>
      {children}
    </section>
  );
}
