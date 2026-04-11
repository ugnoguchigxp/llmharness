import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	parseHarnessConfig,
	parseScenarioInput,
	parseScenarioResult,
} from "../../../src/schemas";
import {
	indexScenarioRun,
	resolveRunIndexPath,
	searchRunsInIndex,
} from "../../../src/storage/runIndex";

describe("run index", () => {
	test("indexes scenario result and supports FTS search", async () => {
		const root = await mkdtemp(join(tmpdir(), "llmharness-runindex-"));
		try {
			const config = parseHarnessConfig({
				runtime: "bun",
				workspaceRoot: root,
				artifactsDir: join(root, "artifacts", "runs"),
				adapters: {
					localLlm: {
						mode: "cli",
						command: "localLlm --json",
						model: "test-model",
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
			const scenario = parseScenarioInput({
				id: "smoke-search-001",
				suite: "smoke",
				title: "Searchable scenario title",
				instruction: "Fix timeout handling and improve retry diagnostics",
				targetFiles: ["src/index.ts"],
				expected: {
					mustPassTests: [],
					maxRiskErrors: 0,
					minScore: 80,
				},
			});
			const result = parseScenarioResult({
				scenarioId: scenario.id,
				durationMs: 1280,
				finalDecision: "pass",
				generate: {
					patch: "--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1 @@",
					summary: "retry timeout handling updated",
				},
				apply: {
					success: true,
					patchedFiles: ["src/index.ts"],
					rejects: [],
					diagnostics: [],
				},
				risk: {
					levelCounts: { error: 0, warn: 0, info: 1 },
					findings: [
						{
							id: "DG-INFO-1",
							level: "info",
							message: "Timeout guard is now explicit.",
						},
					],
					blocking: false,
				},
				judges: [
					{
						phase: "final",
						score: 92,
						pass: true,
						reasons: ["All quality gates passed with retry improvements."],
					},
				],
				attempts: [],
				artifacts: [],
			});

			const runDir = join(config.artifactsDir, "20260411-000000000-abcd");
			await indexScenarioRun({
				config,
				scenario,
				result,
				runDir,
				reportJsonPath: join(runDir, "result.json"),
				reportMarkdownPath: join(runDir, "result.md"),
				reportSarifPath: join(runDir, "result.sarif.json"),
			});

			const hits = await searchRunsInIndex({
				config,
				query: "retry timeout",
			});

			expect(hits.length).toBe(1);
			expect(hits[0]?.scenarioId).toBe("smoke-search-001");
			expect(hits[0]?.finalDecision).toBe("pass");
			expect(hits[0]?.runId).toBe("20260411-000000000-abcd");
			expect(resolveRunIndexPath(config)).toBe(
				join(config.artifactsDir, "run-index.sqlite"),
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
