import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

export type RunPaths = {
	runId: string;
	runDir: string;
	reportJsonPath: string;
	reportMarkdownPath: string;
	reportSarifPath: string;
};

const createRunId = (): string => {
	const d = new Date();
	const p = (n: number): string => String(n).padStart(2, "0");
	const p3 = (n: number): string => String(n).padStart(3, "0");
	const timestamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(
		d.getMinutes(),
	)}${p(d.getSeconds())}${p3(d.getMilliseconds())}`;
	const nonce = randomBytes(2).toString("hex");
	return `${timestamp}-${nonce}`;
};

export const createRunPaths = async (
	artifactsDir: string,
): Promise<RunPaths> => {
	const runId = createRunId();
	const runDir = resolve(artifactsDir, runId);
	await mkdir(runDir, { recursive: true });
	return {
		runId,
		runDir,
		reportJsonPath: join(runDir, "result.json"),
		reportMarkdownPath: join(runDir, "result.md"),
		reportSarifPath: join(runDir, "result.sarif.json"),
	};
};
