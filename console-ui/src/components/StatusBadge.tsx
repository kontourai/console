import type { ConnectionStatus } from "../types";

export function StatusBadge({ status }: { status: ConnectionStatus }) {
  return <div className={`status status-${status}`}>{status}</div>;
}
