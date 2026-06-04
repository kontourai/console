import { Empty } from "../components/Empty";
import { TimelineRow } from "../components/Rows";
import type { OperatingState, RecordAcceptedEvent } from "../types";

export function TimelineSection({ state, lastAccepted }: { state: OperatingState; lastAccepted: RecordAcceptedEvent | null }) {
  const recentTimeline = [...(state.timeline || [])].slice(-8).reverse();

  return (
    <section className="timeline-section">
      <div className="section-head">
        <div>
          <p className="section-label">Recent Timeline</p>
          <h2>Accepted event replay</h2>
        </div>
        <p className="receipt">
          {lastAccepted?.delivery?.recordId ? `last accepted: ${lastAccepted.delivery.recordId}` : "waiting for record.accepted"}
        </p>
      </div>
      <div className="timeline">
        {recentTimeline.map((item) => <TimelineRow key={item.id} item={item} />)}
        {!recentTimeline.length ? <Empty label="No timeline events yet." /> : null}
      </div>
    </section>
  );
}
