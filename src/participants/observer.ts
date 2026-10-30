import { createAgent } from "@mozaik-ai/core"
import { handler } from "../handler.js"
import { producerName, state } from "../runtime.js"

const logEverything = handler(
	() => true,
	(context) => {
		const { event } = context
		const s = state()
		const name = producerName(event.producerId)

		if (event.type === "inference.completed") {
			const payload = event.payload as {
				tokenUsage?: { inputTokens?: number; outputTokens?: number }
				output?: { tokenUsage?: { inputTokens?: number; outputTokens?: number } }
			}
			const usage = payload?.tokenUsage ?? payload?.output?.tokenUsage
			if (usage) {
				s.usage.push({
					producer: name,
					at: new Date().toISOString(),
					inputTokens: usage.inputTokens ?? 0,
					outputTokens: usage.outputTokens ?? 0,
				})
			}
		}

		if (event.type.startsWith("inference.") || event.type === "message_received.started") {
			return
		}

		let detail: string | undefined
		const payload = event.payload as Record<string, unknown> | undefined
		if (payload && typeof payload === "object") {
			if (typeof payload.taskId === "string") detail = `task=${payload.taskId}`
			if (event.type === "message.sent") detail = "spec submitted"
		}
		s.log(event.type, name, detail)
		const time = new Date().toISOString().slice(11, 19)
		console.log(`[${time}] ${event.type}  (${name})${detail ? `  ${detail}` : ""}`)
	},
)

export const observer = createAgent({
	name: "Observer",
	capabilities: [],
	instruction: "Observes and logs the factory run. Never speaks.",
	tools: [],
	handlers: [logEverything],
})
