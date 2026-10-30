# SpecForge

**A software factory on [Mozaik](https://mozaik.jigjoy.ai): a team of AI agents that turns a one-page Markdown spec into a working, tested TypeScript project — with no human writing or editing the code.**

Built for the **NTP Novi Sad Hackathon** (JigJoy × Science and Technology Park Novi Sad), Track 01 — Software Factory.

```bash
npm install
cp .env.example .env   # add your OPENAI_API_KEY
npm start -- specs/taskledger-cli.md output/taskledger
```

One command runs the factory on a spec file. It prints a live event trace and ends with a run summary; the generated project and a machine-readable trace land in the output directory.

## What it produces

From a spec like [`specs/taskledger-cli.md`](specs/taskledger-cli.md) the factory produces a complete TypeScript project (CLI or HTTP API, whatever the spec asks for): strict TypeScript sources under `src/`, a `node:test` suite under `test/`, and a gate of `tsc --noEmit && tsx --test` that must go green before the run can succeed.

A verified demo run lives under [`examples/taskledger`](examples/taskledger) — the generated project plus its `run-log.json` trace:

| Example | Spec | Result | Time | Human interventions |
|---|---|---|---|---|
| TaskLedger CLI | `specs/taskledger-cli.md` | ✅ suite green (18/18), reviewer approved, 0 fix rounds | 140 s | 0 |

A second sample spec, [`specs/notes-api.md`](specs/notes-api.md) (an HTTP API), is included in `specs/`. Its best run reached 24/25 tests green; the remaining failure was an entry-point test that hung the suite — the hardest failure mode we found, documented honestly rather than hidden.

## The team

Nine participants share one Mozaik `AgenticEnvironment`. There is **no orchestrator loop**: work is pulled, not pushed — participants react to events on the shared bus and claim work from shared state.

| Participant | Role |
|---|---|
| **Operator** (human) | Submits the spec, receives the final report. |
| **Planner** (gpt-5.4) | Turns the spec into a structured plan: modules, file paths, verbatim interface contracts, pinned error messages, acceptance criteria. |
| **Builder × 3** (gpt-5.4-mini) | Race to claim module tasks from shared state and implement them **in parallel**, one file each. They self-check with the TypeScript compiler before finishing. |
| **TestWriter** (gpt-5.4-mini) | As each module lands, reads it and writes its `node:test` file. |
| **TestRunner** (deterministic, no LLM) | Runs `npm install` once, then the project's gate (`tsc --noEmit && tsx --test`) — but only against complete builds. Parses failures and attributes them: compiler error in a `src/` file → that module's builder; broken or mis-written test → back to the TestWriter. |
| **Reviewer** (gpt-5.4-mini) | After the suite goes green, verifies the code against the spec's acceptance criteria — rejection only on demonstrable evidence in the code, never on speculation. |
| **Observer** (deterministic) | Logs every event with timestamps and collects per-inference token usage into the run trace. |

## How the concurrency works

- The Planner emits one `task.available` event per module. All three Builders subscribe to the same event; a synchronous claim method on the shared state makes check-and-claim atomic, so each module gets exactly one owner and the builders fan out in parallel — the trace shows their inferences overlapping.
- The TestWriter reacts to each `task.completed` while other builders are still mid-build, so test writing overlaps implementation.
- The TestRunner reacts to `tests.written` / `fix.completed`; fixes happen in parallel across builders (each owns its module), while the TestWriter can be revising a test at the same time.
- Coordination is entirely through semantic events (`task.available`, `task.completed`, `tests.written`, `tests.passed`, `tests.failed`, `tests.revise`, `fix.requested`, `fix.completed`, `build.complete`) and the shared `FactoryState` — no participant calls another directly, and there is no predefined workflow graph.

## Autonomy: how it notices and fixes its own mistakes

- **Compiler self-check.** Builders and the TestWriter can call a `check_types` tool and must clear errors in their own file before finishing.
- **Failure attribution.** The TestRunner parses compiler errors and test crashes to decide *whose* bug a failure is. Test-authoring defects (ESM `require()` crashes, monkey-patched module namespaces, assertions stricter than the pinned contracts) are routed to the TestWriter for revision instead of burning builder fix rounds.
- **Fix loops with budgets.** A builder gets up to 3 test-fix rounds and 2 reviewer-fix rounds per module, each starting from a fresh context with the exact compiler errors on top. Exhausted budgets mark the module **failed** — reported in the summary, never hidden.
- **Watchdog.** A task stuck for 8 minutes is requeued once or marked failed; a stalled or over-time run is terminated with an honest summary.
- **Complete-build gating.** The suite never runs against a half-built project, so partial-state noise can't consume fix budgets.

## Transparency: the run trace

Every run writes `run-log.json` into the output directory:

- per-task owner, status, wall-clock seconds, and fix rounds;
- every test run's result (with the failure tail);
- token usage in total and per agent (the cost trace);
- the full timestamped event log;
- `humanInterventions` — the count of mid-run human inputs. **It is 0 for every run in this repo.** If a person ever nudges a run, the factory's contract is to count it here.

## Repository layout

```
src/
  main.ts            entry point, deterministic scaffold, watchdog, run summary
  runtime.ts         FactoryState (shared state) + Mozaik runtime wiring
  plan.ts            structured-output schemas for the plan and the review verdict
  tools.ts           write_file / read_file / list_files / check_types tools
  participants/      planner, builder, testwriter, testrunner, reviewer, observer, operator
specs/               demo specs the factory can build
examples/            verified generated projects + their run traces
```

## Notes

- Models: Planner `gpt-5.4`; builders/tester/reviewer `gpt-5.4-mini`. Provider key via `OPENAI_API_KEY` (Mozaik also supports Anthropic and Gemini model names).
- The generated projects have zero runtime dependencies: Node.js builtins only.
- Built during the hackathon (Oct 30–31, 2026). AI-assisted development, per the event rules.
