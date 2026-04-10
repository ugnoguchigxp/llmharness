import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { generateWithLocalLlm } from "../../../src/adapters/localllm";
import { parseHarnessConfig, parseScenarioInput } from "../../../src/schemas";
import {
	cleanupTempDir,
	createCliScript,
	createTempDir,
} from "../utils/tempCli";

const scenario = parseScenarioInput({
	id: "contract-localllm-001",
	suite: "smoke",
	title: "contract",
	instruction: "Return one patch operation.",
	targetFiles: ["src/index.ts"],
	expected: {
		mustPassTests: [],
		maxRiskErrors: 0,
		minScore: 80,
	},
});

describe("localLlm adapter contract", () => {
	test("accepts CLI payload with patch and tokenUsage", async () => {
		const dir = await createTempDir("llmharness-local-1");
		try {
			const scriptPath = await createCliScript(
				dir,
				"llm-ok.sh",
				[
					"cat <<'JSON'",
					'{"patch":"{\\"type\\":\\"add_import\\",\\"file\\":\\"src/index.ts\\",\\"module\\":\\"./utils\\",\\"named\\":[{\\"name\\":\\"runPipeline\\"}]}","summary":"cli contract","tokenUsage":{"promptTokens":"11","completionTokens":"7","totalTokens":"18"}}',
					"JSON",
				].join("\n"),
			);

			const config = parseHarnessConfig({
				runtime: "bun",
				workspaceRoot: dir,
				adapters: {
					localLlm: {
						mode: "cli",
						command: scriptPath,
						commandPromptMode: "stdin",
						model: "test-model",
						timeoutMs: 5000,
						temperature: 0,
					},
					astmend: {
						mode: "lib",
						libEntrypoint: "./unused.mjs",
					},
					diffGuard: {
						mode: "cli",
						command: "echo '{}'",
					},
				},
			});

			const result = await generateWithLocalLlm({ scenario, config });
			const patch = JSON.parse(result.patch) as Record<string, unknown>;

			expect(result.summary).toBe("cli contract");
			expect(result.tokenUsage?.totalTokens).toBe(18);
			expect(patch.type).toBe("add_import");
			expect(patch.file).toBe("src/index.ts");
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test("supports legacy response field and fills missing file", async () => {
		const dir = await createTempDir("llmharness-local-2");
		try {
			const scriptPath = await createCliScript(
				dir,
				"llm-legacy.sh",
				[
					"cat <<'JSON'",
					'{"response":"{\\"type\\":\\"add_import\\",\\"module\\":\\"./legacy\\",\\"named\\":[{\\"name\\":\\"Legacy\\"}]}"}',
					"JSON",
				].join("\n"),
			);

			const config = parseHarnessConfig({
				runtime: "bun",
				workspaceRoot: dir,
				adapters: {
					localLlm: {
						mode: "cli",
						command: scriptPath,
						commandPromptMode: "stdin",
						model: "test-model",
						timeoutMs: 5000,
						temperature: 0,
					},
					astmend: {
						mode: "lib",
						libEntrypoint: join(dir, "unused.mjs"),
					},
					diffGuard: {
						mode: "cli",
						command: "echo '{}'",
					},
				},
			});

			const result = await generateWithLocalLlm({ scenario, config });
			const patch = JSON.parse(result.patch) as Record<string, unknown>;

			expect(patch.type).toBe("add_import");
			expect(patch.file).toBe("src/index.ts");
			expect(patch.module).toBe("./legacy");
		} finally {
			await cleanupTempDir(dir);
		}
	});
});
