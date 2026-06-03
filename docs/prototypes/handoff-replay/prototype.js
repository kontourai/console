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

const graphNodes = [
  { id: "start", lane: "flow", label: "Start refresh", x: 8, y: 28 },
  { id: "check", lane: "flow", label: "Check freshness", x: 25, y: 28 },
  { id: "gate", lane: "flow", label: "Freshness gate", x: 42, y: 28 },
  { id: "claim", lane: "surface", label: "Surface claim", x: 42, y: 66 },
  { id: "refresh", lane: "surface", label: "Refresh evidence", x: 61, y: 66 },
  { id: "evidence", lane: "surface", label: "Attach evidence", x: 78, y: 66 },
  { id: "continue", lane: "flow", label: "Continue process", x: 78, y: 28 }
];

const graphEdges = [
  ["start", "check"],
  ["check", "gate"],
  ["gate", "claim"],
  ["claim", "refresh"],
  ["refresh", "evidence"],
  ["evidence", "claim"],
  ["claim", "gate"],
  ["gate", "continue"]
];

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
  actions: []
  ,
  stage: "Replay local records to see where the process is."
};

let index = 0;
let playing = false;
let timer = null;
let recordMode = "happened";
let visualMode = "diagram";

const els = {
  playPause: document.getElementById("playPause"),
  prevEvent: document.getElementById("prevEvent"),
  nextEvent: document.getElementById("nextEvent"),
  resetReplay: document.getElementById("resetReplay"),
  eventScrubber: document.getElementById("eventScrubber"),
  replayPosition: document.getElementById("replayPosition"),
  replayClock: document.getElementById("replayClock"),
  processTitle: document.getElementById("processTitle"),
  operatingSummary: document.getElementById("operatingSummary"),
  stageStatement: document.getElementById("stageStatement"),
  diagramView: document.getElementById("diagramView"),
  showDiagram: document.getElementById("showDiagram"),
  showSwimlanes: document.getElementById("showSwimlanes"),
  processStatus: document.getElementById("processStatus"),
  gateStatus: document.getElementById("gateStatus"),
  claimStatus: document.getElementById("claimStatus"),
  freshnessStatus: document.getElementById("freshnessStatus"),
  flowTimeline: document.getElementById("flowTimeline"),
  claimCard: document.getElementById("claimCard"),
  surfaceDetail: document.getElementById("surfaceDetail"),
  surfaceRoute: document.getElementById("surfaceRoute"),
  joinExplanation: document.getElementById("joinExplanation"),
  actionList: document.getElementById("actionList"),
  recordView: document.getElementById("recordView"),
  showHappened: document.getElementById("showHappened"),
  showSnapshot: document.getElementById("showSnapshot")
};

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

function render() {
  const state = stateAt(index);
  const current = records[index];
  const happened = currentRecords();

  els.replayPosition.textContent = `Event ${index + 1} of ${records.length}`;
  els.replayClock.textContent = current.at;
  els.eventScrubber.value = String(index);
  els.playPause.textContent = playing ? "Pause" : "Play";

  els.processTitle.textContent = state.process.label;
  els.stageStatement.textContent = state.stage;
  els.processStatus.textContent = state.process.status;
  els.gateStatus.textContent = state.gate.status;
  els.claimStatus.textContent = state.claim.status;
  els.freshnessStatus.textContent = state.claim.freshness;

  for (const element of [els.processStatus, els.gateStatus, els.claimStatus, els.freshnessStatus]) {
    element.className = `pill ${statusClass(element.textContent)}`;
  }

  els.operatingSummary.textContent = summaryFor(state);
  renderDiagram(state, current);
  renderTimeline(happened);
  renderClaim(state);
  renderJoin(state, current);
  renderActions(state.actions);
  renderRecords(state, happened);
}

function renderDiagram(state, current) {
  const completedIds = new Set(records.slice(0, index + 1).map((record) => record.activeNode));
  const nodeById = new Map(graphNodes.map((node) => [node.id, node]));
  const activeNode = current.activeNode;
  const laneLabels = visualMode === "swimlanes"
    ? `<div class="lane-label flow-lane">Flow owns process and gates</div><div class="lane-label surface-lane">Surface owns claims and evidence</div>`
    : "";

  const edges = graphEdges.map(([fromId, toId]) => {
    const from = nodeById.get(fromId);
    const to = nodeById.get(toId);
    const edgeActive = completedIds.has(fromId) && completedIds.has(toId);
    return `<line class="${edgeActive ? "edge active" : "edge"}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"></line>`;
  }).join("");

  const nodes = graphNodes.map((node) => {
    const classes = [
      "graph-node",
      node.lane,
      completedIds.has(node.id) ? "seen" : "",
      node.id === activeNode ? "active" : ""
    ].filter(Boolean).join(" ");
    return `
      <g class="${classes}" transform="translate(${node.x} ${node.y})">
        <circle r="4.8"></circle>
        <text y="9">${node.label}</text>
      </g>
    `;
  }).join("");

  els.diagramView.className = `diagram-view ${visualMode}`;
  els.diagramView.innerHTML = `
    ${laneLabels}
    <svg viewBox="0 0 100 92" role="img" aria-label="Flow and Surface process graph">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z"></path>
        </marker>
      </defs>
      <rect class="lane flow-band" x="2" y="12" width="96" height="30"></rect>
      <rect class="lane surface-band" x="2" y="50" width="96" height="30"></rect>
      ${edges}
      ${nodes}
    </svg>
    <div class="diagram-note">
      <strong>${current.label}</strong>
      <span>${current.summary}</span>
    </div>
  `;
}

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

function renderTimeline(happened) {
  els.flowTimeline.innerHTML = happened
    .filter((record) => record.product === "flow")
    .map((record) => `
      <li>
        <time>${record.at}</time>
        <div>
          <strong>${record.label}</strong>
          <span>${record.summary}</span>
        </div>
      </li>
    `)
    .join("");
}

function renderClaim(state) {
  const evidence = state.claim.evidence.length
    ? state.claim.evidence.map((item) => `<li>${item.label}<span>${item.capturedAt}</span></li>`).join("")
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

function renderActions(actions) {
  if (!actions.length) {
    els.actionList.innerHTML = "<li>No actions available yet.</li>";
    return;
  }
  els.actionList.innerHTML = actions.map((action) => `
    <li>
      <strong>${action.label}</strong>
      <span>${action.owner} authority - ${action.note}</span>
    </li>
  `).join("");
}

function renderRecords(state, happened) {
  const snapshot = {
    plainLabel: "Current snapshot",
    process: state.process,
    gate: state.gate,
    claim: state.claim,
    actions: state.actions
  };
  const payload = recordMode === "happened"
    ? happened.map((record) => ({
      at: record.at,
      product: record.product,
      type: record.type,
      ref: record.ref,
      links: record.links || []
    }))
    : snapshot;
  els.recordView.textContent = JSON.stringify(payload, null, 2);
}

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

render();
