import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const readJsonFile = async (path: string): Promise<unknown> => {
	const raw = await readFile(path, "utf-8");
	return JSON.parse(raw) as unknown;
};

export const writeTextFile = async (
	path: string,
	content: string,
): Promise<void> => {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content, "utf-8");
};

export const writeJsonFile = async (
	path: string,
	value: unknown,
): Promise<void> => {
	const content = `${JSON.stringify(value, null, 2)}\n`;
	await writeTextFile(path, content);
};

const isJsonFile = (name: string): boolean => name.endsWith(".json");

export const listJsonFilesRecursive = async (
	rootDir: string,
): Promise<string[]> => {
	const entries = await readdir(rootDir, { withFileTypes: true });
	const files: string[] = [];

	for (const entry of entries) {
		const fullPath = join(rootDir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listJsonFilesRecursive(fullPath)));
			continue;
		}

		if (entry.isFile() && isJsonFile(entry.name)) {
			files.push(fullPath);
		}
	}

	return files;
};

export const exists = async (path: string): Promise<boolean> => {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
};
