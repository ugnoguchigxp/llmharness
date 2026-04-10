import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseScenarioInput } from "../../../src/schemas";

const collectJsonFiles = async (root: string): Promise<string[]> => {
	const entries = await readdir(root, { withFileTypes: true });
	const files: string[] = [];

	for (const entry of entries) {
		const fullPath = join(root, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await collectJsonFiles(fullPath)));
			continue;
		}

		if (entry.isFile() && entry.name.endsWith(".json")) {
			files.push(fullPath);
		}
	}

	return files.sort((a, b) => a.localeCompare(b));
};

describe("scenario catalog", () => {
	test("contains at least 20 scenario files", async () => {
		const scenarioRoot = resolve("scenarios");
		const files = await collectJsonFiles(scenarioRoot);

		expect(files.length).toBeGreaterThanOrEqual(20);
	});

	test("all scenario JSON files are schema-valid", async () => {
		const scenarioRoot = resolve("scenarios");
		const files = await collectJsonFiles(scenarioRoot);
		const ids = new Set<string>();

		for (const filePath of files) {
			const raw = await readFile(filePath, "utf8");
			const parsed = parseScenarioInput(JSON.parse(raw));
			expect(ids.has(parsed.id)).toBe(false);
			ids.add(parsed.id);
		}
	});
});
