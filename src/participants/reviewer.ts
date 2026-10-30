import { Agent, createAgent, ModelMessageItem, SemanticEvent } from "@mozaik-ai/core"
import { handler, parseJsonAnswer } from "../handler.js"
import { verdictFormat } from "../plan.js"
import { runLoop, sendEvent, state } from "../runtime.js"
import { makeFileTools } from "../tools.js"

const REVIEWER_INSTRUCTION = `You are the reviewer of a software factory. The generated project's checks pass (typecheck and full test suite green); your job is to verify the code actually meets the original spec's acceptance criteria.

Use list_files and read_file to inspect every module under src/. Judge against the acceptance criteria and each module's responsibility — and judge ONLY on demonstrable evidence in the code:
- Reject only when you can point at the exact code (or its absence) that violates a stated criterion or contract. Quote the offending line or name the missing behaviour precisely.
- Speculative concerns are NOT grounds for rejection: hypothetical races, "not clearly verified", "no explicit guarantee", style preferences, robustness worries beyond the spec, or demands stricter than the spec's own text. The spec you were given is the whole contract — if the code implements what it says, approve, even if you would have designed it differently.
- The passing test suite is evidence in the code's favour; do not reject behaviour the tests demonstrate working unless the code plainly contradicts a criterion.
When something is genuinely unmet, name it in issues and put the responsible module id in issueTaskIds. Never write or edit files.`

const onTestsPassed = handler(
	(context) => {
		if (context.event.type !== "tests.passed") return false
		const s = state()
		return s.allDone() && !s.reviewStarted && s.reviewRounds < 3
	},
	(context) => {
		const agent = context.participant as Agent
		const s = state()
		s.reviewStarted = true
		s.reviewRounds += 1
		const brief = `Review the generated project now.

Project: ${s.plan?.projectName} — ${s.plan?.summary}

Original spec:
${s.specText}

Acceptance criteria:
${(s.plan?.acceptanceCriteria ?? []).map((c) => `- ${c}`).join("\n")}

Modules:
${(s.plan?.modules ?? []).map((m) => `- ${m.id}: ${m.modulePath} — ${m.responsibility}`).join("\n")}

Read every module under src/ with read_file, then return your verdict.`
		runLoop(agent.getId(), brief, {
			model: "gpt-5.4-mini",
			context: agent.getMemory().getContext(),
			tools: agent.getTools(),
			structuredOutput: verdictFormat,
			maxOutputTokens: 4000,
		})
	},
)

const onOwnAnswer = handler(
	(context) =>
		context.event.type === "model.answer" &&
		context.event.producerId === context.participant.getId() &&
		state().reviewStarted &&
		!state().finished,
	(context) => {
		const agent = context.participant as Agent
		const s = state()
		const { answer } = context.event.payload as { answer: ModelMessageItem }
		let verdict: { approved: boolean; issues: string[]; issueTaskIds: string[] }
		try {
			verdict = parseJsonAnswer(answer.content.text) as typeof verdict
		} catch {
			verdict = { approved: false, issues: ["Reviewer returned an unparseable verdict."], issueTaskIds: [] }
		}
		s.reviewVerdict = { approved: verdict.approved, issues: verdict.issues }

		if (verdict.approved) {
			s.finished = true
			s.success = true
			s.finishNote = "Test suite green and reviewer approved every acceptance criterion."
			sendEvent(
				SemanticEvent.create("build.complete", agent.getId(), { ok: true, note: s.finishNote }),
				agent.getId(),
			)
			return
		}

		const fixable = (verdict.issueTaskIds ?? []).filter((id) => {
			const task = s.taskById(id)
			return task && task.status === "done" && task.reviewFixRounds < 2
		})
		if (fixable.length === 0) {
			s.finished = true
			s.success = false
			s.finishNote = `Reviewer rejected with no fix rounds left: ${verdict.issues.join(" | ")}`
			sendEvent(
				SemanticEvent.create("build.complete", agent.getId(), { ok: false, note: s.finishNote }),
				agent.getId(),
			)
			return
		}
		fixable.forEach((taskId, i) => {
			sendEvent(
				SemanticEvent.create("fix.requested", agent.getId(), {
					taskId,
					issue: verdict.issues[i] ?? verdict.issues[0] ?? "Reviewer found an unmet criterion.",
				}),
				agent.getId(),
			)
		})
	},
)

export function makeReviewer() {
	return createAgent({
		name: "Reviewer",
		capabilities: ["review"],
		instruction: REVIEWER_INSTRUCTION,
		tools: makeFileTools(state().outDir),
		handlers: [onTestsPassed, onOwnAnswer],
	})
}
