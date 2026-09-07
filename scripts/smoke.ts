/* Headless smoke test: exercise scoring → ranking → decision → simulation →
 * memory → strategy across many cycles to validate the engine end to end. */
import { SAMPLE_OPPORTUNITIES, INITIAL_DISCOVERY_IDS } from '../src/data/sampleData';
import { scoreOpportunity } from '../src/lib/scoring';
import { simulateExperiment, experimentBudget } from '../src/lib/simulation';
import { openingLedger, record as ledgerRecord, balanceFrom } from '../src/services/wallet';
import { advanceStage, scoreAll, rankOpportunities } from '../src/services/research';
import { decide, strategyFromMemory } from '../src/services/ai';
import { recordResult, lessonFromExperiment } from '../src/services/memory';
import type { Experiment, Opportunity } from '../src/types';

function uid(p: string) { return `${p}-${Math.random().toString(36).slice(2, 9)}`; }

let opps: Opportunity[] = SAMPLE_OPPORTUNITIES.map((o) => ({ ...o }));
opps = advanceStage(opps, INITIAL_DISCOVERY_IDS, 'RANKED');
opps = scoreAll(opps);

let txs = openingLedger(50);
let memory: ReturnType<typeof recordResult> = [];
const experiments: Experiment[] = [];
let dead = false;

// Discover + score all remaining first (fast-forward research)
let undiscovered = opps.filter((o) => o.researchStage === 'UNDISCOVERED');
while (undiscovered.length > 0) {
  const ids = undiscovered.slice(0, 6).map((o) => o.id);
  opps = advanceStage(opps, ids, 'RANKED');
  opps = scoreAll(opps);
  undiscovered = opps.filter((o) => o.researchStage === 'UNDISCOVERED');
}
opps = rankOpportunities(opps);

console.log(`Loaded ${opps.length} opportunities, all scored.`);
const top5 = opps.filter(o => !o.executionBlocked).slice(0, 5);
for (const t of top5) console.log(`  ${t.score!.total}  ${t.name}  [${t.score!.recommendation}]`);
const blocked = opps.filter((o) => o.executionBlocked);
console.log(`Blocked finance models: ${blocked.map((b) => b.name).join('; ')}`);

for (let cycle = 1; cycle <= 12 && !dead; cycle++) {
  const ranked = rankOpportunities(opps);
  const decision = decide(ranked, memory, txs);
  if (!decision.selected) { console.log(`Cycle ${cycle}: no candidate`); break; }
  const balance = balanceFrom(txs);
  const budget = experimentBudget(decision.selected, balance);
  txs = ledgerRecord(txs, { type: 'EXPENSE', amount: -budget, description: `test ${decision.selected.name}` });
  const mem = memory.find((m) => m.kind === 'opportunity' && m.refId === decision.selected.id);
  const sim = simulateExperiment({ opportunity: decision.selected, budget, memory: mem });
  if (sim.actualRevenue > 0)
    txs = ledgerRecord(txs, { type: 'REVENUE', amount: sim.actualRevenue, description: 'rev' });
  const exp: Experiment = {
    id: uid('exp'), cycleId: null, opportunityId: decision.selected.id,
    opportunityName: decision.selected.name, category: decision.selected.category,
    objective: '', startingBudget: budget, plannedAction: '', expectedOutcome: '',
    actualCost: sim.actualCost, actualRevenue: sim.actualRevenue,
    profitLoss: sim.actualRevenue - sim.actualCost,
    roi: Math.round(((sim.actualRevenue - sim.actualCost) / sim.actualCost) * 100),
    outcome: sim.outcome, durationDays: sim.durationDays,
    lessonsLearned: sim.lessons, evidenceNote: sim.evidenceNote, simulated: true,
    createdAt: Date.now(),
  };
  experiments.push(exp);
  memory = recordResult(memory, exp, decision.selected);
  memory = [lessonFromExperiment(exp), ...memory];
  const bal = balanceFrom(txs);
  console.log(
    `Cycle ${cycle}: ${decision.outcome === undefined ? '' : ''}${decision.selected.name.slice(0, 42).padEnd(42)} ` +
    `budget $${budget.toFixed(2)} -> ${sim.outcome.padEnd(15)} rev $${sim.actualRevenue.toFixed(2).padStart(7)}  balance $${bal.toFixed(2)}`,
  );
  if (bal <= 0) { dead = true; console.log('AGENT DIED'); }
}

const { strategy, objective } = strategyFromMemory(memory, balanceFrom(txs), 5);
console.log(`\nFinal balance: $${balanceFrom(txs).toFixed(2)}`);
console.log(`Experiments: ${experiments.length} | winners: ${experiments.filter(e => e.outcome === 'SUCCESS').length}`);
console.log(`Strategy: ${strategy}`);
console.log(`Objective: ${objective}`);
console.log(opps.find((o) => o.id === 'opp-forex')!.executionBlocked === true ? 'OK: forex blocked from auto-execution' : 'ERROR');
console.log(opps.find((o) => o.id === 'opp-ai-websites')!.score!.total >= 70 ? 'OK: AI websites score high' : 'WARN: ai-websites score lower than expected');
