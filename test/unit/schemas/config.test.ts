import { describe, expect, test } from "bun:test";
import { parseHarnessConfig } from "../../../src/schemas";

describe("HarnessConfigSchema", () => {
	test("parses valid config", () => {
		const value = parseHarnessConfig({
			runtime: "bun",
			workspaceRoot: ".",
			artifactsDir: "artifacts/runs",
			adapters: {
				localLlm: {
					mode: "cli",
					command: "localLlm --prompt {{prompt}}",
					commandPromptMode: "arg",
					model: "gemma4-default",
				},
				astmend: {
					mode: "lib",
					libEntrypoint: "../Astmend/dist/index.js",
				},
				diffGuard: {
					mode: "cli",
					command: "diffguard --format json",
				},
			},
		});

		expect(value.runtime).toBe("bun");
		expect(value.adapters.localLlm.mode).toBe("cli");
		expect(value.adapters.astmend.mode).toBe("lib");
		expect(value.checks.runTests).toBe(true);
	});

	test("rejects invalid runtime", () => {
		expect(() =>
			parseHarnessConfig({
				runtime: "node",
				workspaceRoot: ".",
				adapters: {
					localLlm: { mode: "cli", command: "localLlm", model: "x" },
					astmend: { mode: "cli", command: "astmend" },
					diffGuard: { mode: "cli", command: "diffguard" },
				},
			}),
		).toThrow("HarnessConfig validation failed");
	});

	test("rejects deprecated mock mode", () => {
		expect(() =>
			parseHarnessConfig({
				runtime: "bun",
				workspaceRoot: ".",
				adapters: {
					localLlm: {
						mode: "mock",
						command: "localLlm",
						model: "x",
					},
					astmend: { mode: "cli", command: "astmend" },
					diffGuard: { mode: "cli", command: "diffguard" },
				},
			}),
		).toThrow("HarnessConfig validation failed");
	});

	test("rejects unsupported localLlm mode", () => {
		expect(() =>
			parseHarnessConfig({
				runtime: "bun",
				workspaceRoot: ".",
				adapters: {
					localLlm: {
						mode: "lib",
						command: "localLlm",
						model: "x",
					},
					astmend: { mode: "lib", libEntrypoint: "../Astmend/dist/index.js" },
					diffGuard: { mode: "cli", command: "diffguard" },
				},
			}),
		).toThrow("HarnessConfig validation failed");
	});
});
