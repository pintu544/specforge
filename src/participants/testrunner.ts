import { createAgent, SemanticEvent } from "@mozaik-ai/core"
import { exec } from "node:child_process"
import { promisify } from "node:util"
import { handler } from "../handler.js"
import { sendEvent, state } from "../runtime.js"

const execAsync = promisify(exec)

async function runSuite(runnerId: string): Promise<void> {
	const s = state()
	if (s.testRunning) {
		s.rerunPending = true
		return
	}
	s.testRunning = true
	try {
		if (!s.installDone) {
			try {
				await execAsync("npm install --no-audit --no-fund --loglevel=error", {
					cwd: s.outDir,
					timeout: 300_000,
					maxBuffer: 8 * 1024 * 1024,
				})
				s.installDone = true
			} catch (error) {
				const e = error as { stdout?: string; stderr?: string; message?: string }
				const tail = `npm install failed in the generated project:\n${e.stderr ?? ""}\n${e.message ?? ""}`.slice(-2500)
				s.testRuns.push({ at: new Date().toISOString(), ok: false, tail })
				sendEvent(
					SemanticEvent.create("tests.failed", runnerId, { tail, failedTaskIds: [] }),
					runnerId,
				)
				return
			}
		}
		let ok = true
		let output = ""
		try {
			const { stdout, stderr } = await execAsync("npm test --silent", {
				cwd: s.outDir,
				timeout: 240_000,
				maxBuffer: 8 * 1024 * 1024,
			})
			output = `${stdout}\n${stderr}`
		} catch (error) {
			ok = false
			const e = error as { stdout?: string; stderr?: string; message?: string }
			output = `${e.stdout ?? ""}\n${e.stderr ?? ""}\n${e.message ?? ""}`
		}
		const tail = output.slice(-2500)
		s.testRuns.push({ at: new Date().toISOString(), ok, tail })

		if (ok) {
			if (s.reviewVerdict && !s.reviewVerdict.approved) {
				s.reviewStarted = false
			}
			sendEvent(SemanticEvent.create("tests.passed", runnerId, { tail }), runnerId)
			return
		}

		// ---- Failure attribution ----
		// tsc errors name the file that is actually broken. An error inside a
		// test file is a test-authoring bug (route to TestWriter); an error in a
		// src file is that module builder's bug. Runtime assertion failures are
		// attributed to the module whose test file failed.
		const tscErrorFiles = new Set<string>()
		const tscErrorLines: string[] = []
		for (const match of output.matchAll(/^((?:src|test)\/[A-Za-z0-9_.-]+\.ts)\(\d+,\d+\): error TS.*$/gm)) {
			tscErrorFiles.add(match[1])
			if (tscErrorLines.length < 20) tscErrorLines.push(match[0])
		}
		const mentioned = new Set<string>()
		for (const match of output.matchAll(/(?:src|test)\/[A-Za-z0-9_.-]+\.ts/g)) {
			mentioned.add(match[0])
		}

		const reviseTaskIds = new Set<string>()
		const builderTaskIds = new Set<string>()

		for (const task of s.tasks) {
			if (tscErrorFiles.has(task.testPath)) {
				if ((s.testsRevised.get(task.id) ?? 0) < 2) reviseTaskIds.add(task.id)
				else builderTaskIds.add(task.id)
			} else if (tscErrorFiles.has(task.modulePath)) {
				builderTaskIds.add(task.id)
			}
		}

		// Test files that crash at load time (bad imports etc.) or that try to
		// monkey-patch module namespaces are test-authoring bugs, not builder bugs.
		// ECONNREFUSED in a server test is likewise a test bug: it means the test
		// requested against a server that was never listened on (address() null,
		// request defaulting to port 80), not a broken server implementation.
		const loadCrash =
			/require is not defined|Cannot use import statement|SyntaxError|ERR_MODULE_NOT_FOUND|Cannot find module|Cannot assign to read only property|Cannot redefine property|ECONNREFUSED/.test(
				output,
			)
		if (loadCrash) {
			for (const task of s.tasks) {
				if (mentioned.has(task.testPath) && (s.testsRevised.get(task.id) ?? 0) < 2) {
					reviseTaskIds.add(task.id)
					builderTaskIds.delete(task.id)
				}
			}
		}

		if (builderTaskIds.size === 0 && reviseTaskIds.size === 0) {
			// Runtime failures: blame modules whose files are mentioned by the
			// failing output; if nothing is identifiable, blame every done task.
			for (const task of s.tasks) {
				if (mentioned.has(task.modulePath) || mentioned.has(task.testPath)) {
					builderTaskIds.add(task.id)
				}
			}
			if (builderTaskIds.size === 0) {
				for (const task of s.tasks) {
					if (task.status === "done") builderTaskIds.add(task.id)
				}
			}
		}

		// A builder that has already burned 2+ fix rounds on assertion failures
		// may be fighting a wrong test: give the TestWriter a revision pass and
		// stop blaming the builder for this failure round.
		for (const taskId of [...builderTaskIds]) {
			const task = s.taskById(taskId)
			if (
				task &&
				task.fixRounds >= 2 &&
				(s.testsRevised.get(taskId) ?? 0) === 0 &&
				!tscErrorFiles.has(task.modulePath)
			) {
				reviseTaskIds.add(taskId)
				builderTaskIds.delete(taskId)
			}
		}

		for (const taskId of reviseTaskIds) {
			sendEvent(SemanticEvent.create("tests.revise", runnerId, { taskId, tail }), runnerId)
		}

		sendEvent(
			SemanticEvent.create("tests.failed", runnerId, {
				tail,
				failedTaskIds: [...builderTaskIds],
				errors: tscErrorLines,
			}),
			runnerId,
		)
	} finally {
		s.testRunning = false
		if (s.rerunPending) {
			s.rerunPending = false
			void runSuite(runnerId)
		}
	}
}

const onTestsReady = handler(
	(context) => {
		if (context.event.producerId === context.participant.getId()) return false
		if (context.event.type !== "tests.written" && context.event.type !== "fix.completed") {
			return false
		}
		// Only judge complete builds: running the suite against a half-built
		// project produces noise failures that burn builders' fix rounds.
		return state().allBuilt()
	},
	(context) => {
		const s = state()
		if (context.event.type === "tests.written" && s.testRuns.length === 0) {
			// Wait until every module has its test file before the first run.
			// testsWritten is maintained by the TestWriter itself, so it is
			// complete even for events this participant's spec filtered out.
			if (s.testsWritten.size < s.tasks.length) return
		}
		void runSuite(context.participant.getId())
	},
)

export const testRunner = createAgent({
	name: "TestRunner",
	capabilities: ["run_tests"],
	instruction: "Runs the generated project's checks deterministically. Never speaks.",
	tools: [],
	handlers: [onTestsReady],
})
