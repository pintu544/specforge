import { createHuman } from "@mozaik-ai/core"
import { handler } from "../handler.js"

const onBuildComplete = handler(
	(context) => context.event.type === "build.complete",
	(context) => {
		const payload = context.event.payload as { ok: boolean; note: string }
		console.log(`\n=== BUILD ${payload.ok ? "COMPLETE" : "FINISHED WITH PROBLEMS"}: ${payload.note}`)
	},
)

export const operator = createHuman({
	name: "Operator",
	capabilities: ["submit_spec"],
	handlers: [onBuildComplete],
})
