import { defineRuntime, RuntimeState } from "@mozaik-ai/core"

export interface PlanModule {
	id: string
	modulePath: string
	testPath: string
	responsibility: string
	exports: string[]
	dependsOn: string[]
}

export interface Plan {
	projectName: string
	summary: string
	modules: PlanModule[]
	acceptanceCriteria: string[]
}

export type TaskStatus = "unclaimed" | "building" | "done" | "fixing" | "failed"

export interface FactoryTask {
	id: string
	modulePath: string
	testPath: string
	responsibility: string
	exports: string[]
	dependsOn: string[]
	status: TaskStatus
	ownerId?: string
	ownerName?: string
	fixRounds: number
	reviewFixRounds: number
	claimedAt?: number
	doneAt?: number
	lastError?: string
}

export interface LogEntry {
	t: string
	event: string
	producer: string
	detail?: string
}

export interface UsageEntry {
	producer: string
	at: string
	inputTokens: number
	outputTokens: number
}

export class FactoryState extends RuntimeState {
	specText = ""
	specName = ""
	outDir = ""
	plan?: Plan
	tasks: FactoryTask[] = []
	testsRequested = new Set<string>()
	testsWritten = new Set<string>()
	testsRevised = new Map<string, number>()
	testRunning = false
	rerunPending = false
	installDone = false
	testRuns: { at: string; ok: boolean; tail: string }[] = []
	reviewStarted = false
	reviewRounds = 0
	reviewVerdict?: { approved: boolean; issues: string[] }
	finished = false
	success = false
	finishNote = ""
	humanInterventions = 0
	eventLog: LogEntry[] = []
	usage: UsageEntry[] = []

	log(event: string, producer: string, detail?: string): void {
		this.eventLog.push({ t: new Date().toISOString(), event, producer, detail })
	}

	setPlan(plan: Plan): void {
		this.plan = plan
		this.tasks = plan.modules.map((m) => ({
			id: m.id,
			modulePath: m.modulePath,
			testPath: m.testPath,
			responsibility: m.responsibility,
			exports: m.exports,
			dependsOn: m.dependsOn,
			status: "unclaimed" as TaskStatus,
			fixRounds: 0,
			reviewFixRounds: 0,
		}))
	}

	taskById(id: string): FactoryTask | undefined {
		return this.tasks.find((t) => t.id === id)
	}

	nextUnclaimed(): FactoryTask | undefined {
		return this.tasks.find((t) => t.status === "unclaimed")
	}

	claimNext(ownerId: string, ownerName: string): FactoryTask | undefined {
		const task = this.nextUnclaimed()
		if (!task) return undefined
		task.status = "building"
		task.ownerId = ownerId
		task.ownerName = ownerName
		task.claimedAt = Date.now()
		return task
	}

	ownedActive(ownerId: string): FactoryTask[] {
		return this.tasks.filter(
			(t) => t.ownerId === ownerId && (t.status === "building" || t.status === "fixing"),
		)
	}

	markDone(id: string): void {
		const task = this.taskById(id)
		if (task) {
			task.status = "done"
			task.doneAt = Date.now()
		}
	}

	markFixing(id: string, error: string): boolean {
		const task = this.taskById(id)
		if (!task || task.fixRounds >= 3) return false
		task.status = "fixing"
		task.fixRounds += 1
		task.claimedAt = Date.now()
		task.lastError = error.slice(0, 2000)
		return true
	}

	markReviewFixing(id: string, error: string): boolean {
		const task = this.taskById(id)
		if (!task || task.reviewFixRounds >= 2) return false
		task.status = "fixing"
		task.reviewFixRounds += 1
		task.claimedAt = Date.now()
		task.lastError = error.slice(0, 2000)
		return true
	}

	markFailed(id: string): void {
		const task = this.taskById(id)
		if (task) task.status = "failed"
	}

	allBuilt(): boolean {
		return this.tasks.length > 0 && this.tasks.every((t) => t.status === "done" || t.status === "failed")
	}

	allDone(): boolean {
		return this.tasks.length > 0 && this.tasks.every((t) => t.status === "done")
	}
}

export const {
	initializeRuntime,
	resolveRuntime,
	resolveParticipant,
	join,
	leave,
	sendMessage,
	sendEvent,
	runLoop,
} = defineRuntime<FactoryState>()

export function state(): FactoryState {
	return resolveRuntime().state as FactoryState
}

export function producerName(id: string): string {
	try {
		return resolveParticipant(id).getManifest().name
	} catch {
		return id
	}
}
