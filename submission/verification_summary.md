# CrewLift — verified results

Recorded on 24 October 2026, Singapore time. Makers Morning is a fictional eight-person event used to demonstrate and verify CrewLift's coordination workflow.

## From a written change to a complete handoff

The final live demonstration uses **NVIDIA Nemotron (`nvidia/Nemotron-3_5-Lightning`) through Nebius Token Factory**. The model extracts three intended changes and their complete supporting clauses. CrewLift validates the rules, computes two recovery options, accepts the selected plan as revision one, and produces matching JSON, CSV and personal handoff exports.

| Selected-plan result | Verified value |
| --- | --- |
| Required places covered | **10 / 10** |
| Original assignments retained | **7** |
| People whose plans change | **3** |
| Accepted revision | **1** |
| Roster CSV assignment rows | **10** |
| Personal handoff cards | **3** |

The [live browser verification](../evidence/live/final-ui-independent-verification.json) independently checks the returned model identity, full source clauses, accepted roster and exported contents. The [isolated live acceptance](../evidence/live/verification-2026-10-23T16-50-14.475Z.json) verifies the same complete workflow through a separate actual inference call. The exported [action brief](../evidence/live/final-ui-accepted-r1-handoff.txt), [roster CSV](../evidence/live/final-ui-accepted-r1-plan.csv) and [JSON plan](../evidence/live/final-ui-accepted-r1-plan.json) are available for inspection.

## Two useful choices

**Keep the rhythm** fills all required places while minimizing the number of people whose plans change. Independent exhaustive comparison of **124,740 feasible complete or partial rosters** establishes that three affected people is the minimum for the demonstration scenario.

**Share the energy** also fills all 10 places. It spreads assignments more evenly, with a squared workload sum of 16 compared with 24 for the minimum-change plan. Seven people's plans change in this alternative. See the [same-run balanced result](../evidence/live/final-ui-balanced-plan.json).

An affected person is any volunteer whose set of task IDs differs from the comparison baseline, including a person moving off the roster or onto it from standby. Assignment additions and removals are measured separately; the first recovery has five such changes.

## Independent product checks

| Recorded check family | Result | Evidence |
| --- | --- | --- |
| Independent solver cases | **95 passed** | [Solver report](../evidence/solver-verification.json) |
| Exhaustive comparisons | **128,764 feasible rosters** across the compared cases | [Solver report](../evidence/solver-verification.json) |
| Development tests | **24 passed** in the recorded product verification | [Test results](../evidence/developer-tests.tap) |
| HTTP workflow groups | **10 passed** | [Workflow report](../evidence/api-verification.json) |

The independent oracle rebuilds requirements from raw constraints and checks skills, availability, simultaneous assignments, capacity and preserved roles. It compares objective values without importing the production scoring or optimization helpers. The exhaustive comparisons cover 91 small cases and the default full demonstration; three additional full demonstration cases receive independent validity and metric audits.

## Continuity through the next change

A separate local continuation test accepts a second recovery after another absence. The result again fills all 10 places, and each personal change is measured from the previous accepted plan. Revision one remains exportable after revision two is accepted. Inspect the [second accepted plan](../evidence/accepted-r2.json), [CSV](../evidence/accepted-r2.csv) and [handoff](../evidence/accepted-r2-handoff.txt).

## Reproduce the checks

```sh
npm test
node scripts/verify-solver.mjs
node scripts/verify-api.mjs
```

These checks use the fictional event and offline model transport. To run actual inference with an authorized account, follow the README's Nebius setup and use `scripts/verify-live.mjs`. The published live artifacts record the provider-returned model and observed request metadata for the demonstrated execution.
