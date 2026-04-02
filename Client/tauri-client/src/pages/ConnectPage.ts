// ConnectPage — login/register page component.
// Thin composition shell that wires ServerPanel and LoginForm together.

import { createElement, appendChildren } from "@lib/dom";
import type { MountableComponent } from "@lib/safe-render";
import { openSettings, closeSettings, uiStore, setTransientError } from "@stores/ui.store";
import { createSettingsOverlay } from "@components/SettingsOverlay";
import type { HealthStatus } from "@lib/profiles";
import { createServerPanel } from "./connect-page/ServerPanel";
import { createLoginForm } from "./connect-page/LoginForm";
import { loadCredential } from "@lib/credentials";
import uzelLogoUrl from "../assets/uzel_logo_symbol.svg?url";

// ---------------------------------------------------------------------------
// Re-exports (public API must not change)
// ---------------------------------------------------------------------------

export type { FormState, FormMode } from "./connect-page/LoginForm";
export type { SimpleProfile } from "./connect-page/ServerPanel";

import type { SimpleProfile } from "./connect-page/ServerPanel";

/** Callbacks for external wiring (API integration added later). */
export interface ConnectPageCallbacks {
  onLogin(host: string, username: string, password: string): Promise<void>;
  onRegister(
    host: string,
    username: string,
    password: string,
    inviteCode: string,
  ): Promise<void>;
  onTotpSubmit(code: string): Promise<void>;
  onAddProfile?(name: string, host: string): void;
  onDeleteProfile?(profileId: string): void;
  onToggleAutoLogin?(profileId: string, enabled: boolean): void;
  onAutoLoginCancel?(): void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PROFILES: readonly SimpleProfile[] = [
  { name: "Local Server", host: "localhost:8443" },
];

// ---------------------------------------------------------------------------
// ConnectPage
// ---------------------------------------------------------------------------

export function createConnectPage(
  callbacks: ConnectPageCallbacks,
  initialProfiles: readonly SimpleProfile[] = DEFAULT_PROFILES,
): MountableComponent & {
  showTotp(): void;
  showConnecting(): void;
  showAutoConnecting(serverName: string): void;
  showError(message: string): void;
  resetToIdle(): void;
  updateHealthStatus(host: string, status: HealthStatus): void;
  getRememberPassword(): boolean;
  getPassword(): string;
  /** Re-render the server profile list with updated data. */
  refreshProfiles(profiles: readonly SimpleProfile[]): void;
  /** Pre-select a server by host — fills the login form and loads saved credentials. */
  selectServer(host: string, username?: string): void;
} {
  let container: Element | null = null;
  let root: HTMLDivElement;

  // Cleanup tracking
  const abortController = new AbortController();
  const { signal } = abortController;

  // --- Create sub-components ---

  const loginForm = createLoginForm({
    signal,
    onLogin: callbacks.onLogin,
    onRegister: callbacks.onRegister,
    onTotpSubmit: callbacks.onTotpSubmit,
    onSettingsOpen: () => openSettings(),
    onAutoLoginCancel: callbacks.onAutoLoginCancel,
  });

  const serverPanel = createServerPanel(
    {
      signal,
      onServerClick(host: string, username?: string) {
        loginForm.setHost(host);
        if (username) {
          loginForm.setCredentials(username);
        }
      },
      onCredentialLoaded(host: string, username: string, password?: string) {
        // Guard: user may have clicked a different profile while loading
        if (loginForm.getHost() === host) {
          loginForm.setCredentials(username, password);
        }
      },
      onAddProfile: callbacks.onAddProfile,
      onDeleteProfile: callbacks.onDeleteProfile,
      onToggleAutoLogin: callbacks.onToggleAutoLogin,
    },
    initialProfiles,
  );

  // ---------------------------------------------------------------------------
  // DOM construction
  // ---------------------------------------------------------------------------

  function buildRoot(): HTMLDivElement {
    root = createElement("div", { class: "connect-page" });

    // Uzel branding — prepended to server panel
    const branding = createElement("div", { class: "server-branding" });
    const logoImg = createElement("img", {
      class: "oc-logo",
      src: uzelLogoUrl,
      alt: "Uzel Logo",
      width: "80",
      height: "48",
    });
    branding.appendChild(logoImg);

    const brandName = createElement("div", { class: "brand-name" }, "Uzel");
    const brandTag = createElement("div", { class: "brand-tagline" }, "Self-hosted chat \u2014 your node, your rules");
    appendChildren(branding, brandName, brandTag);

    serverPanel.element.insertBefore(branding, serverPanel.element.firstChild);

    appendChildren(root, serverPanel.element, loginForm.element);

    // Status bar at bottom
    root.appendChild(loginForm.statusBarElement);

    // TOTP overlay
    root.appendChild(loginForm.totpOverlayElement);

    // Auto-connect overlay
    root.appendChild(loginForm.autoConnectOverlayElement);

    return root;
  }

  // ---------------------------------------------------------------------------
  // MountableComponent
  // ---------------------------------------------------------------------------

  let settingsOverlay: ReturnType<typeof createSettingsOverlay> | null = null;

  function mount(target: Element): void {
    container = target;
    const rootEl = buildRoot();
    container.appendChild(rootEl);

    // Mount settings overlay on the connect page (unauthenticated — account actions are no-ops)
    settingsOverlay = createSettingsOverlay({
      isAuthenticated: false,
      onClose: () => closeSettings(),
      onChangePassword: () => Promise.resolve(),
      onUpdateProfile: () => Promise.resolve(),
      onLogout: () => {},
      onDeleteAccount: () => Promise.resolve(),
      onStatusChange: () => {},
      onEnableTotp: () => Promise.reject(new Error("Not authenticated")),
      onConfirmTotp: () => Promise.reject(new Error("Not authenticated")),
      onDisableTotp: () => Promise.reject(new Error("Not authenticated")),
    });
    settingsOverlay.mount(rootEl);

    // Show any pending auth error (e.g. "already connected from another client")
    const pendingError = uiStore.getState().transientError;
    if (pendingError) {
      loginForm.showError(pendingError);
      setTransientError(null);
    }

    // Focus the first input
    loginForm.focusHost();
  }

  function destroy(): void {
    // Abort all event listeners registered with the signal
    abortController.abort();
    settingsOverlay?.destroy?.();
    settingsOverlay = null;

    if (container && root) {
      container.removeChild(root);
    }
    container = null;
  }

  return {
    mount,
    destroy,
    showTotp: () => loginForm.showTotp(),
    showConnecting: () => loginForm.showConnecting(),
    showAutoConnecting: (serverName: string) => loginForm.showAutoConnecting(serverName),
    showError: (message: string) => loginForm.showError(message),
    resetToIdle: () => loginForm.resetToIdle(),
    updateHealthStatus: (host: string, status: HealthStatus) =>
      serverPanel.updateHealthStatus(host, status),
    getRememberPassword: () => loginForm.getRememberPassword(),
    getPassword: () => loginForm.getPassword(),
    refreshProfiles(profiles: readonly SimpleProfile[]): void {
      serverPanel.renderProfiles(profiles);
    },
    selectServer(host: string, username?: string): void {
      loginForm.setHost(host);
      if (username) {
        loginForm.setCredentials(username);
      }
      // Load saved credentials asynchronously (same flow as clicking a server card)
      void (async () => {
        try {
          const cred = await loadCredential(host);
          if (cred && loginForm.getHost() === host) {
            loginForm.setCredentials(cred.username, cred.password);
          }
        } catch {
          // Credential loading is best-effort; user can type manually
        }
      })();
    },
  };
}

export type ConnectPage = ReturnType<typeof createConnectPage>;
