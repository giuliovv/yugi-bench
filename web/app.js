// Scripted UI trace only. The real engine will supply observations and legal actions.
const cards = [
  { id: "mystic", name: "Mystic Tomato", type: "MONSTER", tone: "earth" },
  { id: "goat", name: "Scapegoat", type: "QUICK-PLAY", tone: "sage" },
  { id: "book", name: "Book of Moon", type: "QUICK-PLAY", tone: "blue" },
  { id: "sakuretsu", name: "Sakuretsu Armor", type: "TRAP", tone: "amber" },
  { id: "fide", name: "Faith", type: "MONSTER", tone: "rose" },
];

const stages = [
  { phase: "TURN 01 · MAIN PHASE 1", hand: cards, ownMonster: null, ownSpell: null, opponentMonster: null, actions: [
    { id: "normal-summon", label: "Normal Summon Mystic Tomato", detail: "Face-up Attack Position", next: 1 },
    { id: "set-trap", label: "Set Sakuretsu Armor", detail: "Place in Spell / Trap Zone", next: 5 },
  ] },
  { phase: "TURN 01 · MAIN PHASE 1", hand: cards.filter(c => c.id !== "mystic"), ownMonster: { label: "M. TOMATO", tone: "earth" }, ownSpell: null, opponentMonster: null, actions: [
    { id: "set-trap", label: "Set Sakuretsu Armor", detail: "Place in Spell / Trap Zone", next: 2 },
    { id: "end-turn", label: "End turn", detail: "Pass priority to your opponent", next: 3 },
  ] },
  { phase: "TURN 01 · MAIN PHASE 1", hand: cards.filter(c => !["mystic", "sakuretsu"].includes(c.id)), ownMonster: { label: "M. TOMATO", tone: "earth" }, ownSpell: { label: "SET", tone: "amber" }, opponentMonster: null, actions: [
    { id: "end-turn", label: "End turn", detail: "Pass priority to your opponent", next: 4 },
  ] },
  { phase: "TURN 02 · OPPONENT MAIN PHASE", hand: cards.filter(c => c.id !== "mystic"), ownMonster: { label: "M. TOMATO", tone: "earth" }, ownSpell: null, opponentMonster: { label: "MONSTER", tone: "blue" }, actions: [
    { id: "finish", label: "Inspect trace", detail: "This is the end of the prototype sequence", next: null },
  ] },
  { phase: "TURN 02 · OPPONENT MAIN PHASE", hand: cards.filter(c => !["mystic", "sakuretsu"].includes(c.id)), ownMonster: { label: "M. TOMATO", tone: "earth" }, ownSpell: { label: "SET", tone: "amber" }, opponentMonster: { label: "MONSTER", tone: "blue" }, actions: [
    { id: "finish", label: "Inspect trace", detail: "This is the end of the prototype sequence", next: null },
  ] },
  { phase: "TURN 01 · MAIN PHASE 1", hand: cards.filter(c => c.id !== "sakuretsu"), ownMonster: null, ownSpell: { label: "SET", tone: "amber" }, opponentMonster: null, actions: [
    { id: "normal-summon", label: "Normal Summon Mystic Tomato", detail: "Face-up Attack Position", next: 2 },
    { id: "end-turn", label: "End turn", detail: "Pass priority to your opponent", next: 6 },
  ] },
  { phase: "TURN 02 · OPPONENT MAIN PHASE", hand: cards.filter(c => c.id !== "sakuretsu"), ownMonster: null, ownSpell: { label: "SET", tone: "amber" }, opponentMonster: { label: "MONSTER", tone: "blue" }, actions: [
    { id: "finish", label: "Inspect trace", detail: "This is the end of the prototype sequence", next: null },
  ] },
];

let stageIndex = 0;
let trace = [];
let finished = false;
const byId = id => document.getElementById(id);

function renderSlots(target, occupied) {
  byId(target).innerHTML = Array.from({ length: 5 }, (_, index) =>
    index === 2 && occupied
      ? `<div class="zone-card ${occupied.tone}"><span>✦</span><b>${occupied.label}</b></div>`
      : '<div class="empty-slot" aria-hidden="true"><span>◇</span></div>'
  ).join("");
}

function render() {
  const stage = stages[stageIndex];
  byId("phase-label").textContent = finished ? "TRACE COMPLETE" : stage.phase;
  byId("decision-number").textContent = String(trace.length + 1).padStart(2, "0");
  byId("action-count").textContent = String(finished ? 0 : stage.actions.length).padStart(2, "0");
  byId("hand-count").textContent = stage.hand.length;
  byId("own-deck").textContent = "34";
  byId("opponent-deck").textContent = stageIndex >= 3 ? "33" : "34";
  renderSlots("own-monsters", stage.ownMonster);
  renderSlots("own-spell-zones", stage.ownSpell);
  renderSlots("opponent-monsters", stage.opponentMonster);
  renderSlots("opponent-spell-zones", null);
  byId("hand").innerHTML = stage.hand.map(card => `<div class="hand-card ${card.tone}" title="${card.name}"><span>${card.type}</span><strong>${card.name}</strong><small>YB / SAMPLE</small></div>`).join("");
  byId("actions").innerHTML = !finished && stage.actions.length
    ? stage.actions.map((action, index) => `<button class="action-button" data-action="${index}" type="button"><span class="action-index">${String(index + 1).padStart(2, "0")}</span><span><strong>${action.label}</strong><small>${action.detail}</small></span><span class="action-arrow" aria-hidden="true">↗</span></button>`).join("")
    : '<div class="action-end">End of sample trace. Reset to explore another decision path.</div>';
  byId("trace-count").textContent = `${String(trace.length).padStart(2, "0")} STEPS`;
  byId("trace-list").innerHTML = trace.length
    ? trace.map((entry, i) => `<li><span>${String(i + 1).padStart(2, "0")}</span>${entry}</li>`).join("")
    : '<li class="trace-empty">No choices recorded yet.</li>';
}

byId("actions").addEventListener("click", event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = stages[stageIndex].actions[Number(button.dataset.action)];
  trace.push(action.label);
  if (action.next === null) finished = true;
  else stageIndex = action.next;
  render();
});

byId("reset-demo").addEventListener("click", () => {
  stageIndex = 0;
  trace = [];
  finished = false;
  render();
});

render();
