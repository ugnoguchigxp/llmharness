import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const createTempDir = async (prefix: string): Promise<string> => {
	return mkdtemp(join(tmpdir(), `${prefix}-`));
};

export const cleanupTempDir = async (dir: string): Promise<void> => {
	await rm(dir, { recursive: true, force: true });
};

export const createCliScript = async (
	dir: string,
	name: string,
	body: string,
): Promise<string> => {
	const path = join(dir, name);
	const script = ["#!/usr/bin/env zsh", "set -eu", body, ""].join("\n");
	await writeFile(path, script, "utf-8");
	await chmod(path, 0o755);
	return path;
};
