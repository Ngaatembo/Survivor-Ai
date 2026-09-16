/* ============================================================================
 * Mission ladder smoke test (Survivor 2.0 §10): verifies targets scale
 * correctly with actual starting capital, missions complete in order as
 * the balance rises, lessons get recorded, and the repository round-trip
 * works. Run with:
 *   npx tsx scripts/missions.smoke.ts
 * ========================================================================== */

import { buildMissionLadder, evaluateMissions, currentMission } from '../src/lib/missions';
import { InMemoryRepository } from '../src/engine/inMemoryRepository';

let failures = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    console.log(`  OK: ${label}`);
  } else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

console.log('--- buildMissionLadder: targets scale with actual starting capital ---');
{
  const ladder50 = buildMissionLadder(50);
  assert(ladder50.length === 5, `ladder has 5 steps (got ${ladder50.length})`);
  assert(ladder50[0].targetBalance === 51, `mission 1 targets one dollar of profit (got ${ladder50[0].targetBalance})`);
  assert(ladder50[2].targetBalance === 100, `mission 3 (2x) targets $100 for $50 starting capital (got ${ladder50[2].targetBalance})`);
  assert(ladder50.every((m) => m.status === 'ACTIVE'), 'every mission starts ACTIVE (currentMission picks the earliest incomplete one)');

  const ladder200 = buildMissionLadder(200);
  assert(ladder200[2].targetBalance === 400, `targets scale correctly for a different starting capital (2x of $200 = $400, got ${ladder200[2].targetBalance})`);
  assert(
    ladder200[2].targetBalance !== ladder50[2].targetBalance,
    'the ladder never uses flat hardcoded dollar figures — it always scales with actual starting capital',
  );
}

console.log('--- currentMission: always the earliest incomplete mission ---');
{
  const ladder = buildMissionLadder(50);
  assert(currentMission(ladder)?.sequence === 1, 'with a fresh ladder, mission 1 is current');

  const afterFirst = ladder.map((m) => (m.sequence === 1 ? { ...m, status: 'COMPLETED' as const } : m));
  assert(currentMission(afterFirst)?.sequence === 2, 'once mission 1 completes, mission 2 becomes current');

  const allDone = ladder.map((m) => ({ ...m, status: 'COMPLETED' as const }));
  assert(currentMission(allDone) === undefined, 'once the whole ladder is complete, there is no current mission (never fabricated)');
}

console.log('--- evaluateMissions: completes in order as balance rises, records a lesson ---');
{
  const ladder = buildMissionLadder(50); // targets: 51, 62.5, 100, 250, 500
  const afterLowBalance = evaluateMissions(ladder, 40);
  assert(afterLowBalance.every((m) => m.status === 'ACTIVE'), 'balance below every target -> nothing completes');

  const afterMission1 = evaluateMissions(ladder, 55);
  assert(afterMission1.find((m) => m.sequence === 1)?.status === 'COMPLETED', 'balance past mission 1 target completes it');
  assert(afterMission1.find((m) => m.sequence === 2)?.status === 'ACTIVE', 'mission 2 stays ACTIVE (its own target not yet reached)');
  assert((afterMission1.find((m) => m.sequence === 1)?.lessonsLearned.length ?? 0) > 0, 'a completed mission records a lesson line');
  assert(!!afterMission1.find((m) => m.sequence === 1)?.completedAt, 'a completed mission records a completion timestamp');

  const afterBigJump = evaluateMissions(ladder, 300);
  assert(
    afterBigJump.filter((m) => m.status === 'COMPLETED').length === 4,
    `a big balance jump completes every mission whose target it clears (got ${afterBigJump.filter((m) => m.status === 'COMPLETED').length})`,
  );
  assert(afterBigJump.find((m) => m.sequence === 5)?.status === 'ACTIVE', 'the final $500 mission stays ACTIVE at balance $300');

  const alreadyCompleted = evaluateMissions(afterMission1, 40);
  assert(
    alreadyCompleted.find((m) => m.sequence === 1)?.status === 'COMPLETED',
    'a completed mission never reverts to ACTIVE even if balance later drops',
  );
}

console.log('--- Repository round-trip ---');
{
  (async () => {
    const repo = new InMemoryRepository();
    const ladder = buildMissionLadder(50);
    await repo.upsertMissions(ladder);
    const listed = await repo.listMissions();
    assert(listed.length === 5, 'the full ladder round-trips through the repository');
    assert(listed[0].objective === ladder[0].objective, 'mission content is preserved through the round-trip');

    const evaluated = evaluateMissions(listed, 60);
    await repo.upsertMissions(evaluated);
    const afterUpdate = await repo.listMissions();
    assert(afterUpdate.find((m) => m.sequence === 1)?.status === 'COMPLETED', 'upserting the evaluated ladder persists completion');
    assert(afterUpdate.length === 5, 'upserting the full ladder replaces it cleanly, without duplicating missions');

    console.log(failures === 0 ? `\nAll checks passed.` : `\n${failures} check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
  })();
}
