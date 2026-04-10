export const postJson = async <T>(
	url: string,
	body: unknown,
	timeoutMs: number,
	headers?: Record<string, string>,
): Promise<T> => {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				...headers,
			},
			body: JSON.stringify(body),
			signal: controller.signal,
		});

		const text = await response.text();
		if (!response.ok) {
			throw new Error(
				`HTTP ${response.status} ${response.statusText}: ${text}`,
			);
		}

		if (text.trim().length === 0) {
			throw new Error("HTTP response body is empty");
		}

		return JSON.parse(text) as T;
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			throw new Error(`HTTP request timed out after ${timeoutMs} ms`);
		}
		throw error;
	} finally {
		clearTimeout(timer);
	}
};
