import { formatStep, type ConsoleLearning, type ConsoleProcess } from "@kontourai/console-core";
import { Badge, Progress } from "@kontourai/ui/react";
import { formatTime } from "../utils/format";
import { LearningNotes } from "./Rows";

export function ProcessView({ process, advisoryLearnings = [] }: { process: ConsoleProcess; advisoryLearnings?: ConsoleLearning[] }) {
  return (
    <div className="process-block">
      <div className="row-title">
        <strong>{process.label || process.id}</strong>
        <Badge value={process.status || "unknown"} />
      </div>
      <dl className="details">
        <div><dt>step</dt><dd>{formatStep(process.currentStep)}</dd></div>
        <div><dt>progress</dt><dd>{typeof process.percentComplete === "number" ? `${process.percentComplete}%` : "n/a"}</dd></div>
        <div><dt>updated</dt><dd>{formatTime(process.updatedAt)}</dd></div>
      </dl>
      <Progress value={process.percentComplete} />
      <LearningNotes learnings={advisoryLearnings} />
    </div>
  );
}
