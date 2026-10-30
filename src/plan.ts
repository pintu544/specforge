import type { StructuredOutputFormat } from "@mozaik-ai/core"

export const planFormat: StructuredOutputFormat = {
	name: "factory_plan",
	strict: true,
	schema: {
		type: "object",
		additionalProperties: false,
		properties: {
			projectName: {
				type: "string",
				description: "Short kebab-case name for the generated project.",
			},
			summary: {
				type: "string",
				description: "One or two sentences: what the generated project does.",
			},
			modules: {
				type: "array",
				description:
					"The TypeScript modules to build. 3 to 6 modules. Each module is one file under src/, with its test file under test/.",
				items: {
					type: "object",
					additionalProperties: false,
					properties: {
						id: {
							type: "string",
							description: "Short module id, e.g. 'store'.",
						},
						modulePath: {
							type: "string",
							description: "Path of the module file, e.g. 'src/store.ts'.",
						},
						testPath: {
							type: "string",
							description: "Path of its test file, e.g. 'test/store.test.ts'.",
						},
						responsibility: {
							type: "string",
							description:
								"Precisely what this module does, including exact function signatures, types, and behaviour on edge cases and errors.",
						},
						exports: {
							type: "array",
							items: { type: "string" },
							description: "Names this module exports.",
						},
						dependsOn: {
							type: "array",
							items: { type: "string" },
							description: "Ids of other modules this one imports from.",
						},
					},
					required: ["id", "modulePath", "testPath", "responsibility", "exports", "dependsOn"],
				},
			},
			acceptanceCriteria: {
				type: "array",
				items: { type: "string" },
				description: "Verifiable criteria from the spec, one per line.",
			},
		},
		required: ["projectName", "summary", "modules", "acceptanceCriteria"],
	},
}

export const verdictFormat: StructuredOutputFormat = {
	name: "review_verdict",
	strict: true,
	schema: {
		type: "object",
		additionalProperties: false,
		properties: {
			approved: {
				type: "boolean",
				description: "True when every acceptance criterion is met by the code as written.",
			},
			issues: {
				type: "array",
				items: { type: "string" },
				description: "Each unmet criterion or defect, naming the module id it belongs to.",
			},
			issueTaskIds: {
				type: "array",
				items: { type: "string" },
				description: "Module ids that need fixes, parallel to issues. Empty when approved.",
			},
		},
		required: ["approved", "issues", "issueTaskIds"],
	},
}
