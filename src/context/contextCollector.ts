import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { HarnessConfig, ScenarioInput } from "../schemas";
import { resolveLocalImports } from "./importResolver";
import { discoverTestFiles } from "./testDiscovery";

export type FileContextRole = "target" | "type" | "test" | "related";

export type FileContext = {
	path: string;
	content: string;
	role: FileContextRole;
	truncated: boolean;
};

export type CollectedContext = {
	files: FileContext[];
	totalTokenEstimate: number;
};

const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

const readFileContent = async (
	absolutePath: string,
	maxLines: number,
): Promise<{ text: string; truncated: boolean } | null> => {
	try {
		const raw = await readFile(absolutePath, "utf-8");
		const lines = raw.split("\n");
		if (lines.length <= maxLines) {
			return { text: raw, truncated: false };
		}
		return {
			text: lines.slice(0, maxLines).join("\n"),
			truncated: true,
		};
	} catch {
		return null;
	}
};

const applyTokenBudget = (
	files: FileContext[],
	maxTokens: number,
): FileContext[] => {
	const total = files.reduce((s, f) => s + estimateTokens(f.content), 0);
	if (total <= maxTokens) return files;

	const result: FileContext[] = [...files];
	const roleOrder: FileContextRole[] = ["related", "test", "type", "target"];

	for (const role of roleOrder) {
		const current = result.reduce((s, f) => s + estimateTokens(f.content), 0);
		if (current <= maxTokens) break;

		const idx = result.findLastIndex((f) => f.role === role);
		if (idx !== -1) {
			result.splice(idx, 1);
		}
	}

	// If still over budget, truncate the largest non-target file, then target files
	for (const role of [
		"type",
		"test",
		"related",
		"target",
	] as FileContextRole[]) {
		const current = result.reduce((s, f) => s + estimateTokens(f.content), 0);
		if (current <= maxTokens) break;

		const file = result.find((f) => f.role === role && !f.truncated);
		if (file) {
			const budget =
				maxTokens -
				result
					.filter((f) => f !== file)
					.reduce((s, f) => s + estimateTokens(f.content), 0);
			const chars = Math.max(budget * 4, 200);
			file.content = `${file.content.slice(0, chars)}\n...[truncated]`;
			file.truncated = true;
		}
	}

	return result;
};

export const collectContext = async (
	scenario: ScenarioInput,
	config: HarnessConfig,
): Promise<CollectedContext> => {
	const contextConfig = config.context;
	if (!contextConfig.enabled) {
		return { files: [], totalTokenEstimate: 0 };
	}

	const workspaceRoot = resolve(config.workspaceRoot);
	const { maxFileLines } = contextConfig;
	const files: FileContext[] = [];
	const seenPaths = new Set<string>();

	const addFile = async (
		relPath: string,
		role: FileContextRole,
	): Promise<void> => {
		if (seenPaths.has(relPath)) return;
		seenPaths.add(relPath);
		const result = await readFileContent(
			join(workspaceRoot, relPath),
			maxFileLines,
		);
		if (result) {
			files.push({
				path: relPath,
				content: result.text,
				role,
				truncated: result.truncated,
			});
		}
	};

	// Step 1: Target files
	for (const targetFile of scenario.targetFiles) {
		await addFile(targetFile, "target");
	}

	// Step 2: Explicit contextFiles from scenario
	for (const cf of scenario.contextFiles ?? []) {
		await addFile(cf, "related");
	}

	// Step 3: Import resolution
	if (contextConfig.includeImports) {
		for (const targetFile of scenario.targetFiles) {
			const targetEntry = files.find((f) => f.path === targetFile);
			if (!targetEntry) continue;
			const imports = resolveLocalImports(
				targetEntry.content,
				targetFile,
				workspaceRoot,
			);
			for (const importPath of imports) {
				await addFile(importPath, "type");
			}
		}
	}

	// Step 4: Test discovery
	if (contextConfig.includeTests) {
		for (const targetFile of scenario.targetFiles) {
			const testFiles = discoverTestFiles(targetFile, workspaceRoot);
			for (const testFile of testFiles) {
				await addFile(testFile, "test");
			}
		}
	}

	const budgeted = applyTokenBudget(files, contextConfig.maxContextTokens);
	const totalTokenEstimate = budgeted.reduce(
		(s, f) => s + estimateTokens(f.content),
		0,
	);

	return { files: budgeted, totalTokenEstimate };
};
