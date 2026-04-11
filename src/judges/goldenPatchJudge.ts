import { readFile } from "node:fs/promises";
import type { JudgeResult } from "../schemas";
import { parseJudgeResult } from "../schemas";
import { exists } from "../utils/fs";

export type GoldenComparisonResult = {
	semanticSimilarity: number;
	fileOverlap: number;
	lineOverlap: number;
};

const extractAddedLines = (patch: string): Set<string> => {
	const lines = new Set<string>();
	for (const line of patch.split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) {
			lines.add(line.slice(1).trim());
		}
	}
	return lines;
};

const extractRemovedLines = (patch: string): Set<string> => {
	const lines = new Set<string>();
	for (const line of patch.split("\n")) {
		if (line.startsWith("-") && !line.startsWith("---")) {
			lines.add(line.slice(1).trim());
		}
	}
	return lines;
};

const extractChangedFiles = (patch: string): Set<string> => {
	const files = new Set<string>();
	for (const line of patch.split("\n")) {
		if (line.startsWith("+++ ") || line.startsWith("--- ")) {
			const path = line
				.slice(4)
				.trim()
				.replace(/^[ab]\//, "")
				.split("\t")[0]
				?.trim();
			if (path && path !== "/dev/null") {
				files.add(path);
			}
		}
	}
	return files;
};

const jaccardSimilarity = (a: Set<string>, b: Set<string>): number => {
	if (a.size === 0 && b.size === 0) return 1;
	const intersection = new Set([...a].filter((x) => b.has(x)));
	const union = new Set([...a, ...b]);
	return union.size === 0 ? 0 : intersection.size / union.size;
};

export const comparePatches = (
	generatedPatch: string,
	goldenPatch: string,
): GoldenComparisonResult => {
	const genFiles = extractChangedFiles(generatedPatch);
	const goldenFiles = extractChangedFiles(goldenPatch);
	const fileOverlap = jaccardSimilarity(genFiles, goldenFiles);

	const genAdded = extractAddedLines(generatedPatch);
	const goldenAdded = extractAddedLines(goldenPatch);
	const genRemoved = extractRemovedLines(generatedPatch);
	const goldenRemoved = extractRemovedLines(goldenPatch);

	const allGenLines = new Set([...genAdded, ...genRemoved]);
	const allGoldenLines = new Set([...goldenAdded, ...goldenRemoved]);
	const lineOverlap = jaccardSimilarity(allGenLines, allGoldenLines);

	const semanticSimilarity = fileOverlap * 0.5 + lineOverlap * 0.5;

	return { semanticSimilarity, fileOverlap, lineOverlap };
};

export const runGoldenPatchJudge = async (
	generatedPatch: string,
	goldenPatchPath: string,
): Promise<JudgeResult> => {
	if (!(await exists(goldenPatchPath))) {
		return parseJudgeResult({
			phase: "golden",
			score: 0,
			pass: false,
			reasons: [`Golden patch file not found: ${goldenPatchPath}`],
		});
	}

	let goldenPatch: string;
	try {
		goldenPatch = await readFile(goldenPatchPath, "utf-8");
	} catch (error) {
		return parseJudgeResult({
			phase: "golden",
			score: 0,
			pass: false,
			reasons: [
				`Failed to read golden patch: ${error instanceof Error ? error.message : String(error)}`,
			],
		});
	}

	const comparison = comparePatches(generatedPatch, goldenPatch);
	const { fileOverlap, lineOverlap, semanticSimilarity } = comparison;

	const score = Math.round(semanticSimilarity * 100);
	const pass = fileOverlap >= 0.5 && score >= 30;

	const reasons = [
		`Golden patch comparison: fileOverlap=${fileOverlap.toFixed(2)} lineOverlap=${lineOverlap.toFixed(2)} semantic=${semanticSimilarity.toFixed(2)}`,
		`Score: ${score}/100 (pass threshold: 30, fileOverlap threshold: 0.5)`,
	];

	if (!pass) {
		if (fileOverlap < 0.5) {
			reasons.push(
				`File overlap too low (${fileOverlap.toFixed(2)} < 0.5): LLM modified different files than expected`,
			);
		} else {
			reasons.push(`Semantic similarity too low (${score} < 30)`);
		}
	}

	return parseJudgeResult({ phase: "golden", score, pass, reasons });
};
