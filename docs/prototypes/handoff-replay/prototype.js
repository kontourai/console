// ============================================================
//  KONTOUR HANDOFF REPLAY — PROTOTYPE.JS
//  8-record fixture · state-merge model · DOM render contract
// ============================================================

const records = [
  {
    at: "10:00:00",
    product: "flow",
    type: "process.started",
    label: "Flow process started",
    summary: "Provider directory refresh started.",
    ref: "flow/run/run-provider-directory-refresh",
    activeNode: "start",
    patch: {
      process: { status: "running", step: "start refresh", progress: 10 },
      stage: "Starting provider directory refresh."
    }
  },
  {
    at: "10:00:12",
    product: "flow",
    type: "process.progressed",
    label: "Flow reached freshness check",
    summary: "Flow is checking whether provider directory data is current.",
    ref: "flow/run/run-provider-directory-refresh",
    activeNode: "check",
    patch: {
      process: { step: "check provider directory freshness", progress: 32 },
      stage: "Checking provider directory freshness."
    }
  },
  {
    at: "10:00:15",
    product: "flow",
    type: "gate.opened",
    label: "Freshness gate opened",
    summary: "The gate needs a linked Surface claim.",
    ref: "flow/gate/gate-provider-directory-freshness",
    links: ["surface/claim/claim-provider-directory-current"],
    activeNode: "gate",
    patch: {
      gate: {
        status: "waiting",
        reason: "Waiting on linked Surface claim",
        linkedClaim: "surface/claim/claim-provider-directory-current"
      },
      process: { progress: 45 },
      stage: "Still waiting on the linked Surface claim."
    }
  },
  {
    at: "10:00:16",
    product: "surface",
    type: "claim.freshness.changed",
    label: "Surface claim is stale",
    summary: "Provider directory current claim expired under freshness policy.",
    ref: "surface/claim/claim-provider-directory-current",
    activeNode: "claim",
    patch: {
      claim: {
        status: "stale",
        freshness: "stale",
        lastVerifiedAt: "2026-05-01T10:00:00Z",
        evidence: []
      },
      gate: {
        status: "blocked",
        reason: "Surface claim is stale"
      },
      stage: "Blocked because the Surface claim is stale."
    }
  },
  {
    at: "10:00:20",
    product: "surface",
    type: "claim.reverification.requested",
    label: "Refresh requested",
    summary: "Surface requested reverification for the stale claim.",
    ref: "surface/claim/claim-provider-directory-current",
    activeNode: "refresh",
    patch: {
      claim: {
        status: "refreshing",
        freshness: "refreshing"
      },
      actions: [
        {
          id: "action-refresh-provider-directory",
          label: "Refresh provider directory",
          owner: "flow",
          note: "Descriptor only. Console does not execute it."
        }
      ],
      stage: "Refreshing provider directory evidence."
    }
  },
  {
    at: "10:01:35",
    product: "surface",
    type: "evidence.attached",
    label: "Fresh evidence attached",
    summary: "A new provider directory crawl is attached to the claim.",
    ref: "surface/evidence/evidence-provider-directory-crawl-2026-06-03",
    links: ["surface/claim/claim-provider-directory-current"],
    activeNode: "evidence",
    patch: {
      claim: {
        evidence: [
          {
            id: "evidence-provider-directory-crawl-2026-06-03",
            label: "Provider directory crawl",
            capturedAt: "2026-06-03T10:01:35Z"
          }
        ]
      },
      stage: "Fresh evidence arrived from Surface."
    }
  },
  {
    at: "10:01:39",
    product: "surface",
    type: "claim.status.changed",
    label: "Surface claim verified",
    summary: "The claim is fresh and verified with new evidence.",
    ref: "surface/claim/claim-provider-directory-current",
    activeNode: "claim",
    patch: {
      claim: {
        status: "verified",
        freshness: "fresh",
        lastVerifiedAt: "2026-06-03T10:01:39Z"
      },
      gate: {
        status: "ready",
        reason: "Linked Surface claim is verified"
      },
      stage: "Surface verified the claim; the gate is ready."
    }
  },
  {
    at: "10:01:41",
    product: "flow",
    type: "process.progressed",
    label: "Flow process continues",
    summary: "Flow can continue after the freshness gate is ready.",
    ref: "flow/run/run-provider-directory-refresh",
    activeNode: "continue",
    patch: {
      process: {
        status: "running",
        step: "publish refreshed operating state",
        progress: 74
      },
      actions: [
        {
          id: "action-resume-flow-process",
          label: "Resume Flow process",
          owner: "flow",
          note: "Descriptor only. Product authority owns execution."
        }
      ],
      stage: "Continuing the Flow process after trust is restored."
    }
  }
];

// ── Graph layout ──────────────────────────────────────────────────────
// viewBox is 0 0 900 320 — large coords so SVG text is readable at any size.
// Lanes: flow row cy=90, surface row cy=220
const FLOW_Y   = 90;
const SURF_Y   = 220;
const NODE_R   = 22;

const graphNodes = [
  { id: "start",    lane: "flow",    label: "Start refresh",    x: 80,  y: FLOW_Y },
  { id: "check",    lane: "flow",    label: "Check freshness",  x: 230, y: FLOW_Y },
  { id: "gate",     lane: "flow",    label: "Freshness gate",   x: 400, y: FLOW_Y },
  { id: "claim",    lane: "surface", label: "Surface claim",    x: 400, y: SURF_Y },
  { id: "refresh",  lane: "surface", label: "Refresh evidence", x: 570, y: SURF_Y },
  { id: "evidence", lane: "surface", label: "Attach evidence",  x: 720, y: SURF_Y },
  { id: "continue", lane: "flow",    label: "Continue process", x: 820, y: FLOW_Y }
];

const graphEdges = [
  ["start",    "check"],
  ["check",    "gate"],
  ["gate",     "claim"],
  ["claim",    "refresh"],
  ["refresh",  "evidence"],
  ["evidence", "claim"],
  ["claim",    "gate"],
  ["gate",     "continue"]
];

// ── Initial state ─────────────────────────────────────────────────────
const initialState = {
  process: {
    id: "run-provider-directory-refresh",
    label: "Provider directory refresh",
    status: "not started",
    step: "waiting for replay",
    progress: 0
  },
  gate: {
    id: "gate-provider-directory-freshness",
    label: "Provider directory freshness",
    status: "closed",
    reason: "No gate event has arrived yet.",
    linkedClaim: null
  },
  claim: {
    id: "claim-provider-directory-current",
    label: "Provider directory is current",
    status: "unknown",
    freshness: "unknown",
    lastVerifiedAt: "unknown",
    evidence: []
  },
  actions: [],
  stage: "Replay local records to see where the process is."
};

// ── Runtime state ─────────────────────────────────────────────────────
let index = 0;
let playing = false;
let timer = null;
let recordMode = "happened";
let visualMode = "diagram";

// ── Element references ────────────────────────────────────────────────
const els = {
  playPause:        document.getElementById("playPause"),
  prevEvent:        document.getElementById("prevEvent"),
  nextEvent:        document.getElementById("nextEvent"),
  resetReplay:      document.getElementById("resetReplay"),
  eventScrubber:    document.getElementById("eventScrubber"),
  replayPosition:   document.getElementById("replayPosition"),
  replayClock:      document.getElementById("replayClock"),
  processTitle:     document.getElementById("processTitle"),
  operatingSummary: document.getElementById("operatingSummary"),
  stageStatement:   document.getElementById("stageStatement"),
  diagramView:      document.getElementById("diagramView"),
  showDiagram:      document.getElementById("showDiagram"),
  showSwimlanes:    document.getElementById("showSwimlanes"),
  processStatus:    document.getElementById("processStatus"),
  gateStatus:       document.getElementById("gateStatus"),
  claimStatus:      document.getElementById("claimStatus"),
  freshnessStatus:  document.getElementById("freshnessStatus"),
  flowTimeline:     document.getElementById("flowTimeline"),
  claimCard:        document.getElementById("claimCard"),
  surfaceDetail:    document.getElementById("surfaceDetail"),
  surfaceRoute:     document.getElementById("surfaceRoute"),
  joinExplanation:  document.getElementById("joinExplanation"),
  actionList:       document.getElementById("actionList"),
  recordView:       document.getElementById("recordView"),
  showHappened:     document.getElementById("showHappened"),
  showSnapshot:     document.getElementById("showSnapshot")
};

// ── Helpers ───────────────────────────────────────────────────────────
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function merge(target, patch) {
  if (!patch) return target;
  for (const [key, value] of Object.entries(patch)) {
    if (Array.isArray(value)) {
      target[key] = value;
    } else if (value && typeof value === "object") {
      target[key] = merge(target[key] || {}, value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

function stateAt(position) {
  const state = clone(initialState);
  for (const record of records.slice(0, position + 1)) {
    merge(state, record.patch);
  }
  return state;
}

function statusClass(value) {
  return String(value || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function currentRecords() {
  return records.slice(0, index + 1);
}

// ── Diagram rendering ─────────────────────────────────────────────────
//
// Nodes are rendered as SVG circles; labels are HTML <div> elements
// positioned absolutely over the SVG so they render with full browser
// font rendering (no more 3px SVG text hack).
//
function renderDiagram(state, current) {
  const completedIds = new Set(records.slice(0, index + 1).map(r => r.activeNode));
  const nodeById     = new Map(graphNodes.map(n => [n.id, n]));
  const activeNode   = current.activeNode;

  const VW = 900;
  const VH = 320;

  // ── Lane band decorations ──────────────────────────────────────
  const BAND_TOP    = 28;   // flow band top
  const BAND_MID    = 154;  // divider y
  const BAND_BOTTOM = VH - 10;

  const flowBand    = `<rect class="flow-band"    x="0" y="${BAND_TOP}"  width="${VW}" height="${BAND_MID - BAND_TOP}"></rect>`;
  const surfaceBand = `<rect class="surface-band" x="0" y="${BAND_MID}" width="${VW}" height="${BAND_BOTTOM - BAND_MID}"></rect>`;
  const divider     = `<line class="lane-border" x1="0" y1="${BAND_MID}" x2="${VW}" y2="${BAND_MID}"></line>`;

  // ── Swimlane labels in swimlane mode ───────────────────────────
  let laneLabelsHtml = "";
  if (visualMode === "swimlanes") {
    const flowLabelY    = BAND_TOP + (BAND_MID - BAND_TOP) / 2;
    const surfLabelY    = BAND_MID + (BAND_BOTTOM - BAND_MID) / 2;
    laneLabelsHtml = `
      <div class="lane-label flow-lane"    style="top:${flowLabelY * (100 / VH)}%">Flow — owns process &amp; gates</div>
      <div class="lane-label surface-lane" style="top:${surfLabelY * (100 / VH)}%">Surface — owns claims &amp; evidence</div>
    `;
  }

  // ── Determine which lane each edge belongs to ──────────────────
  function edgeLane(fromId, toId) {
    const fn = nodeById.get(fromId);
    const tn = nodeById.get(toId);
    if (fn.lane === "surface" && tn.lane === "surface") return "surface";
    if (fn.lane === "flow"    && tn.lane === "flow")    return "flow";
    return "cross";
  }

  // ── SVG edges ──────────────────────────────────────────────────
  const edges = graphEdges.map(([fromId, toId]) => {
    const from     = nodeById.get(fromId);
    const to       = nodeById.get(toId);
    const isActive = completedIds.has(fromId) && completedIds.has(toId);
    const lane     = edgeLane(fromId, toId);

    // Offset start/end so lines stop at node perimeter
    const dx  = to.x - from.x;
    const dy  = to.y - from.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const ux  = dx / len;
    const uy  = dy / len;
    const r   = NODE_R + 2;

    const x1 = from.x + ux * r;
    const y1 = from.y + uy * r;
    const x2 = to.x   - ux * r;
    const y2 = to.y   - uy * r;

    let cls = "edge";
    let markerId = "arrow";
    if (isActive) {
      if (lane === "flow")    { cls += " active flow-active flowing";    markerId = "arrow-flow"; }
      else if (lane === "surface") { cls += " active surface-active flowing"; markerId = "arrow-surface"; }
      else { cls += " active flowing"; markerId = "arrow-flow"; }
    }

    return `<line class="${cls}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" marker-end="url(#${markerId})"></line>`;
  }).join("");

  // ── SVG nodes (circle + label, same coordinate space) ─────────
  // Labels live INSIDE the SVG so they stay pinned to their node at
  // every container width (no letterbox drift) and scale crisply.
  // Flow labels sit above their node, Surface labels below, keeping
  // text in the outer region of each band and clear of the edges.
  const svgNodes = graphNodes.map(node => {
    const classes = [
      "graph-node",
      node.lane,
      completedIds.has(node.id) ? "seen" : "",
      node.id === activeNode ? "active" : ""
    ].filter(Boolean).join(" ");

    const labelDy = node.lane === "flow" ? -(NODE_R + 14) : (NODE_R + 26);

    return `<g class="${classes}" transform="translate(${node.x},${node.y})">
      <circle r="${NODE_R}"></circle>
      <text class="node-text" y="${labelDy}">${node.label}</text>
    </g>`;
  }).join("");

  // ── Assemble ───────────────────────────────────────────────────
  els.diagramView.className = `diagram-view ${visualMode}`;
  els.diagramView.innerHTML = `
    ${laneLabelsHtml}
    <svg viewBox="0 0 ${VW} ${VH}" role="img" aria-label="Flow and Surface process graph" preserveAspectRatio="xMidYMid meet">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z"></path>
        </marker>
        <marker id="arrow-flow" class="flow-marker" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z"></path>
        </marker>
        <marker id="arrow-surface" class="surface-marker" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z"></path>
        </marker>
      </defs>
      ${flowBand}
      ${surfaceBand}
      ${divider}
      ${edges}
      ${svgNodes}
    </svg>
    <div class="diagram-note">
      <strong>${current.label}</strong>
      <span>${current.summary}</span>
    </div>
  `;
}

// ── Main render ───────────────────────────────────────────────────────
function render() {
  const state    = stateAt(index);
  const current  = records[index];
  const happened = currentRecords();

  els.replayPosition.textContent = `Event ${index + 1} of ${records.length}`;
  els.replayClock.textContent    = current.at;
  els.eventScrubber.value        = String(index);
  els.playPause.textContent      = playing ? "Pause" : "Play";

  els.processTitle.textContent   = state.process.label;
  els.stageStatement.textContent = state.stage;
  els.processStatus.textContent  = state.process.status;
  els.gateStatus.textContent     = state.gate.status;
  els.claimStatus.textContent    = state.claim.status;
  els.freshnessStatus.textContent = state.claim.freshness;

  for (const el of [els.processStatus, els.gateStatus, els.claimStatus, els.freshnessStatus]) {
    el.className = `pill ${statusClass(el.textContent)}`;
  }

  els.operatingSummary.textContent = summaryFor(state);

  renderDiagram(state, current);
  renderTimeline(happened);
  renderClaim(state);
  renderJoin(state, current);
  renderActions(state.actions);
  renderRecords(state, happened);
}

// ── Summary text ──────────────────────────────────────────────────────
function summaryFor(state) {
  if (state.gate.status === "blocked") {
    return "Flow is blocked because the linked Surface claim is stale.";
  }
  if (state.gate.status === "ready") {
    return "Flow can continue because Surface verified the linked claim with fresh evidence.";
  }
  if (state.gate.status === "waiting") {
    return "Flow is waiting for Surface trust state before the gate can advance.";
  }
  return "Replay the local handoff records to watch Console build the operating view.";
}

// ── Timeline ──────────────────────────────────────────────────────────
function renderTimeline(happened) {
  els.flowTimeline.innerHTML = happened
    .filter(r => r.product === "flow")
    .map(r => `
      <li>
        <time>${r.at}</time>
        <div>
          <strong>${r.label}</strong>
          <span>${r.summary}</span>
        </div>
      </li>
    `).join("");
}

// ── Claim card ────────────────────────────────────────────────────────
function renderClaim(state) {
  const evidence = state.claim.evidence.length
    ? state.claim.evidence.map(item => `<li>${item.label}<span>${item.capturedAt}</span></li>`).join("")
    : "<li>No evidence attached yet<span>Waiting</span></li>";

  els.claimCard.innerHTML = `
    <div class="claim-title">
      <span class="claim-dot ${statusClass(state.claim.status)}"></span>
      <div>
        <strong>${state.claim.label}</strong>
        <span>${state.claim.id}</span>
      </div>
    </div>
    <dl>
      <div><dt>Status</dt><dd>${state.claim.status}</dd></div>
      <div><dt>Freshness</dt><dd>${state.claim.freshness}</dd></div>
      <div><dt>Last verified</dt><dd>${state.claim.lastVerifiedAt}</dd></div>
    </dl>
    <h3>Evidence</h3>
    <ul>${evidence}</ul>
  `;

  els.surfaceDetail.textContent = state.claim.status === "unknown"
    ? "Surface detail appears when the claim is linked."
    : "Console embeds current Surface state here, then links to deeper Surface claim history and proof.";

  els.surfaceRoute.textContent = `surface://claims/${state.claim.id}`;
}

// ── Join / Console explanation ────────────────────────────────────────
function renderJoin(state, current) {
  const linked = state.gate.linkedClaim || "No linked claim yet";
  els.joinExplanation.innerHTML = `
    <div class="join-row">
      <span>Current record</span>
      <strong>${current.product}: ${current.type}</strong>
    </div>
    <div class="join-row">
      <span>Gate reason</span>
      <strong>${state.gate.reason}</strong>
    </div>
    <div class="join-row">
      <span>Link</span>
      <strong>${linked}</strong>
    </div>
    <div class="progress-track" aria-label="Flow progress">
      <span style="width: ${state.process.progress}%"></span>
    </div>
    <p>Step: ${state.process.step}</p>
  `;
}

// ── Actions ───────────────────────────────────────────────────────────
function renderActions(actions) {
  if (!actions.length) {
    els.actionList.innerHTML = "<li>No actions available yet.</li>";
    return;
  }
  els.actionList.innerHTML = actions.map(action => `
    <li>
      <strong>${action.label}</strong>
      <span>${action.owner} authority — ${action.note}</span>
    </li>
  `).join("");
}

// ── Record viewer ─────────────────────────────────────────────────────
function renderRecords(state, happened) {
  const snapshot = {
    plainLabel: "Current snapshot",
    process: state.process,
    gate: state.gate,
    claim: state.claim,
    actions: state.actions
  };
  const payload = recordMode === "happened"
    ? happened.map(r => ({
        at:      r.at,
        product: r.product,
        type:    r.type,
        ref:     r.ref,
        links:   r.links || []
      }))
    : snapshot;
  els.recordView.textContent = JSON.stringify(payload, null, 2);
}

// ── Playback ──────────────────────────────────────────────────────────
function setIndex(next) {
  index = Math.max(0, Math.min(records.length - 1, next));
  if (index === records.length - 1) stop();
  render();
}

function play() {
  if (playing) return;
  playing = true;
  render();
  timer = setInterval(() => {
    if (index >= records.length - 1) {
      stop();
      render();
      return;
    }
    setIndex(index + 1);
  }, 1300);
}

function stop() {
  playing = false;
  if (timer) clearInterval(timer);
  timer = null;
}

// ── Event wiring ──────────────────────────────────────────────────────
els.playPause.addEventListener("click", () => {
  if (playing) {
    stop();
    render();
  } else {
    if (index === records.length - 1) index = 0;
    play();
  }
});

els.prevEvent.addEventListener("click", () => {
  stop();
  setIndex(index - 1);
});

els.nextEvent.addEventListener("click", () => {
  stop();
  setIndex(index + 1);
});

els.resetReplay.addEventListener("click", () => {
  stop();
  setIndex(0);
});

els.eventScrubber.addEventListener("input", (event) => {
  stop();
  setIndex(Number(event.target.value));
});

els.showHappened.addEventListener("click", () => {
  recordMode = "happened";
  els.showHappened.classList.add("active");
  els.showSnapshot.classList.remove("active");
  render();
});

els.showSnapshot.addEventListener("click", () => {
  recordMode = "snapshot";
  els.showSnapshot.classList.add("active");
  els.showHappened.classList.remove("active");
  render();
});

els.showDiagram.addEventListener("click", () => {
  visualMode = "diagram";
  els.showDiagram.classList.add("active");
  els.showSwimlanes.classList.remove("active");
  render();
});

els.showSwimlanes.addEventListener("click", () => {
  visualMode = "swimlanes";
  els.showSwimlanes.classList.add("active");
  els.showDiagram.classList.remove("active");
  render();
});

// ── Initial render ────────────────────────────────────────────────────
render();
