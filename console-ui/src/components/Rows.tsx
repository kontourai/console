import type { ConsoleAction, ConsoleClaim, ConsoleGate, ConsoleLearning, ConsoleRef, TimelineItem } from "@kontourai/console-core";
import { Badge } from "@kontourai/console-kit/react";
import { formatTime } from "../utils/format";

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

export function ClaimRow({ claim, advisoryLearnings = [] }: { claim: ConsoleClaim; advisoryLearnings?: ConsoleLearning[] }) {
  return (
    <article className="data-row">
      <div className="row-title">
        <strong>{claim.label || claim.id}</strong>
        <Badge value={claim.status || "unknown"} />
      </div>
      <p>freshness: {claim.freshness?.status || "n/a"} · verified: {formatTime(claim.lastVerifiedAt)}</p>
      <LearningNotes learnings={advisoryLearnings} />
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

export function LearningRow({ learning }: { learning: ConsoleLearning }) {
  const refs = (learning.refs || []).map(formatRef).join(" · ");
  const confidence = typeof learning.confidence === "number" ? `${Math.round(learning.confidence * 100)}%` : "confidence n/a";

  return (
    <article className="data-row learning-row">
      <div className="row-title">
        <strong>{learning.summary || learning.id}</strong>
        <Badge value="advisory" />
      </div>
      <p>{learning.family || "learning"} · {confidence} · updated {formatTime(learning.updatedAt)}</p>
      {refs ? <p className="learning-refs">{refs}</p> : null}
    </article>
  );
}

export function LearningNotes({ learnings }: { learnings: ConsoleLearning[] }) {
  if (!learnings.length) return null;

  return (
    <div className="learning-notes" aria-label="Advisory learning context">
      {learnings.map((learning) => (
        <div className="learning-note" key={learning.id}>
          <Badge value="advisory" />
          <span>{learning.summary || learning.id}</span>
        </div>
      ))}
    </div>
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

function formatRef(ref: ConsoleRef) {
  const identity = [ref.product, ref.kind, ref.id].filter(Boolean).join("/");
  return ref.label ? `${ref.label} (${identity})` : identity;
}
