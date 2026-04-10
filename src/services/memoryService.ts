import { resolve } from "node:path";
import type { HarnessConfig, ScenarioResult } from "../schemas";
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
		const command = `bun run src/scripts/${script}.ts ${args.map(shellQuote).join(" ")}`;
		const { strict = false } = options;

		let result: Awaited<ReturnType<typeof runCommand>>;
		try {
			result = await runCommand(command, {
				cwd: gnosisAbsPath,
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
		const content = [
			`Scenario: ${scenarioId}`,
			`Final Decision: ${result.finalDecision}`,
			`Generated Patch:`,
			patch,
		].join("\n\n");

		await this.runGnosisScript(
			"ingest-verified",
			[
				"--content",
				content,
				"--session-id",
				`${memory.sessionId}-verified`,
				"--metadata",
				JSON.stringify({ scenarioId, score }),
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
}
