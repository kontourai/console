import type { ConsoleAction, ConsoleClaim, ConsoleGate, TimelineItem } from "@kontour/console-core";
import { formatTime } from "../utils/format";
import { Badge } from "./Badge";

export function GateRow({ gate }: { gate: ConsoleGate }) {
  return (
    <article className="data-row">
      <div className="row-title">
        <strong>{gate.label || gate.id}</strong>
        <Badge value={gate.status || "unknown"} />
      </div>
      <p>{gate.routeBack?.reason || gate.missingEvidence?.join(", ") || gate.processRef?.label || gate.processRef?.id || "No blocking detail."}</p>
    </article>
  );
}

export function ClaimRow({ claim }: { claim: ConsoleClaim }) {
  return (
    <article className="data-row">
      <div className="row-title">
        <strong>{claim.label || claim.id}</strong>
        <Badge value={claim.status || "unknown"} />
      </div>
      <p>freshness: {claim.freshness?.status || "n/a"} · verified: {formatTime(claim.lastVerifiedAt)}</p>
    </article>
  );
}

export function ActionRow({ action }: { action: ConsoleAction }) {
  return (
    <article className="data-row action-row">
      <div className="row-title">
        <strong>{action.label || action.id}</strong>
        <Badge value={action.readOnly ? "read only" : action.status || "descriptor"} />
      </div>
      <p>{action.authority?.product || "unknown"} {action.authority?.command || action.kind || "action"}</p>
    </article>
  );
}

export function TimelineRow({ item }: { item: TimelineItem }) {
  return (
    <article className="timeline-row">
      <time>{formatTime(item.occurredAt || item.observedAt)}</time>
      <div>
        <strong>{item.type || "event"}</strong>
        <p>{item.summary || item.subjectRef?.label || item.subjectRef?.id || item.id}</p>
      </div>
      <span>{item.producer?.product || "local"}</span>
    </article>
  );
}
