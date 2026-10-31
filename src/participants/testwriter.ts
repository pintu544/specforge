import { Agent, createAgent, SemanticEvent } from "@mozaik-ai/core"
import { handler } from "../handler.js"
import { FactoryTask, runLoop, sendEvent, state } from "../runtime.js"
import { makeCheckTypesTool, makeFileTools } from "../tools.js"

const TESTWRITER_INSTRUCTION = `You are the test writer of a software factory. For each finished module you write its test file with the write_file tool.

Hard rules:
- First read the module with read_file. Then write exactly the test file at the given testPath. Never write or edit any other file.
- The project is pure ESM ("type": "module"). NEVER use require() — it crashes the whole test file. Every import is an ES import: import { test } from "node:test"; import assert from "node:assert/strict"; import { execFileSync } from "node:child_process"; and so on.
- Use node:test and node:assert/strict only: import { test } from "node:test"; import assert from "node:assert/strict".
- Import the module under test with a .js specifier, e.g. import { ... } from "../src/store.js.js".
- Cover every exported name: happy paths plus the edge cases and error behaviour in the module's responsibility text.
- Tests must be deterministic: no network, no timers, no randomness. For file-system modules use a fresh temp directory (node:os tmpdir + node:fs) per test.
- HTTP server tests: a server returned by a factory function is NOT listening until you listen on it. Before any request, listen on an ephemeral port — await new Promise<void>((resolve) => server.listen(0, resolve)) — derive the port from server.address(), and close the server afterwards (in a finally block if the test can throw). NEVER send a request to an unlistened server: its address() is null, the request defaults to port 80, and the resulting ECONNREFUSED is a bug in your test, not in the server.
- When revising failing tests, recompute EVERY expectation from the responsibility text before rewriting — including dates and quantities in your own setup. If the implementation already matches the responsibility, the TEST is wrong: change the test's scenario or expectation, never bend the expectation toward the old test. Two concrete traps: a time-window rule (e.g. "only while the event starts more than 24 hours from now") must be evaluated against your test's own clock, and an availability rule (e.g. "only when the tier has fewer than quantity tickets available") against your test's own setup quantities.
- Build every asserted state honestly from your own setup. A fixed clock never advances: an order created under a fixed "now" is never expired, so to test expiry you MUST use a mutable clock (a variable your now() reads) and advance it past expiresAt between creation and assertion. Never assert a state transition your setup cannot produce.
- Before asserting any waitlist outcome, compute available yourself from your setup: available = tier quantity minus tickets in held and paid orders. Joining succeeds exactly when available < quantity and fails otherwise; a sold-out tier (available 0) with quantity 1 therefore SUCCEEDS. Do not assert 409 for a join your own numbers allow.
- Test the SPEC, not the implementation's quirks: if the code disagrees with the responsibility text, the test must follow the responsibility text.
- Assert ONLY what the responsibility pins down. Exact error messages may be asserted only when the responsibility quotes the exact string; otherwise assert that it throws an Error (assert.throws(fn, Error)) without matching the message. Never invent exact messages, exact output wording beyond what the spec quotes, or extra validation rules.
- NEVER mock, stub, or monkey-patch module imports — not even through a cast like (module as any).someExport = .... ES module namespaces are frozen: the assignment either fails to compile or crashes at runtime with "Cannot assign to read only property". Test through public behaviour only: call the exported functions directly, isolate state with temp files and environment variables (e.g. TASKLEDGER_FILE), and for CLI-style modules call the exported main(argv) against a real temp data file and capture console.log/console.error by temporarily replacing them (console methods are writable) and restoring them afterwards.
- If a test spawns a child process, the child must load TypeScript through tsx (spawn "npx", ["tsx", file]) — plain node cannot load .ts files or resolve .js specifiers to .ts sources, so such tests fail for reasons unrelated to the code. Prefer in-process tests (import the module, call its exports) over subprocess tests wherever possible.
- After writing the test file, call check_types. If an error names your test file, fix it and check again — do not finish while your test file has a compiler error. Errors naming src/ files are not yours to fix.
- After writing the file, reply with one short sentence.`

interface QueueItem {
	taskId: string
	reviseTail?: string
}

const queue: QueueItem[] = []
let current: QueueItem | undefined
let self: Agent | undefined

function briefFor(task: FactoryTask, reviseTail?: string): string {
	const base = `Write the test file for one module.

- Module file: ${task.modulePath}
- Test file to write: ${task.testPath}
- Exports to cover: ${task.exports.join(", ")}
- Responsibility (the spec for this module):
${task.responsibility}

Read ${task.modulePath} with read_file first, then write ${task.testPath} with write_file.`
	if (reviseTail) {
		return `${base}

The previous version of these tests is part of the problem and the suite is failing. Rewrite the test file from scratch so it asserts exactly what the responsibility text says — no more, no less.
CRITICAL: never stub, replace, mock, or reassign an imported binding or module namespace property (patterns like (module as any).someExport = ... crash at runtime with "Cannot assign to read only property" — ESM namespaces are frozen). Test the REAL code end-to-end: call the exported functions or main(argv) directly, isolate state with temp files and environment variables, and assert on return values, captured console output, and file contents.
Failure output (tail):
${reviseTail}`
	}
	return base
}

function maybeStart(): void {
	if (current || !self) return
	const item = queue.shift()
	if (!item) return
	const task = state().taskById(item.taskId)
	if (!task) {
		maybeStart()
		return
	}
	current = item
	runLoop(self.getId(), briefFor(task, item.reviseTail), {
		model: "gpt-5.4-mini",
		context: self.getMemory().getContext(),
		tools: self.getTools(),
		maxOutputTokens: 9000,
	})
}

const onTaskCompleted = handler(
	(context) => context.event.type === "task.completed" && context.event.producerId !== context.participant.getId(),
	(context) => {
		self = context.participant as Agent
		const { taskId } = context.event.payload as { taskId: string }
		const s = state()
		if (s.testsRequested.has(taskId)) return
		s.testsRequested.add(taskId)
		queue.push({ taskId })
		maybeStart()
	},
)

const onTestsRevise = handler(
	(context) => context.event.type === "tests.revise",
	(context) => {
		self = context.participant as Agent
		const { taskId, tail } = context.event.payload as { taskId: string; tail: string }
		const s = state()
		const count = s.testsRevised.get(taskId) ?? 0
		if (count >= 2) return
		s.testsRevised.set(taskId, count + 1)
		queue.push({ taskId, reviseTail: tail })
		maybeStart()
	},
)

const onOwnAnswer = handler(
	(context) =>
		context.event.type === "model.answer" && context.event.producerId === context.participant.getId(),
	(context) => {
		const agent = context.participant as Agent
		if (!current) return
		const done = current
		current = undefined
		state().testsWritten.add(done.taskId)
		sendEvent(
			SemanticEvent.create("tests.written", agent.getId(), { taskId: done.taskId }),
			agent.getId(),
		)
		maybeStart()
	},
)

export function makeTestWriter() {
	return createAgent({
		name: "TestWriter",
		capabilities: ["write_tests"],
		instruction: TESTWRITER_INSTRUCTION,
		tools: [...makeFileTools(state().outDir), makeCheckTypesTool(state().outDir)],
		handlers: [onTaskCompleted, onTestsRevise, onOwnAnswer],
	})
}
