import {
	SituationContext,
	SituationHandler,
	SituationProcessor,
	SituationSpecification,
} from "@mozaik-ai/core"

export function handler(
	specFn: (context: SituationContext) => boolean,
	applyFn: (context: SituationContext) => void | Promise<void>,
): SituationHandler {
	class Spec extends SituationSpecification {
		isSatisfiedBy(context: SituationContext): boolean {
			try {
				return specFn(context)
			} catch {
				return false
			}
		}
	}
	class Proc implements SituationProcessor {
		apply(context: SituationContext): void | Promise<void> {
			return applyFn(context)
		}
	}
	return { specification: new Spec(), processor: new Proc() }
}

export function parseJsonAnswer(text: string): unknown {
	const trimmed = text.trim()
	try {
		return JSON.parse(trimmed)
	} catch {
		const start = trimmed.indexOf("{")
		const end = trimmed.lastIndexOf("}")
		if (start >= 0 && end > start) {
			return JSON.parse(trimmed.slice(start, end + 1))
		}
		throw new Error("Answer was not JSON")
	}
}
