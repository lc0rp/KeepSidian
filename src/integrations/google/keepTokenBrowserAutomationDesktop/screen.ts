import type { AutomationLogEvent, AutomationPage, OverlayPayload, ScreenState } from "./types";

export const detectScreen = async (page: AutomationPage, logSessionEvent: AutomationLogEvent) => {
	try {
		return await page.evaluate(() => {
			const text = document.body?.innerText || "";
			const normalized = text.replace(/\s+/g, " ").trim();
			const lower = normalized.toLowerCase();
			const includes = (value: string) => lower.includes(value);
			const isVisible = (element: Element | null) => {
				if (!element || !(element instanceof HTMLElement)) {
					return false;
				}
				const style = window.getComputedStyle(element);
				if (style.display === "none" || style.visibility === "hidden") {
					return false;
				}
				return element.getClientRects().length > 0;
			};
			const url = location.href;
			const lowerUrl = url.toLowerCase();
			const isPasswordUrl = lowerUrl.includes("/pwd");
			const isIdentifierUrl = lowerUrl.includes("/identifier");
			const isChallengeUrl = lowerUrl.includes("/challenge/");
			const isSpeedbumpUrl = lowerUrl.includes("/speedbump");
			const challengeOptions = Array.from(
				document.querySelectorAll("#challengePickerList li, #challengePickerList [role='button']")
			)
				.map((el) => el.textContent?.trim() || "")
				.filter((value) => value.length > 0);
			const emailInput = document.querySelector("input[type='email'], #identifierId");
			const passwordInput = document.querySelector(
				"input[type='password'][name='Passwd'], input[type='password']"
			);
			const hasPasswordInput = isPasswordUrl || isVisible(passwordInput);
			const hasEmailInput = !hasPasswordInput && (isIdentifierUrl || isVisible(emailInput));
			const hasSmsInput = Boolean(
				document.querySelector("input[name='idvPin'], input[autocomplete='one-time-code']")
			);
			const hasTotpInput = Boolean(document.querySelector("input[name='totpPin']"));
			const hasSecurityKey = includes("security key");
			const hasPromptText =
				includes("check your phone") ||
				includes("tap yes") ||
				includes("google sent a notification") ||
				includes("approve sign-in");
			const hasTryAnotherWay = includes("try another way");
			const hasResend = includes("resend");
			const hasPrompt =
				hasPromptText ||
				(isChallengeUrl &&
					(hasTryAnotherWay || hasResend) &&
					!hasSmsInput &&
					!hasTotpInput &&
					!hasSecurityKey);
			const hasBackupCode = includes("backup code");
			const hasChooseAccountText = includes("choose an account") || includes("choose your account");
			const consentLabels = ["i agree", "agree", "allow", "continue"];
			const hasConsentButton = Array.from(
				document.querySelectorAll("button, [role='button'], #submit_approve_access")
			).some((el) => {
				const text = (el.textContent || "").trim().toLowerCase();
				return text && consentLabels.includes(text);
			});
			const hasConsentText =
				includes("terms of service") || includes("privacy policy") || includes("you agree");
			const hasAccountChooser =
				(hasChooseAccountText ||
					Boolean(
						document.querySelector("[data-identifier]") ||
							document.querySelector("div[data-email]") ||
							document.querySelector("#profileIdentifier")
					)) &&
				!hasEmailInput &&
				!hasPasswordInput &&
				!hasPrompt &&
				!hasTryAnotherWay &&
				!hasSmsInput &&
				!hasTotpInput &&
				!hasSecurityKey &&
				!isChallengeUrl;
			const hasCaptcha = includes("captcha") || Boolean(document.querySelector("iframe[src*='recaptcha']"));
			const hasConsent =
				hasConsentButton &&
				(hasConsentText ||
					includes("allow") ||
					isSpeedbumpUrl ||
					Boolean(document.querySelector("#submit_approve_access")));
			const blocked =
				includes("not secure") ||
				includes("can't sign in") ||
				includes("couldn’t sign you in") ||
				includes("browser or app may not be secure");
			return {
				url: location.href,
				title: document.title,
				isChallengeUrl,
				hasEmailInput,
				hasPasswordInput,
				hasAccountChooser,
				hasSmsInput,
				hasTotpInput,
				hasSecurityKey,
				hasPrompt,
				hasBackupCode,
				hasTryAnotherWay,
				hasConsent,
				hasCaptcha,
				blocked,
				challengeOptions,
			} satisfies ScreenState;
		});
	} catch (error) {
		logSessionEvent("debug", "Screen detection failed", {
			errorMessage: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
};

export const buildOverlayPayload = (screen: ScreenState | null, email: string): OverlayPayload => {
	const withStep = (step: number, title: string) => `Step ${step}: ${title}`;
	if (!screen) {
		return {
			key: "loading",
			title: withStep(1, "Loading Google sign-in"),
			message: "Waiting for the login page to load.",
			steps: ["If the page is blank, wait a moment and it should appear."],
			status: "",
		};
	}
	if (screen.blocked) {
		return {
			key: "blocked",
			title: withStep(1, "Google blocked this sign-in"),
			message:
				"Google is blocking automated or embedded logins here. Try the system browser option or a different account.",
			steps: ["Close this window when ready.", "Try the Playwright system browser toggle."],
			status: screen.url,
		};
	}
	if (screen.hasAccountChooser) {
		return {
			key: "account",
			title: withStep(1, "Choose your account"),
			message: "Pick the Google account you want to use.",
			steps: ["Select the account tile.", "We will continue automatically."],
			status: screen.url,
		};
	}
	if (screen.hasEmailInput) {
		return {
			key: "email",
			title: withStep(1, "Enter email"),
			message: email ? `Enter the email for ${email}.` : "Enter the Google account email.",
			steps: ["Type your email.", "We will click Next once you are done."],
			status: screen.url,
		};
	}
	if (screen.hasPasswordInput) {
		return {
			key: "password",
			title: withStep(2, "Enter password"),
			message: "Enter your password to continue.",
			steps: ["Type your password.", "We will click Next after you finish."],
			status: screen.url,
		};
	}
	if (screen.challengeOptions.length > 0) {
		return {
			key: "challenge-options",
			title: withStep(3, "Choose verification method"),
			message: "Google needs extra verification. Pick one of the methods shown.",
			steps: screen.challengeOptions.slice(0, 4),
			status: screen.url,
		};
	}
	if (screen.hasSmsInput) {
		return {
			key: "sms",
			title: withStep(3, "Enter verification code"),
			message: "Enter the code sent to your phone.",
			steps: ["Type the code.", "We will continue once it is accepted."],
			status: screen.url,
		};
	}
	if (screen.hasTotpInput) {
		return {
			key: "totp",
			title: withStep(3, "Enter authenticator code"),
			message: "Open your authenticator app and enter the code.",
			steps: ["Type the current code.", "We will continue once it is accepted."],
			status: screen.url,
		};
	}
	if (screen.hasPrompt) {
		return {
			key: "prompt",
			title: withStep(3, "Approve sign-in"),
			message: "Check your phone and approve the sign-in prompt.",
			steps: ["Tap Yes on your device.", "Return here when it completes."],
			status: screen.url,
		};
	}
	if (screen.hasSecurityKey) {
		return {
			key: "security-key",
			title: withStep(3, "Use your security key"),
			message: "Touch your security key to continue.",
			steps: ["Insert your key.", "Touch or tap it when prompted."],
			status: screen.url,
		};
	}
	if (screen.hasBackupCode || screen.hasTryAnotherWay) {
		return {
			key: "backup",
			title: withStep(3, "Complete verification"),
			message: "Use a backup code or choose another verification method.",
			steps: ["Select an option.", "Follow the on-screen prompts."],
			status: screen.url,
		};
	}
	if (screen.hasCaptcha) {
		return {
			key: "captcha",
			title: withStep(3, "Complete CAPTCHA"),
			message: "Google needs a CAPTCHA. Complete the challenge to continue.",
			steps: ["Solve the CAPTCHA prompt.", "Return here once it finishes."],
			status: screen.url,
		};
	}
	if (
		screen.isChallengeUrl &&
		!screen.hasSmsInput &&
		!screen.hasTotpInput &&
		!screen.hasPrompt &&
		!screen.hasSecurityKey &&
		!screen.hasBackupCode &&
		!screen.hasTryAnotherWay &&
		!screen.hasCaptcha &&
		screen.challengeOptions.length === 0
	) {
		return {
			key: "challenge-generic",
			title: withStep(3, "Complete verification"),
			message: "Follow the on-screen verification steps to continue.",
			steps: ["Complete the verification prompt.", "Return here when it finishes."],
			status: screen.url,
		};
	}
	if (screen.hasConsent) {
		return {
			key: "consent",
			title: withStep(4, "Review access"),
			message: "Review the consent screen and continue.",
			steps: ["Click I agree / Allow / Continue.", "We will capture the cookie next."],
			status: screen.url,
		};
	}
	return {
		key: "generic",
		title: withStep(2, "Continue in the browser"),
		message: "Follow the Google prompts until the login completes.",
		steps: ["Complete any remaining prompts.", "We will capture the cookie automatically."],
		status: screen.url,
	};
};
