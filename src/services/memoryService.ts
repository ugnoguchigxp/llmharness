import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { HarnessConfig, ScenarioResult } from "../schemas";
import type { CodeReviewResult } from "../schemas/review";
import { runCommand } from "../utils/exec";

const shellQuote = (value: string): string => {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
};

export class MemoryService {
	constructor(private config: HarnessConfig) {}

	private async runGnosisScript(
		script: string,
		args: string[],
		options: { strict?: boolean } = {},
	): Promise<string> {
		const { memory } = this.config.adapters;
		const gnosisAbsPath = resolve(this.config.workspaceRoot, memory.gnosisPath);

		// Resolve Bun executable: PATH or fallback to ~/.bun/bin/bun
		const bunPath = await this.resolveRunner([
			"bun",
			join(homedir(), ".bun/bin/bun"),
		]);
		const runner = bunPath.includes(".ts") ? "npx tsx" : bunPath;
		const command = `${runner} src/scripts/${script}.ts ${args.map(shellQuote).join(" ")}`;
		const { strict = false } = options;

		let result: Awaited<ReturnType<typeof runCommand>>;
		try {
			result = await runCommand(command, {
				cwd: gnosisAbsPath,
				env: {
					GNOSIS_ROOT: gnosisAbsPath,
					GNOSIS_LOCAL_LLM_PATH: join(gnosisAbsPath, "services/local-llm"),
				},
				timeoutMs: 30000,
			});
		} catch (error) {
			const message = `Gnosis script ${script} failed to execute: ${
				error instanceof Error ? error.message : String(error)
			}`;
			if (strict) {
				throw new Error(message);
			}
			console.error(message);
			return "";
		}

		if (result.exitCode !== 0) {
			const detail =
				result.stderr || result.stdout || `exit code ${result.exitCode}`;
			const message = `Gnosis script ${script} failed: ${detail}`;
			if (strict) {
				throw new Error(message);
			}
			console.error(message);
			return "";
		}

		return result.stdout.trim();
	}

	async recall(prompt: string): Promise<string> {
		const { memory } = this.config.adapters;
		if (!memory.enabled) return "";

		return this.runGnosisScript("recall", [
			"--query",
			prompt,
			"--session-id",
			memory.sessionId,
			"--limit",
			String(memory.ragLimit),
		]);
	}

	async recordFailure(scenarioId: string, error: string): Promise<void> {
		const { memory } = this.config.adapters;
		if (!memory.enabled) return;

		await this.runGnosisScript("record-failure", [
			"--content",
			`Scenario ${scenarioId} failed: ${error}`,
			"--session-id",
			`${memory.sessionId}-failures`,
			"--metadata",
			JSON.stringify({ scenarioId, timestamp: new Date().toISOString() }),
		]);
	}

	async ingestVerified(
		scenarioId: string,
		result: ScenarioResult,
	): Promise<void> {
		const { memory } = this.config.adapters;
		if (!memory.enabled) return;

		const patch = result.generate?.patch ?? "(no patch captured)";
		const score = result.judges.find((judge) => judge.phase === "final")?.score;

		const requirementsLines: string[] = [];
		if (result.requirementsSummary) {
			const s = result.requirementsSummary;
			requirementsLines.push(
				`Requirements: ${s.title} [${s.validationStatus}]`,
				`  successCriteria: ${s.successCriteriaCount}, personas: ${s.reviewPersonasCount}`,
			);
		}

		const personaLines: string[] = [];
		for (const review of result.personaReviews ?? []) {
			const role = review.personaRole ? ` (${review.personaRole})` : "";
			personaLines.push(
				`  ${review.personaName}${role}: pass=${String(review.pass)} — ${review.feedback}`,
			);
		}
		if (personaLines.length > 0) {
			requirementsLines.push("Persona Reviews:", ...personaLines);
		}

		const contentParts = [
			`Scenario: ${scenarioId}`,
			`Final Decision: ${result.finalDecision}`,
			...requirementsLines,
			"Generated Patch:",
			patch,
		];

		await this.runGnosisScript(
			"ingest-verified",
			[
				"--content",
				contentParts.join("\n\n"),
				"--session-id",
				`${memory.sessionId}-verified`,
				"--metadata",
				JSON.stringify({
					scenarioId,
					score,
					requirementsSummary: result.requirementsSummary,
				}),
			],
			{ strict: true },
		);
	}

	async ingestReview(result: CodeReviewResult): Promise<void> {
		const { memory } = this.config.adapters;
		if (!memory.enabled) return;

		const findingsText =
			result.findings.length > 0
				? result.findings
						.map((f) => {
							const loc = f.file
								? f.line
									? ` ${f.file}:${f.line}`
									: ` ${f.file}`
								: "";
							const suggestion = f.suggestion ? `\n  → ${f.suggestion}` : "";
							return `[${f.severity}]${loc}: ${f.message}${suggestion}`;
						})
						.join("\n")
				: "(no findings)";

		const contentParts = [
			`Code Review: ${result.reviewedFiles.join(", ")}`,
			`Overall: ${result.overallAssessment}`,
			`Reviewed At: ${result.reviewedAt}`,
			result.model ? `Model: ${result.model}` : null,
			"",
			`Summary: ${result.summary}`,
			"",
			"Findings:",
			findingsText,
		].filter((line): line is string => line !== null);

		await this.runGnosisScript(
			"ingest-verified",
			[
				"--content",
				contentParts.join("\n"),
				"--session-id",
				`${memory.sessionId}-reviews`,
				"--metadata",
				JSON.stringify({
					files: result.reviewedFiles,
					overallAssessment: result.overallAssessment,
					findingsCount: result.findings.length,
					reviewedAt: result.reviewedAt,
				}),
			],
			{ strict: true },
		);
	}

	async gitAddAndCommit(message: string): Promise<void> {
		const workspaceRoot = resolve(this.config.workspaceRoot);
		console.log(`Git commit: ${message}`);
		await runCommand("git add .", { cwd: workspaceRoot });
		const result = await runCommand(`git commit -m ${shellQuote(message)}`, {
			cwd: workspaceRoot,
		});
		if (result.exitCode !== 0) {
			throw new Error(`Git commit failed: ${result.stderr || result.stdout}`);
		}
	}

	async gitPush(): Promise<void> {
		const workspaceRoot = resolve(this.config.workspaceRoot);
		console.log("Git push...");
		const result = await runCommand("git push", { cwd: workspaceRoot });
		if (result.exitCode !== 0) {
			throw new Error(`Git push failed: ${result.stderr || result.stdout}`);
		}
	}

	async enqueueKnowFlowTask(
		topic: string,
		options: { mode?: string; priority?: number } = {},
	): Promise<void> {
		const { memory } = this.config.adapters;
		if (!memory.enabled) return;

		const args = ["--topic", topic];
		if (options.mode) {
			args.push("--mode", options.mode);
		}
		if (options.priority !== undefined) {
			args.push("--priority", String(options.priority));
		}
		args.push("--requested-by", `llmharness-${memory.sessionId}`);

		await this.runGnosisScript("enqueue-task", args, { strict: true });
	}

	private async resolveRunner(candidates: string[]): Promise<string> {
		for (const cmd of candidates) {
			try {
				const result = await runCommand(`which ${cmd} || ls ${cmd}`, {
					cwd: resolve(this.config.workspaceRoot),
					timeoutMs: 1000,
				});
				if (result.exitCode === 0) return cmd;
			} catch (_) {}
		}
		return "npx tsx"; // Global fallback
	}
}
