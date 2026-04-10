import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runPipeline } from "../src/runner/pipeline";
import { parseHarnessConfig, parseScenarioInput } from "../src/schemas";
import {
	cleanupTempDir,
	createCliScript,
	createTempDir,
} from "./contract/utils/tempCli";

type GenerateResponse = {
	patch: string;
	summary: string;
};

type ApplyResponse = {
	success: boolean;
	patchedFiles: string[];
	rejects: Array<{ path: string; reason: string }>;
	diagnostics: string[];
	diff?: string;
};

type ReviewResponse = {
	levelCounts: { error: number; warn: number; info: number };
	findings: Array<{
		id: string;
		level: "error" | "warn" | "info";
		message: string;
	}>;
	blocking: boolean;
};

const shellQuote = (value: string): string =>
	`'${value.replace(/'/g, `'"'"'`)}'`;

const createLocalLlmScript = async (
	dir: string,
	first: GenerateResponse,
	second?: GenerateResponse,
): Promise<{ path: string; promptLogPath: string }> => {
	const counterPath = join(dir, "llm-counter.txt");
	const promptLogPath = join(dir, "llm-prompts.log");
	const secondResponse = second ?? first;
	const scriptPath = await createCliScript(
		dir,
		"local-llm.sh",
		[
			`COUNTER_FILE=${shellQuote(counterPath)}`,
			`PROMPT_LOG=${shellQuote(promptLogPath)}`,
			"count=0",
			'if [[ -f "$COUNTER_FILE" ]]; then',
			'  count=$(cat "$COUNTER_FILE")',
			"fi",
			"count=$((count + 1))",
			'echo "$count" > "$COUNTER_FILE"',
			"prompt=$(cat)",
			"{",
			'  echo "===ATTEMPT $count==="',
			'  echo "$prompt"',
			'} >> "$PROMPT_LOG"',
			'if [[ "$count" -eq 1 ]]; then',
			"  cat <<'JSON'",
			JSON.stringify(first),
			"JSON",
			"else",
			"  cat <<'JSON'",
			JSON.stringify(secondResponse),
			"JSON",
			"fi",
		].join("\n"),
	);
	return { path: scriptPath, promptLogPath };
};

const createAstmendScript = async (
	dir: string,
	first: ApplyResponse,
	second?: ApplyResponse,
): Promise<string> => {
	const counterPath = join(dir, "astmend-counter.txt");
	const secondResponse = second ?? first;
	return createCliScript(
		dir,
		"astmend.sh",
		[
			`COUNTER_FILE=${shellQuote(counterPath)}`,
			"count=0",
			'if [[ -f "$COUNTER_FILE" ]]; then',
			'  count=$(cat "$COUNTER_FILE")',
			"fi",
			"count=$((count + 1))",
			'echo "$count" > "$COUNTER_FILE"',
			"cat >/dev/null",
			'if [[ "$count" -eq 1 ]]; then',
			"  cat <<'JSON'",
			JSON.stringify(first),
			"JSON",
			"else",
			"  cat <<'JSON'",
			JSON.stringify(secondResponse),
			"JSON",
			"fi",
		].join("\n"),
	);
};

const createDiffGuardScript = async (
	dir: string,
	first: ReviewResponse,
	second?: ReviewResponse,
): Promise<string> => {
	const counterPath = join(dir, "diffguard-counter.txt");
	const secondResponse = second ?? first;
	return createCliScript(
		dir,
		"diffguard.sh",
		[
			`COUNTER_FILE=${shellQuote(counterPath)}`,
			"count=0",
			'if [[ -f "$COUNTER_FILE" ]]; then',
			'  count=$(cat "$COUNTER_FILE")',
			"fi",
			"count=$((count + 1))",
			'echo "$count" > "$COUNTER_FILE"',
			'if [[ "$count" -eq 1 ]]; then',
			"  cat <<'JSON'",
			JSON.stringify(first),
			"JSON",
			"else",
			"  cat <<'JSON'",
			JSON.stringify(secondResponse),
			"JSON",
			"fi",
		].join("\n"),
	);
};

const scenario = parseScenarioInput({
	id: "test-001",
	suite: "smoke",
	title: "Orchestrator Test",
	targetFiles: ["src/index.ts"],
	instruction: "Apply safe patch.",
	expected: {
		mustPassTests: [],
		maxRiskErrors: 0,
		minScore: 80,
	},
});

const buildConfig = (
	workspaceRoot: string,
	localLlmCommand: string,
	astmendCommand: string,
	diffGuardCommand: string,
	maxAttempts = 2,
) =>
	parseHarnessConfig({
		runtime: "bun",
		workspaceRoot,
		adapters: {
			localLlm: {
				mode: "cli",
				command: localLlmCommand,
				commandPromptMode: "stdin",
				model: "test-model",
				timeoutMs: 5000,
				temperature: 0,
			},
			astmend: {
				mode: "cli",
				command: astmendCommand,
				enableLibFallback: false,
				timeoutMs: 5000,
			},
			diffGuard: {
				mode: "cli",
				command: diffGuardCommand,
				timeoutMs: 5000,
			},
		},
		orchestrator: {
			maxAttempts,
		},
		checks: {
			runTypecheck: false,
			typecheckCommand: "echo skip",
			runTests: false,
			testCommand: "echo skip",
		},
	});

const nonBlockingReview: ReviewResponse = {
	levelCounts: { error: 0, warn: 0, info: 1 },
	findings: [{ id: "DG-INFO", level: "info", message: "no blocking issues" }],
	blocking: false,
};

describe("orchestrator retry loop", () => {
	test("passes on first attempt", async () => {
		const dir = await createTempDir("llmharness-orchestrator-pass");
		try {
			const patch = JSON.stringify({
				type: "add_import",
				file: "src/index.ts",
				module: "./m1",
				named: [{ name: "X1" }],
			});
			const local = await createLocalLlmScript(dir, {
				patch,
				summary: "summary test-001",
			});
			const astmend = await createAstmendScript(dir, {
				success: true,
				patchedFiles: ["src/index.ts"],
				rejects: [],
				diagnostics: [],
				diff: "Index: src/index.ts\n+import { X1 } from './m1';\n",
			});
			const diffGuard = await createDiffGuardScript(dir, nonBlockingReview);

			const result = await runPipeline(
				scenario,
				buildConfig(dir, local.path, astmend, diffGuard),
			);
			expect(result.finalDecision).toBe("pass");
			expect(result.attempts.length).toBe(1);
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test("retries when apply fails and forwards reject feedback", async () => {
		const dir = await createTempDir("llmharness-orchestrator-apply-retry");
		try {
			const patch1 = JSON.stringify({
				type: "add_import",
				file: "src/index.ts",
				module: "./m1",
				named: [{ name: "X1" }],
			});
			const patch2 = JSON.stringify({
				type: "add_import",
				file: "src/index.ts",
				module: "./m2",
				named: [{ name: "X2" }],
			});
			const local = await createLocalLlmScript(
				dir,
				{ patch: patch1, summary: "summary1 test-001" },
				{ patch: patch2, summary: "summary2 test-001" },
			);
			const astmend = await createAstmendScript(
				dir,
				{
					success: false,
					patchedFiles: [],
					rejects: [{ path: "src/index.ts", reason: "conflict" }],
					diagnostics: [],
				},
				{
					success: true,
					patchedFiles: ["src/index.ts"],
					rejects: [],
					diagnostics: [],
					diff: "Index: src/index.ts\n+import { X2 } from './m2';\n",
				},
			);
			const diffGuard = await createDiffGuardScript(dir, nonBlockingReview);

			const result = await runPipeline(
				scenario,
				buildConfig(dir, local.path, astmend, diffGuard),
			);
			expect(result.finalDecision).toBe("pass");
			expect(result.attempts.length).toBe(2);

			const promptLog = await readFile(local.promptLogPath, "utf-8");
			expect(promptLog).toContain("Previous patch rejections:");
			expect(promptLog).toContain("src/index.ts: conflict");
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test("retries when review is blocking and forwards risk feedback", async () => {
		const dir = await createTempDir("llmharness-orchestrator-review-retry");
		try {
			const patch1 = JSON.stringify({
				type: "add_import",
				file: "src/index.ts",
				module: "./bad",
				named: [{ name: "Bad" }],
			});
			const patch2 = JSON.stringify({
				type: "add_import",
				file: "src/index.ts",
				module: "./good",
				named: [{ name: "Good" }],
			});
			const local = await createLocalLlmScript(
				dir,
				{ patch: patch1, summary: "summary1 test-001" },
				{ patch: patch2, summary: "summary2 test-001" },
			);
			const astmend = await createAstmendScript(dir, {
				success: true,
				patchedFiles: ["src/index.ts"],
				rejects: [],
				diagnostics: [],
				diff: "Index: src/index.ts\n+import { Any } from './x';\n",
			});
			const diffGuard = await createDiffGuardScript(
				dir,
				{
					levelCounts: { error: 1, warn: 0, info: 0 },
					findings: [
						{ id: "DG-001", level: "error", message: "unsafe import" },
					],
					blocking: true,
				},
				{
					...nonBlockingReview,
				},
			);

			const result = await runPipeline(
				scenario,
				buildConfig(dir, local.path, astmend, diffGuard),
			);
			expect(result.finalDecision).toBe("pass");
			expect(result.attempts.length).toBe(2);

			const promptLog = await readFile(local.promptLogPath, "utf-8");
			expect(promptLog).toContain("Previous issues:");
			expect(promptLog).toContain("unsafe import");
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test("returns fail with maxAttempts explanation and writes attempt artifacts", async () => {
		const dir = await createTempDir("llmharness-orchestrator-max-attempts");
		const runDir = await createTempDir("llmharness-orchestrator-run");
		try {
			const patch = JSON.stringify({
				type: "add_import",
				file: "src/index.ts",
				module: "./m1",
				named: [{ name: "X1" }],
			});
			const local = await createLocalLlmScript(dir, {
				patch,
				summary: "summary test-001",
			});
			const astmend = await createAstmendScript(dir, {
				success: false,
				patchedFiles: [],
				rejects: [{ path: "src/index.ts", reason: "failed" }],
				diagnostics: [],
			});
			const diffGuard = await createDiffGuardScript(dir, nonBlockingReview);

			const result = await runPipeline(
				scenario,
				buildConfig(dir, local.path, astmend, diffGuard),
				runDir,
			);
			expect(result.finalDecision).toBe("fail");
			expect(result.attempts.length).toBe(2);
			expect(
				result.judges.find((judge) => judge.phase === "final")?.reasons,
			).toEqual(
				expect.arrayContaining([
					expect.stringContaining("maxAttempts (2) reached. Returning fail."),
				]),
			);

			const attemptPatch = await readFile(
				join(runDir, "attempt1.patch"),
				"utf-8",
			);
			const attemptJson = await readFile(
				join(runDir, "attempt1.json"),
				"utf-8",
			);
			expect(attemptPatch.length).toBeGreaterThan(0);
			expect(attemptJson).toContain("stopReason");
		} finally {
			await cleanupTempDir(dir);
			await cleanupTempDir(runDir);
		}
	});
});
