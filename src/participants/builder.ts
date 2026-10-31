import { Agent, createAgent, ModelContext, SemanticEvent } from "@mozaik-ai/core"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { handler } from "../handler.js"
import { FactoryTask, runLoop, sendEvent, state } from "../runtime.js"
import { makeCheckTypesTool, makeFileTools } from "../tools.js"

const BUILDER_INSTRUCTION = `You are a builder in a software factory. You implement exactly ONE TypeScript module per task, writing it with the write_file tool.

Hard rules:
- Write exactly the file at the task's modulePath. Never write any other file. Never edit tests.
- Strict TypeScript, NodeNext module resolution: relative imports MUST end in .js (e.g. import { createStore } from "./store.js.js").
- Only node: builtins. No external packages. No default exports unless the task lists one.
- Export exactly the names the task lists, with the exact signatures from the responsibility text.
- Returned objects carry exactly the fields the responsibility lists for them — no extra fields (no internal ids, no foreign keys, no timestamps) on anything an exported function returns; tests deep-compare returned objects against the spec shape. Keep extra bookkeeping in separate internal records that are never returned.
- HTTP-boundary values: URL query strings are always strings. If your module receives a value that may come from a URL query (page, pageSize, filters, dates), accept the string form as well as the typed form, parse integer strings before validating, and validate the parsed value — a well-formed "1" must never fail validation just because it arrived as a string.
- After writing the file, call check_types. If an error names your file, fix it and check again — do not finish while your file has a compiler error. Errors naming other files are not yours to fix.
- After writing the file, reply with one short sentence naming the file. The file is the deliverable, not the reply.`

function moduleMap(): string {
	const s = state()
	return (s.plan?.modules ?? [])
		.map((m) => `- ${m.id}: ${m.modulePath} exports [${m.exports.join(", ")}]`)
		.join("\n")
}

function buildBrief(task: FactoryTask): string {
	const s = state()
	const depContracts = (s.plan?.modules ?? [])
		.filter((m) => task.dependsOn.includes(m.id))
		.map(
			(m) =>
				`--- Contract of ${m.id} (${m.modulePath}) — call its exports EXACTLY like this:\n${m.responsibility}`,
		)
		.join("\n\n")
	return `Build this module now.

Project: ${s.plan?.projectName} — ${s.plan?.summary}
Acceptance criteria:
${(s.plan?.acceptanceCriteria ?? []).map((c) => `- ${c}`).join("\n")}

All modules (import only from these, using .js specifiers):
${moduleMap()}
${depContracts ? `\nDependency contracts (verbatim — your calls must match these signatures):\n${depContracts}\n` : ""}
Your task:
- Module id: ${task.id}
- Write exactly this file: ${task.modulePath}
- Exports: ${task.exports.join(", ")}
- Depends on: ${task.dependsOn.join(", ") || "nothing"}
- Responsibility (follow it exactly):
${task.responsibility}

Use the write_file tool to write the complete file, then confirm in one sentence.`
}

function fixBrief(task: FactoryTask, problem: string): string {
	return `Your module ${task.modulePath} (module id ${task.id}) needs a fix.

Problem reported:
${problem}

Exports you must keep: ${task.exports.join(", ")}
Responsibility:
${task.responsibility}

How to fix:
1. Read your current file with read_file.
2. If the failure mentions another module or a test file, read those files too — their ACTUAL exported signatures are the ground truth. If your code calls a dependency differently from how that dependency is really written, fix YOUR calls to match the real signatures.
3. Rewrite your whole file with write_file. Do not write any other file, and never edit tests.
4. Call check_types: if an error still names your file, fix it and check again before confirming. Then confirm in one sentence.`
}

function startLoop(agent: Agent, brief: string): void {
	runLoop(agent.getId(), brief, {
		model: "gpt-5.4-mini",
		context: agent.getMemory().getContext(),
		tools: agent.getTools(),
		maxOutputTokens: 9000,
	})
}

function startFixLoop(agent: Agent, brief: string): void {
	// Fix loops start from a fresh context: the brief carries everything needed
	// (contract, exact errors, instruction to re-read the file), and a clean
	// context avoids stale failed attempts and runaway token growth.
	runLoop(agent.getId(), brief, {
		model: "gpt-5.4-mini",
		context: ModelContext.create(),
		tools: agent.getTools(),
		maxOutputTokens: 9000,
	})
}

const claimHandler = handler(
	(context) => {
		if (context.event.type !== "task.available" && context.event.type !== "task.completed") {
			return false
		}
		if (context.event.producerId === context.participant.getId()) return false
		const s = state()
		return s.ownedActive(context.participant.getId()).length === 0 && !!s.nextUnclaimed()
	},
	(context) => {
		const agent = context.participant as Agent
		const task = state().claimNext(agent.getId(), agent.getManifest().name)
		if (task) startLoop(agent, buildBrief(task))
	},
)

const testsFailedHandler = handler(
	(context) => {
		if (context.event.type !== "tests.failed") return false
		const { failedTaskIds } = context.event.payload as { failedTaskIds: string[] }
		const s = state()
		return (failedTaskIds ?? []).some((id) => {
			const task = s.taskById(id)
			return task?.ownerId === context.participant.getId() && task.status === "done"
		})
	},
	(context) => {
		const agent = context.participant as Agent
		const s = state()
		const { failedTaskIds, tail } = context.event.payload as {
			failedTaskIds: string[]
			tail: string
		}
		const { errors } = context.event.payload as { errors?: string[] }
		const task = (failedTaskIds ?? [])
			.map((id) => s.taskById(id))
			.find((t) => t?.ownerId === agent.getId() && t.status === "done")
		if (!task) return
		if (s.markFixing(task.id, tail)) {
			const errorBlock =
				errors && errors.length > 0
					? `Compiler errors reported (fix these first):\n${errors.join("\n")}\n\n`
					: ""
			startFixLoop(
				agent,
				fixBrief(task, `The generated project's checks failed.\n${errorBlock}Failure output (tail):\n${tail}`),
			)
		} else {
			s.markFailed(task.id)
		}
	},
)

const fixRequestedHandler = handler(
	(context) => {
		if (context.event.type !== "fix.requested") return false
		const { taskId } = context.event.payload as { taskId: string }
		const task = state().taskById(taskId)
		return task?.ownerId === context.participant.getId() && task.status === "done"
	},
	(context) => {
		const agent = context.participant as Agent
		const s = state()
		const { taskId, issue } = context.event.payload as { taskId: string; issue: string }
		const task = s.taskById(taskId)
		if (!task) return
		if (s.markReviewFixing(task.id, issue)) {
			startFixLoop(agent, fixBrief(task, `The reviewer reported: ${issue}`))
		} else {
			s.markFailed(task.id)
		}
	},
)

const ownAnswerHandler = handler(
	(context) =>
		context.event.type === "model.answer" &&
		context.event.producerId === context.participant.getId() &&
		state().ownedActive(context.participant.getId()).length > 0,
	(context) => {
		const agent = context.participant as Agent
		const s = state()
		const task = s.ownedActive(agent.getId())[0]
		const fileExists = existsSync(join(s.outDir, task.modulePath))
		if (!fileExists) {
			if (s.markFixing(task.id, "Builder finished without writing the file.")) {
				startFixLoop(
					agent,
					`You finished your previous turn WITHOUT calling write_file, so ${task.modulePath} does not exist. Write it now with the write_file tool.\n\n${buildBrief(task)}`,
				)
			} else {
				s.markFailed(task.id)
			}
			return
		}
		const wasFixing = task.status === "fixing"
		s.markDone(task.id)
		sendEvent(
			SemanticEvent.create(wasFixing ? "fix.completed" : "task.completed", agent.getId(), {
				taskId: task.id,
			}),
			agent.getId(),
		)
	},
)

export function makeBuilder(name: string) {
	return createAgent({
		name,
		capabilities: ["build", "fix"],
		instruction: BUILDER_INSTRUCTION,
		tools: [...makeFileTools(state().outDir), makeCheckTypesTool(state().outDir)],
		handlers: [claimHandler, testsFailedHandler, fixRequestedHandler, ownAnswerHandler],
	})
}
