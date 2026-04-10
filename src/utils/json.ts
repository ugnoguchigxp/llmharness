export const tryParseJson = (raw: string): unknown | undefined => {
	const text = raw.trim();
	if (text.length === 0) {
		return undefined;
	}

	try {
		return JSON.parse(text) as unknown;
	} catch {
		// continue
	}

	const objectStart = text.indexOf("{");
	const objectEnd = text.lastIndexOf("}");
	if (objectStart >= 0 && objectEnd > objectStart) {
		const slice = text.slice(objectStart, objectEnd + 1);
		try {
			return JSON.parse(slice) as unknown;
		} catch {
			// continue
		}
	}

	const arrayStart = text.indexOf("[");
	const arrayEnd = text.lastIndexOf("]");
	if (arrayStart >= 0 && arrayEnd > arrayStart) {
		const slice = text.slice(arrayStart, arrayEnd + 1);
		try {
			return JSON.parse(slice) as unknown;
		} catch {
			return undefined;
		}
	}

	return undefined;
};
