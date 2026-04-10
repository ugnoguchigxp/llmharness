import { writeJsonFile } from "../utils/fs";

export const writeJsonReport = async (
	path: string,
	payload: unknown,
): Promise<void> => {
	await writeJsonFile(path, payload);
};
