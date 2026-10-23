# CrewLift

**Every change. A stronger plan.**

CrewLift turns a plain-language event update into two calculated staffing plans and a complete action pack. **NVIDIA Nemotron through Nebius Token Factory** interprets the change; CrewLift validates the planning rules, optimizes the roster, and prepares clear personal handoffs.

## Inspiration

A great community event brings people together. Every contribution matters: the person welcoming guests, the facilitator opening a workshop, the guide helping visitors find their way. We wanted an organizer to carry that same sense of connection into a changing schedule.

CrewLift starts with a simple idea: a recovery plan should support both the event and the people making it happen. Cover the roles, respect people's skills and availability, and give each affected volunteer a clear next step.

## What it does

The coordinator writes an update in everyday language. NVIDIA Nemotron turns that brief into structured planning rules, each linked to its supporting words. CrewLift then calculates two recovery options. **Keep the rhythm** preserves familiar assignments while minimizing the number of people whose plans change. **Share the energy** distributes assignments more evenly. Both prioritize filling the required places.

The coordinator compares the plans, inspects the roster, and accepts a complete result. That accepted revision becomes the starting point for the next change. The action pack brings the decision to the team: a roster CSV, a structured JSON plan, and personal handoff cards showing roles, rooms, times and change reasons.

In our verified live **Makers Morning** demonstration, a fictional eight-person event spans three one-hour periods. CrewLift fills **all 10 required places**, retains **seven original assignments**, and changes **three people's plans**. Independent exhaustive comparison establishes that three is the smallest affected crew compatible with full coverage for this scenario.

## How we built it

The application uses a Node.js service and a browser interface organized around a complete workflow: capture the change, choose a plan, connect the crew, and export the action pack.

The planning engine combines exact search with minimum-cost maximum flow. It checks skills, availability, simultaneous assignments, shift capacity and preserved assignments. A separate audit checks each returned roster. Versioned acceptance makes each approved result the baseline for the next recovery, and the exports preserve the revision and its supporting data.

The server calls **`nvidia/Nemotron-3_5-Lightning` on Nebius Token Factory**. Its context supplies the event's entity directory; the coordinator's brief supplies the changes. The model returns structured constraints and exact source passages. Run details expose the provider-returned model, token usage and plan fingerprints. The successful browser run was independently checked through all three exported formats.

## Challenges we rose to

The central design challenge was making “keep the team steady” precise. We defined the objective around **people whose plans change**, including people moving onto or off the roster. This makes the optimization reflect the coordinator's real handoff task.

We also gave language interpretation a clear contract: explicit constraint categories, event-specific IDs and complete supporting clauses. Each extracted change connects to the coordinator's original words before the planning engine acts on it.

For successive updates, each accepted plan becomes the next comparison baseline. A separate local continuation test verified a second recovery with full coverage and personal updates measured from the previously accepted plan.

## Accomplishments we are proud of

- **A verified model-to-action workflow:** real NVIDIA Nemotron inference through Nebius Token Factory, source-linked rules, two computed plans, an accepted revision and matching exports.
- **Precisely optimized sample recovery:** 10 of 10 required places covered, seven original assignments retained and three people to update.
- **Personal handoffs with continuity:** a complete action pack from the live browser run, plus two accepted revisions verified in the local continuation checks.
- **Independent engineering evidence:** 95 solver cases, exhaustive comparisons across 128,764 feasible rosters, 24 development tests and 10 HTTP workflow groups.

## What we learned

“A good plan” becomes much more useful when its goals are explicit. Counting affected people, preserving accepted decisions and showing personal changes turned the scheduling task into a coherent coordination experience.

We also learned the value of building the proof alongside the product. An independent solver oracle let us check the optimization itself, while versioned exports connected the computed result to the handoff a coordinator would actually use.

## What's next

We will bring CrewLift to campus and community organizers for hands-on evaluation. Their feedback will shape richer event scenarios and the next generation of personal handoffs, while preserving the clear, inspectable path from a change brief to a coordinated team.

CrewLift's ambition is simple: help every crew meet change with a clear plan and shared momentum.

## Built with

NVIDIA Nemotron · Nebius Token Factory · Node.js · JavaScript · HTML · CSS · minimum-cost maximum flow
