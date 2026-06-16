# The Fact-Checker That Says Yes — presenter's runbook

> How to present the grounded-answer demo. The whole talk is built on one move:
> get the audience to assume RAG + fact-check catches the error — then show it say
> **SUPPORTED** on a wrong answer. The gap between their expectation and the result
> *is* the wow. Everything else explains that moment.

**Audience:** technical design partner, careful AI buyer, or investor who's heard "we reduce hallucinations" a hundred times.
**Length:** 4–6 minutes.
**The one line to open and close with:** *"AI answers you can stand behind."*

---

## The arc (eight beats)

> The frame is **precision**, not refusal. Kontour answers exactly when it can and refuses exactly when it can't. Refusal is the *integrity behind a trustworthy answer*, not the headline. Establish the product (a confident grounded answer) BEFORE any trap.

### Beat 0 — The felt pain (15s, no slide)
> "You ask AI about your own data — *'what were Q3 sales for Alpha Corp?'* It gives you a confident number. You almost drop it in the board deck. Then you check: it made it up. Everyone who's pointed AI at real data has had this exact moment."

Don't oversell it. Let them nod.

### Beat 1 — The reasonable defense (30s) — *set the trap by being fair*
> "So you do the responsible thing. You don't just trust the model. You add **retrieval** — ground it in your real documents. And you add a **fact-checker** — a second pass that verifies the answer against the retrieved evidence. RAG + fact-check. This is what a careful team ships. This is the state of the art."

Critical: present this **as the smart, correct thing to do.** You are not mocking it. The whole proof depends on the audience believing this pipeline is *good*.

### Beat 2 — The product: a win (20s) — *what Kontour is FOR* (step `win-open`, W0)
> "First, what this is *for.* A user asks a question that **can** be answered — *'what was Gamma's Q3 revenue?'* There's a real record for the period asked. Kontour answers: **$900,000, grounded and verified** — and emits this portable trust bundle. **That's the product: a trustworthy answer.** Now watch what happens when the binding *doesn't* match."

Lead with the green panel. Don't rush it — this is the backdrop the whole proof stands against.

### Beat 3 — The precision pair (75s) — *same data, it knows the difference* (steps `w1` → `s1`)
First the **win** (w1, Alpha **Q2**): "This period exists. Does it answer it?" Reveal: **$451,000, verified.** Both Kontour and RAG get it right.
Then change **one word** — Q2 → Q3 (s1, the trap):
> "Same Alpha doc. Same $451k. The fact-checker checks it. **What does it say?**"

Let them assume it catches it. Then reveal:
> "**SUPPORTED.** Green check. And it's **wrong** — that $451k is **Q2**, you asked **Q3.** Kontour, off the **same record**, answered Q2 and **refused** Q3. **Same data — it knows the difference.** That's precision, not timidity."

This pairing is the heart of the rebalanced talk: refusal earns its credibility because the same machinery *answers* the twin.

### Beat 4 — Not a fluke (45s) — *more traps, more ways*
> "It's not a one-off. Same failure, three different shapes —"
- **s2 (stale):** "SUPPORTED — but the source was restated last week. The checker read a stale copy. Both agree, both wrong."
- **s4 (citation):** "SUPPORTED — the cited doc is real and the number's in it. Except it's the **forecast**, not the **actuals.** Right document, wrong line."

### Beat 5 — Why (the insight — 45s) — *this is the slide that earns the sale*
> "Look at the pattern. Every time, the fact-checker was *right* — the number really is in your evidence. The error was **never in the text.** It was in the **binding** — wrong period, wrong version, wrong location. A fact-checker reads text. It **structurally cannot see a binding error**, because the binding isn't in the text. You can't fix this by buying a better fact-checker. Checking *after* is the wrong shape."

### Beat 6 — The Kontour answer (45s) — *resolution*
> "So we don't check after. We change the shape. **Decompose** the question into the claims it needs — and each claim carries its binding: this value, this entity, this period, this source location. **Ground** each claim against a real source. Then **gate**: the answer can't be presented as verified unless every binding matches what was asked. When it matches, it **answers** — verified, with a bundle. When it doesn't, it **refuses.** Same gate, both outcomes."

### Beat 7 — The proof + close (30s) — *precision, not a refusal count*
> "And it's not 'trust me.' Every grounded claim emits a **portable trust bundle** — recomputable and auditable by someone who doesn't trust us. Across answerable questions and traps: on the **answerable** ones, Kontour and RAG **both answered correctly** — fine on the easy ones. On the **traps**, RAG shipped a wrong answer **every time**; Kontour **refused every time.** **Answered exactly when it could. Refused exactly when it couldn't. RAG+fact-check couldn't tell the two apart.** That's Kontour: **AI answers you can stand behind.**"

The close slide is a **precision board**, not a single refusal tally: answerable (Kontour N/N, RAG N/N) over traps (Kontour M/M refused, RAG M/M shipped wrong). All counts are harness-derived. The point to land: Kontour is **not** a refuse-everything box — that would be useless — it's a **precise discriminator.**

---

## Lead with the strong three (the traps)

Among the **trap** scenarios, present in this order of strength. Know the difference so a sharp audience can't catch you overclaiming:

| Scenario | Fact-check verdict | Strength |
|---|---|---|
| **s1 qualifier** | **SUPPORTED** | ⭐ unbeatable — checker endorses the wrong answer |
| **s2 stale** | **SUPPORTED** | ⭐ unbeatable |
| **s4 citation** | **SUPPORTED** | ⭐ unbeatable |
| s3 join | ABSTAIN | supporting — a maximally paranoid pipeline might catch it |
| s0 absence | ABSTAIN | supporting — the original "refuse-moment" |

**If someone pushes:** "Two of the five, the fact-checker *abstained* rather than endorsed — a maximally conservative pipeline could catch those. But three of five it actively said **SUPPORTED.** Those three are the point, and no fact-checker fixes them." Saying this *raises* your credibility.

## The honest caveat to volunteer (don't get caught on it)
> "The corpus here is ours — so a skeptic can say we wrote the data. The retriever and checker are genuinely real (we even made the checker *more* competent than it needed to be). The next build grounds one scenario in a real, un-riggable source — a live filing or web page — so the data isn't ours either."

Volunteering this beats getting cornered on it.

## What NOT to do
- Don't open with the architecture or the six primitives. Nobody buys primitives. Open with the product (the win), then the fact-checker saying yes on the trap.
- Don't call the RAG pipeline dumb. Its competence is the whole proof.
- Don't say "we guarantee correctness." We don't. We make the binding **visible and gated** — say exactly that.
- Don't let it sound like a refuse-everything box. Always show the **win backdrop** first and frame the close as **precision** — it answers when it can. A system that only refuses is useless; the discrimination is the value.

## Logistics
- **Live vs recorded:** live is stronger because the "what does it say?" prediction beat lands harder. If recorded, keep the pause before each verdict.
- **The single most important move:** make them predict the verdict before you show it. Every time.
- Terminal scoreboard (`npm run demo:grounded`) reads the **precision** framing: answerable (Kontour answered 2/2, RAG 2/2) over traps (Kontour refused 5/5, RAG shipped wrong 5/5), under the line *"Answered exactly when it could. Refused exactly when it couldn't."* — a good non-UI proof point that Kontour is a discriminator, not a refuse-box.
