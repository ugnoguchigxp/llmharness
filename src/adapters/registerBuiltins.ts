import "./astmend";
import "./diffguard";
import "./fileReplaceApply";
import "./localllm";
import "./unifiedDiffApply";

let initialized = false;

export const ensureBuiltinAdaptersRegistered = (): void => {
	if (initialized) {
		return;
	}
	initialized = true;
};
