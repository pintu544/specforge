import { Tool } from "@mozaik-ai/core"
import { exec } from "node:child_process"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { dirname, join, resolve, sep } from "node:path"
import { promisify } from "node:util"

const execAsync = promisify(exec)

let installPromise: Promise<void> | undefined

export function makeCheckTypesTool(outDir: string): Tool {
	return {
		type: "function",
		name: "check_types",
		description:
			"Run the TypeScript compiler over the generated project and return any errors (or OK). Call this before finishing: if an error names your file, fix it and check again.",
		strict: false,
		parameters: {
			type: "object",
			properties: {},
			required: [],
			additionalProperties: false,
		},
		invoke: async () => {
			if (!installPromise) {
				installPromise = execAsync("npm install --no-audit --no-fund --loglevel=error", {
					cwd: outDir,
					timeout: 300_000,
					maxBuffer: 8 * 1024 * 1024,
				}).then(() => undefined)
			}
			await installPromise
			try {
				await execAsync("npx tsc --noEmit", {
					cwd: outDir,
					timeout: 180_000,
					maxBuffer: 8 * 1024 * 1024,
				})
				return { ok: true, errors: [] }
			} catch (error) {
				const e = error as { stdout?: string; stderr?: string }
				const text = `${e.stdout ?? ""}\n${e.stderr ?? ""}`
				const errors = text
					.split("\n")
					.filter((line) => /error TS\d+/.test(line))
					.slice(0, 30)
				return { ok: false, errors }
			}
		},
	}
}

function safePath(outDir: string, rel: string): string {
	const full = resolve(join(outDir, rel))
	if (full !== resolve(outDir) && !full.startsWith(resolve(outDir) + sep)) {
		throw new Error(`Path escapes the output directory: ${rel}`)
	}
	return full
}

export function makeFileTools(outDir: string): Tool[] {
	const writeFileTool: Tool = {
		type: "function",
		name: "write_file",
		description:
			"Write a file inside the generated project, replacing any existing content. Use for exactly the file you are responsible for.",
		strict: false,
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "Project-relative path, e.g. 'src/store.ts'.",
				},
				content: {
					type: "string",
					description: "The complete file content.",
				},
			},
			required: ["path", "content"],
			additionalProperties: false,
		},
		invoke: async ({ path, content }: { path: string; content: string }) => {
			const full = safePath(outDir, path)
			await mkdir(dirname(full), { recursive: true })
			await writeFile(full, content, "utf8")
			return { written: path, bytes: Buffer.byteLength(content, "utf8") }
		},
	}

	const readFileTool: Tool = {
		type: "function",
		name: "read_file",
		description: "Read a file inside the generated project.",
		strict: false,
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "Project-relative path, e.g. 'src/store.ts'.",
				},
			},
			required: ["path"],
			additionalProperties: false,
		},
		invoke: async ({ path }: { path: string }) => {
			const full = safePath(outDir, path)
			const content = await readFile(full, "utf8")
			return { path, content }
		},
	}

	const listFilesTool: Tool = {
		type: "function",
		name: "list_files",
		description: "List files in the generated project (src/ and test/ plus the project root).",
		strict: false,
		parameters: {
			type: "object",
			properties: {},
			required: [],
			additionalProperties: false,
		},
		invoke: async () => {
			const found: string[] = []
			for (const dir of ["src", "test", "."]) {
				try {
					const entries = await readdir(join(outDir, dir))
					for (const entry of entries) {
						if (entry === "node_modules" || entry === "dist") continue
						found.push(dir === "." ? entry : `${dir}/${entry}`)
					}
				} catch {
					// directory may not exist yet
				}
			}
			return { files: found.sort() }
		},
	}

	return [writeFileTool, readFileTool, listFilesTool]
}
