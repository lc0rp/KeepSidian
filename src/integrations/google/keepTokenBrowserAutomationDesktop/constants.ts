export const DEFAULT_OAUTH_URL = "https://accounts.google.com/EmbeddedSetup";
export const DEFAULT_TIMEOUT_MINUTES = 12;
export const OVERLAY_ID = "keepsidian-oauth-overlay";
export const DEFAULT_USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export const overlayStyles = `
#${OVERLAY_ID} {
  position: fixed;
  top: 16px;
  right: 16px;
  width: 340px;
  background: rgba(17, 24, 39, 0.94);
  color: #f9fafb;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 13px;
  line-height: 1.4;
  border-radius: 12px;
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.28);
  z-index: 2147483647;
  padding: 12px 14px 12px 14px;
}
#${OVERLAY_ID}.minimized .ks-body {
  display: none;
}
#${OVERLAY_ID} .ks-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  gap: 8px;
}
#${OVERLAY_ID} .ks-title {
  font-weight: 600;
  font-size: 14px;
}
#${OVERLAY_ID} .ks-toggle {
  background: rgba(255, 255, 255, 0.12);
  color: #f9fafb;
  border: none;
  border-radius: 999px;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 11px;
}
#${OVERLAY_ID} .ks-step {
  font-weight: 600;
  margin-bottom: 6px;
}
#${OVERLAY_ID} .ks-message {
  margin-bottom: 8px;
  color: #e5e7eb;
}
#${OVERLAY_ID} .ks-steps {
  margin: 0 0 8px 18px;
  padding: 0;
}
#${OVERLAY_ID} .ks-status {
  font-size: 11px;
  color: #cbd5f5;
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
`;
