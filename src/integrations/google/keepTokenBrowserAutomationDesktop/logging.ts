import { logRetrievalWizardEvent } from "../retrievalSessionLogger";
import type { AutomationLogEvent, LogLevel } from "./types";

export function createAutomationLogger(debugEnabled: boolean): AutomationLogEvent {
	return (level: LogLevel, message: string, metadata: Record<string, unknown> = {}) => {
		void logRetrievalWizardEvent(level, message, metadata);
		if (!debugEnabled) {
			return;
		}
		const payload = Object.keys(metadata).length ? metadata : undefined;
		switch (level) {
			case "error":
				console.error("[KeepSidian OAuth]", message, payload);
				break;
			case "warn":
				console.warn("[KeepSidian OAuth]", message, payload);
				break;
			case "info":
				console.info("[KeepSidian OAuth]", message, payload);
				break;
			default:
				console.debug("[KeepSidian OAuth]", message, payload);
		}
	};
}
