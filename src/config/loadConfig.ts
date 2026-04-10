import { resolve } from "node:path";
import { type HarnessConfig, parseHarnessConfig } from "../schemas";
import { readJsonFile } from "../utils/fs";

export const DEFAULT_CONFIG_PATH = "configs/harness.config.json";

export const loadHarnessConfig = async (
	configPath = DEFAULT_CONFIG_PATH,
): Promise<HarnessConfig> => {
	const absolutePath = resolve(configPath);
	const raw = await readJsonFile(absolutePath);
	return parseHarnessConfig(raw);
};
