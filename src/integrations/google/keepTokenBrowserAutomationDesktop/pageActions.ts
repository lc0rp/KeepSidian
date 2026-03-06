import { OVERLAY_ID, overlayStyles } from "./constants";
import type { AutomationLogEvent, AutomationPage, OverlayPayload } from "./types";

export const attachPageDebugListeners = (page: AutomationPage, logSessionEvent: AutomationLogEvent) => {
	page.on("console", (message) => {
		const payload =
			message && typeof message === "object"
				? {
						type:
							typeof (message as { type?: () => string }).type === "function"
								? (message as { type: () => string }).type()
								: "log",
						text:
							typeof (message as { text?: () => string }).text === "function"
								? (message as { text: () => string }).text()
								: String(message),
				  }
				: { type: "log", text: String(message) };
		logSessionEvent("debug", "Page console", payload);
	});
	page.on("pageerror", (error) => {
		logSessionEvent("debug", "Page error", {
			errorMessage: error instanceof Error ? error.message : String(error),
		});
	});
	page.on("requestfailed", (request) => {
		const req = request as {
			url?: () => string;
			failure?: () => { errorText?: string } | null;
		};
		logSessionEvent("debug", "Request failed", {
			url: typeof req.url === "function" ? req.url() : "",
			errorText: req.failure?.()?.errorText ?? "",
		});
	});
	page.on("response", (response) => {
		const res = response as { url?: () => string; status?: () => number };
		const status = typeof res.status === "function" ? res.status() : 0;
		if (status >= 400) {
			logSessionEvent("debug", "Response error", {
				url: typeof res.url === "function" ? res.url() : "",
				status,
			});
		}
	});
};

export const ensureOverlay = async (
	page: AutomationPage,
	payload: OverlayPayload | null,
	logSessionEvent: AutomationLogEvent
) => {
	try {
		await page.evaluate(
			({ overlayId, styles, payload: overlayPayload }) => {
				if (!document.getElementById(`${overlayId}-style`)) {
					const style = document.createElement("style");
					style.id = `${overlayId}-style`;
					style.appendChild(document.createTextNode(styles));
					document.head?.appendChild(style);
				}
				let overlay = document.getElementById(overlayId);
				if (!overlay) {
					overlay = document.createElement("div");
					overlay.id = overlayId;

					const header = document.createElement("div");
					header.className = "ks-header";

					const title = document.createElement("div");
					title.className = "ks-title";
					title.textContent = "KeepSidian token helper";

					const toggle = document.createElement("button");
					toggle.className = "ks-toggle";
					toggle.type = "button";
					toggle.textContent = "Hide";

					header.appendChild(title);
					header.appendChild(toggle);

					const body = document.createElement("div");
					body.className = "ks-body";

					const step = document.createElement("div");
					step.className = "ks-step";

					const message = document.createElement("div");
					message.className = "ks-message";

					const steps = document.createElement("ol");
					steps.className = "ks-steps";

					const status = document.createElement("div");
					status.className = "ks-status";

					body.appendChild(step);
					body.appendChild(message);
					body.appendChild(steps);
					body.appendChild(status);

					overlay.appendChild(header);
					overlay.appendChild(body);

					document.body?.appendChild(overlay);

					toggle.addEventListener("click", () => {
						overlay?.classList.toggle("minimized");
						toggle.textContent = overlay?.classList.contains("minimized") ? "Show" : "Hide";
					});
				}
				const overlayElement = overlay;
				if (!overlayElement) {
					return;
				}
				if (!overlayPayload) {
					return;
				}
				const stepEl = overlayElement.querySelector(".ks-step");
				const messageEl = overlayElement.querySelector(".ks-message");
				const stepsEl = overlayElement.querySelector(".ks-steps");
				const statusEl = overlayElement.querySelector(".ks-status");
				if (stepEl) {
					stepEl.textContent = overlayPayload.title || "";
				}
				if (messageEl) {
					messageEl.textContent = overlayPayload.message || "";
				}
				if (stepsEl) {
					while (stepsEl.firstChild) {
						stepsEl.removeChild(stepsEl.firstChild);
					}
					if (Array.isArray(overlayPayload.steps)) {
						for (const item of overlayPayload.steps) {
							const li = document.createElement("li");
							li.textContent = item;
							stepsEl.appendChild(li);
						}
					}
				}
				if (statusEl) {
					const status = overlayPayload.status || "";
					statusEl.textContent = status;
				}
			},
			{
				overlayId: OVERLAY_ID,
				styles: overlayStyles,
				payload,
			}
		);
	} catch (error) {
		logSessionEvent("debug", "Failed to inject overlay", {
			errorMessage: error instanceof Error ? error.message : String(error),
		});
	}
};

export const getInputValue = async (page: AutomationPage, selectors: string[]) => {
	for (const selector of selectors) {
		try {
			const value = await page.$eval(selector, (el: Element) => {
				if ("value" in el && typeof (el as HTMLInputElement).value === "string") {
					return (el as HTMLInputElement).value;
				}
				return "";
			});
			if (value) {
				return value;
			}
		} catch {
			// ignore
		}
	}
	return "";
};

export const getActiveInputValue = async (page: AutomationPage, selectors: string[]) => {
	try {
		return await page.evaluate((selectorList) => {
			const active = document.activeElement;
			if (!active || !(active instanceof HTMLInputElement)) {
				return { value: "", isFocused: false };
			}
			const isMatch = selectorList.some((selector) => active.matches(selector));
			return {
				value: isMatch ? active.value : "",
				isFocused: isMatch,
			};
		}, selectors);
	} catch {
		return { value: "", isFocused: false };
	}
};

export const setInputValue = async (page: AutomationPage, selectors: string[], value: string) => {
	for (const selector of selectors) {
		try {
			const didSet = await page.$eval(
				selector,
				(el: Element, nextValue: string) => {
					if (!(el instanceof HTMLInputElement)) {
						return false;
					}
					el.focus();
					el.value = nextValue;
					el.dispatchEvent(new Event("input", { bubbles: true }));
					el.dispatchEvent(new Event("change", { bubbles: true }));
					return true;
				},
				value
			);
			if (didSet) {
				return true;
			}
		} catch {
			// ignore
		}
	}
	return false;
};

export const clickIfEnabled = async (page: AutomationPage, selectors: string[]) => {
	for (const selector of selectors) {
		try {
			const clicked = await page.$eval(selector, (el: Element) => {
				const aria = el.getAttribute?.("aria-disabled");
				const isDisabled =
					("disabled" in el && Boolean((el as HTMLButtonElement).disabled)) || aria === "true";
				if (isDisabled) {
					return false;
				}
				(el as HTMLElement).click();
				return true;
			});
			if (clicked) {
				return true;
			}
		} catch {
			// ignore
		}
	}
	return false;
};

export const clickButtonByText = async (page: AutomationPage, labels: string[]) => {
	const normalizedLabels = labels.map((label) => label.trim().toLowerCase());
	try {
		return await page.evaluate((targets) => {
			const buttons = Array.from(document.querySelectorAll("button, [role='button']"));
			for (const button of buttons) {
				const text = button.textContent?.trim().toLowerCase() ?? "";
				if (!text) {
					continue;
				}
				if (targets.includes(text)) {
					(button as HTMLElement).click();
					return true;
				}
			}
			return false;
		}, normalizedLabels);
	} catch {
		return false;
	}
};
