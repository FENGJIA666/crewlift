# CrewLift — technology feedback

## How we used the technologies

We used **NVIDIA Nemotron (`nvidia/Nemotron-3_5-Lightning`) through Nebius Token Factory** to translate a coordinator's written event update into structured planning rules with exact supporting passages. CrewLift validates those rules, computes two recovery plans and produces a versioned action pack after the coordinator accepts a plan.

We connected our Node.js service to inference with native fetch through Token Factory's OpenAI-compatible interface. We configured the authorized API key on the server, defined a compact event directory and response schema, and connected the returned constraints to our existing solver and export workflow.

## What worked well

The recorded video workflow turned three sentences into the three intended changes: one volunteer's absence, an increased workshop requirement and one preserved assignment. Each change carried its complete supporting clause. That made the model's interpretation directly inspectable before the coordinator accepted the roster.

The provider-returned model identity and token usage gave us a clear way to connect the actual model call to the resulting plan. In the recorded browser run, both recovery options covered all 10 required places; the selected plan retained seven original assignments and changed three people's plans. Independent retrieval confirmed that its JSON, CSV and personal handoff exports matched the accepted revision.

## An opportunity to help the next builder

A complete worked example for nested structured output—with exact category names, zero-based evidence indexes, source-passage references and an explicit thinking-mode setting—would give builders a strong starting point for workflows like this. Our integration became precise when we made those contracts explicit and gave the model a compact directory of event entities and times.

## How we would build on this experience

We would use this combination again for tasks that connect human instructions to inspectable structured actions. CrewLift provides a clear pattern: NVIDIA Nemotron interprets the brief, deterministic tools validate and calculate, and the interface gives people a useful result they can review and act on. The next iteration will apply that pattern to richer event scenarios and feedback from campus and community organizers.

## Recorded implementation evidence

| Observation | Recorded video run |
| --- | --- |
| Provider-returned model | `nvidia/Nemotron-3_5-Lightning` |
| Extracted changes with complete source clauses | 3 |
| Recorded model inference duration | 2,667 ms |
| Returned token usage | 1,081 prompt + 210 completion = 1,291 total |
| Selected-plan outcome | 10/10 places, seven original assignments retained, three affected people |
| Accepted result | Revision one with matching JSON, CSV and handoff exports |

These observations come from the [verified live browser run](../evidence/live/final-ui-independent-verification.json) using the fictional Makers Morning event. The [separate isolated live acceptance](../evidence/live/verification-2026-10-23T16-50-14.475Z.json) also verifies the complete model-to-export sequence.

## Public deployment acceptance

We also verified the complete workflow in the [public application](https://crewlift-two.vercel.app): live interpretation, four source-linked rules, both recovery plans, revision-one acceptance and actual JSON, CSV and handoff downloads. The selected plan again covered all 10 required places, retained seven original assignments and affected three people. The public run recorded **1,703 ms of model inference**, **2,105 ms for the complete planning run**, and **1,452 returned tokens**. These are observations from this execution; the [public acceptance evidence](../evidence/deployment/public-acceptance-summary.json) records the corresponding run and exported artifacts.
