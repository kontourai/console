import type { OperatingState } from "@kontourai/console-core";
import { TimelineRow } from "../components/Rows";
import { DesignedEmpty } from "../components/DesignedEmpty";
import type { ConsoleAcceptedRecordSsePayload } from "../serverApiTypes";

export function TimelineSection({ state, lastAccepted }: { state: OperatingState; lastAccepted: ConsoleAcceptedRecordSsePayload | null }) {
  const recentTimeline = [...(state.timeline || [])].slice(-8).reverse();

  return (
    <section className="timeline-section">
      <div className="section-head">
        <div>
          <p className="section-label">Recent timeline</p>
          <h2>Accepted event replay</h2>
        </div>
        <p className="receipt">
          {lastAccepted?.delivery?.recordId ? `last accepted: ${lastAccepted.delivery.recordId}` : "waiting for record.accepted"}
        </p>
      </div>
      <div className="timeline">
        {recentTimeline.map((item) => <TimelineRow key={item.id} item={item} />)}
        {!recentTimeline.length
          ? <DesignedEmpty
              headline="Nothing replayed yet"
              body="Records posted to this hub will appear here live."
              command="POST /api/accept"
            />
          : null}
      </div>
    </section>
  );
}
