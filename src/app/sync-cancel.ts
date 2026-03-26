export class SyncCancellationError extends Error {
	constructor(message = "Sync canceled by user.") {
		super(message);
		this.name = "SyncCancellationError";
	}
}

export function isSyncCancellationError(error: unknown): error is SyncCancellationError {
	return error instanceof SyncCancellationError;
}
