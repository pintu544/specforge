import { Agent, createAgent, ModelMessageItem, SemanticEvent } from "@mozaik-ai/core"
import { handler, parseJsonAnswer } from "../handler.js"
import { planFormat } from "../plan.js"
import { Plan, producerName, runLoop, sendEvent, state } from "../runtime.js"

const PLANNER_INSTRUCTION = `You are the planner of a software factory. You receive a one-page product spec written in Markdown and turn it into a precise build plan for a small TypeScript project (a CLI or an HTTP API, whichever the spec asks for).

Rules for the plan:
- 3 to 6 modules. Each module is ONE file under src/ and has ONE test file under test/.
- If the spec names exact file paths, exported names, commands, routes, or function signatures, use them EXACTLY as written. Otherwise choose clear conventional names.
- Each module's responsibility must spell out exact exported function signatures with TypeScript types, behaviour, and error/edge-case handling, so a builder can implement it without seeing any other module's code. Where modules interact, describe the shared types in every module that uses them, identically.
- CONTRACT RULE (critical): when module A calls module B, A's responsibility must quote B's exported signatures VERBATIM — same names, same parameter types, same return types — exactly as they appear in B's own responsibility. Return types must be the plain values (e.g. Task[], Task, void), never wrapper objects, unless B's responsibility explicitly defines a wrapper type. A mismatch here is the most common way the build fails.
- ERROR RULE (critical): for every error case, the responsibility must state the EXACT error message string to throw, in quotes, e.g. throw new Error("Invalid task title"). Builders throw exactly that string; testers assert exactly that string. Where you do not pin a message, say "throws an Error" and nothing more specific. Do not invent validation rules the spec does not ask for — every extra rule is another way for code and tests to disagree.
- ERROR TYPE RULE (critical): if the plan signals HTTP statuses with an error type, exactly ONE module defines it as a real exported class, and its responsibility pins the exact field names (e.g. class HttpError extends Error with fields status and message). Every other module's responsibility must say it imports that class as a VALUE (import { HttpError } from the defining module — never import type) and throws new HttpError(status, message). Nobody fabricates look-alike error objects (no Object.assign(new Error(...), { status }) casts): a look-alike is not an instanceof the class, so the server's error mapping misses it and returns 500. The server module maps errors with instanceof against that one class and reads exactly the pinned field names.
- RESPONSE SHAPE RULE (critical): when the spec shows the shape of a returned or stored object, the responsibility must list that EXACT field set, field name by field name, and state that returned objects carry exactly those fields and no others. Extra fields (an internal id, an eventId the spec does not list, a timestamp the spec does not list) fail the tests, because tests deep-compare returned objects against the spec shape. Where an implementation needs extra bookkeeping, the responsibility must say it lives in a separate internal record that is never returned.
- DERIVED VALUE RULE (critical): when the spec defines a field as computed from other state (e.g. a tier's available is its quantity minus its tickets in held and paid orders), the responsibility must state that the value is recomputed from the underlying records every time the object is returned — never stored as a snapshot taken at creation. A stored snapshot goes stale the moment related state changes, and tests that only read fresh objects never notice.
- Prefer flat, simple contracts: functions return the value itself, throw Error on failure. Avoid result/envelope objects.
- ENTRY RULE (critical, HTTP API projects): exactly one module MUST be src/server.ts. It creates the HTTP server, reads the listening port from the PORT environment variable (and any other server env vars the spec names, e.g. HOLD_SECONDS), and starts listening when run as the entry point — the generated package.json runs node dist/src/server.js via npm start, so a project whose server never self-starts cannot be served at all. No other module may start a listener. The server module self-starts through a main-module guard that accepts BOTH names: process.argv[1] ends with "server.ts" OR "server.js". npm start runs the COMPILED .js file, so a guard written against the .ts name alone is false in production and the process exits silently without ever listening — while in-process tests, which listen manually, still pass and hide the defect. An UNCONDITIONAL top-level listen is equally wrong: tests import the module, and the import would bind the default port and crash the suite with EADDRINUSE. The both-names guard is the one correct shape.
- dependsOn lists the module ids whose exports this module imports.
- acceptanceCriteria copies the spec's verifiable requirements, one per item.
- The runtime is Node.js with strict TypeScript and NodeNext module resolution. No external runtime dependencies; only node: builtins.`

const onSpec = handler(
	(context) =>
		context.event.type === "message.sent" && producerName(context.event.producerId) === "Operator",
	(context) => {
		const agent = context.participant as Agent
		const { message } = context.event.payload as { message: string }
		state().specText = message
		runLoop(agent.getId(), message, {
			model: "gpt-5.4",
			reasoningEffort: "medium",
			context: agent.getMemory().getContext(),
			tools: [],
			structuredOutput: planFormat,
			maxOutputTokens: 6000,
		})
	},
)

const onOwnAnswer = handler(
	(context) =>
		context.event.type === "model.answer" &&
		context.event.producerId === context.participant.getId() &&
		!state().plan,
	(context) => {
		const agent = context.participant as Agent
		const { answer } = context.event.payload as { answer: ModelMessageItem }
		let plan: Plan
		try {
			plan = parseJsonAnswer(answer.content.text) as Plan
		} catch {
			state().finished = true
			state().success = false
			state().finishNote = "Planner did not return a parseable plan."
			sendEvent(
				SemanticEvent.create("build.complete", agent.getId(), {
					ok: false,
					note: state().finishNote,
				}),
				agent.getId(),
			)
			return
		}
		state().setPlan(plan)
		console.log(
			`\nPlan: ${plan.projectName} — ${plan.modules.length} modules: ${plan.modules.map((m) => m.id).join(", ")}\n`,
		)
		sendEvent(SemanticEvent.create("plan.ready", agent.getId(), { projectName: plan.projectName }), agent.getId())
		for (const task of state().tasks) {
			sendEvent(
				SemanticEvent.create("task.available", agent.getId(), { taskId: task.id }),
				agent.getId(),
			)
		}
	},
)

export const planner = createAgent({
	name: "Planner",
	capabilities: ["plan"],
	instruction: PLANNER_INSTRUCTION,
	tools: [],
	handlers: [onSpec, onOwnAnswer],
})
