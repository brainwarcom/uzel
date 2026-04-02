// LoginForm — login/register form sub-component for ConnectPage.
// Pure extraction from ConnectPage.ts. No behavior changes.

import {
  createElement,
  setText,
  appendChildren,
  qs,
} from "@lib/dom";
import { createIcon } from "@lib/icons";
import uzelLogoUrl from "../../assets/uzel_logo_symbol.svg?url";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Form state machine states. */
export type FormState = "idle" | "loading" | "totp" | "connecting" | "error" | "auto-connecting";

/** Form mode: login or register. */
export type FormMode = "login" | "register";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_PASSWORD_LENGTH = 8;

// ---------------------------------------------------------------------------
// Options & Return type
// ---------------------------------------------------------------------------

export interface LoginFormOptions {
  readonly signal: AbortSignal;
  readonly onLogin: (host: string, username: string, password: string) => Promise<void>;
  readonly onRegister: (
    host: string,
    username: string,
    password: string,
    inviteCode: string,
  ) => Promise<void>;
  readonly onTotpSubmit: (code: string) => Promise<void>;
  readonly onSettingsOpen: () => void;
  readonly onAutoLoginCancel?: () => void;
}

export interface LoginFormApi {
  /** The form panel DOM element. */
  readonly element: HTMLDivElement;
  /** The status bar element (mounted separately at bottom of page). */
  readonly statusBarElement: HTMLDivElement;
  /** The TOTP overlay element (mounted separately). */
  readonly totpOverlayElement: HTMLDivElement;
  /** The auto-connecting overlay element (mounted separately). */
  readonly autoConnectOverlayElement: HTMLDivElement;
  showTotp(): void;
  showConnecting(): void;
  showAutoConnecting(serverName: string): void;
  showError(message: string): void;
  resetToIdle(): void;
  getRememberPassword(): boolean;
  getPassword(): string;
  /** Set the host input value (called when ServerPanel clicks a server). */
  setHost(host: string): void;
  /** Set credentials (called for auto-fill from profile or credential store). */
  setCredentials(username: string, password?: string): void;
  /** Get host input value (for guard checks). */
  getHost(): string;
  /** Focus the host input. */
  focusHost(): void;
  destroy(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createLoginForm(opts: LoginFormOptions): LoginFormApi {
  const { signal, onLogin, onRegister, onTotpSubmit, onSettingsOpen, onAutoLoginCancel } = opts;

  // --- internal state ---
  let formState: FormState = "idle";
  let formMode: FormMode = "login";
  let errorMessage = "";

  // --- cached DOM references ---
  let formTitle: HTMLHeadingElement;
  let hostInput: HTMLInputElement;
  let usernameInput: HTMLInputElement;
  let passwordInput: HTMLInputElement;
  let inviteGroup: HTMLDivElement;
  let inviteInput: HTMLInputElement;
  let submitBtn: HTMLButtonElement;
  let submitBtnText: HTMLSpanElement;
  let toggleModeBtn: HTMLAnchorElement;
  let errorBanner: HTMLDivElement;
  let totpInput: HTMLInputElement;
  let totpSubmitBtn: HTMLButtonElement;
  let rememberPasswordCheckbox: HTMLInputElement;
  let autoConnectServerName: HTMLSpanElement;

  // ---------------------------------------------------------------------------
  // DOM construction
  // ---------------------------------------------------------------------------

  function buildFormPanel(): HTMLDivElement {
    const panel = createElement("div", { class: "form-panel" });

    // Settings gear (top right)
    const settingsBtn = createElement("button", {
      class: "settings-gear",
      type: "button",
      "aria-label": "Настройки",
    });
    settingsBtn.textContent = "";
    settingsBtn.appendChild(createIcon("settings", 16));
    settingsBtn.addEventListener("click", () => onSettingsOpen(), { signal });

    // Form container
    const formContainer = createElement("div", { class: "form-container" });

    // Logo section
    const formLogo = createElement("div", { class: "form-logo" });
    const logoImg = createElement("img", {
      class: "oc-logo",
      src: uzelLogoUrl,
      alt: "Uzel Logo",
      width: "70",
      height: "42",
    });
    const logoTitle = createElement("h1", {}, "Uzel");
    const logoSubtitle = createElement("p", {}, "Подключение к серверу");
    appendChildren(formLogo, logoImg, logoTitle, logoSubtitle);

    // Form title
    formTitle = createElement("h1", {}, "Вход");

    // Error banner (hidden by default via CSS display:none, shown with .visible)
    errorBanner = createElement("div", {
      class: "error-banner",
      role: "alert",
    });

    // Form
    const form = createElement("form", { class: "connect-form" });
    form.setAttribute("novalidate", "");

    // Host
    const hostGroup = buildFormGroup("host", "Адрес сервера", "text", "localhost:8443");
    hostInput = qs("input", hostGroup)!;

    // Username
    const usernameGroup = buildFormGroup("username", "Имя пользователя", "text", "");
    usernameInput = qs("input", usernameGroup)!;

    // Password
    const passwordGroup = buildFormGroup("password", "Пароль", "password", "");
    passwordInput = qs("input", passwordGroup)!;

    // Remember password checkbox
    const rememberGroup = createElement("div", { class: "form-group remember-password-group" });
    rememberPasswordCheckbox = createElement("input", {
      type: "checkbox",
      id: "remember-password",
    });
    const rememberLabel = createElement("label", {
      for: "remember-password",
      class: "remember-password-label",
    }, "Запомнить пароль");
    appendChildren(rememberGroup, rememberPasswordCheckbox, rememberLabel);

    // Invite code (register only, hidden by default)
    inviteGroup = buildFormGroup("invite", "Код приглашения", "text", "");
    inviteGroup.classList.add("form-group--hidden");
    inviteInput = qs("input", inviteGroup)!;

    // Submit button
    submitBtn = createElement("button", {
      class: "btn-primary",
      type: "submit",
    });
    submitBtnText = createElement("span", { class: "btn-text" }, "Вход");
    const spinnerWrapper = createElement("span", { class: "btn-spinner" });
    const spinner = createElement("div", { class: "spinner" });
    spinnerWrapper.appendChild(spinner);
    appendChildren(submitBtn, spinnerWrapper, submitBtnText);

    // Toggle mode link
    const formSwitch = createElement("div", { class: "form-switch" });
    toggleModeBtn = createElement("a", {}, "Нет аккаунта? Зарегистрироваться");
    formSwitch.appendChild(toggleModeBtn);

    appendChildren(form, hostGroup, usernameGroup, passwordGroup, rememberGroup, inviteGroup, submitBtn, formSwitch);

    // Wire form events
    form.addEventListener("submit", handleFormSubmit, { signal });
    toggleModeBtn.addEventListener("click", handleToggleMode, { signal });

    appendChildren(formContainer, formLogo, errorBanner, form);
    appendChildren(panel, settingsBtn, formContainer);
    return panel;
  }

  function buildFormGroup(
    id: string,
    labelText: string,
    inputType: string,
    placeholder: string,
  ): HTMLDivElement {
    const group = createElement("div", { class: "form-group" });
    const label = createElement("label", { class: "form-label", for: id }, labelText);
    const input = createElement("input", {
      class: "form-input",
      id,
      name: id,
      type: inputType,
      placeholder,
      autocomplete: inputType === "password" ? "current-password" : "off",
    });
    if (id === "host") {
      input.setAttribute("required", "");
    }
    if (id === "username" || id === "password") {
      input.setAttribute("required", "");
    }

    if (inputType === "password") {
      const wrapper = createElement("div", { class: "password-wrapper" });
      const toggle = createElement("button", {
        class: "password-toggle",
        type: "button",
        "aria-label": "Показать или скрыть пароль",
      });
      toggle.appendChild(createIcon("eye", 16));
      toggle.addEventListener(
        "click",
        () => {
          const isPassword = input.getAttribute("type") === "password";
          input.setAttribute("type", isPassword ? "text" : "password");
          toggle.textContent = "";
          toggle.appendChild(createIcon(isPassword ? "eye-off" : "eye", 16));
        },
        { signal },
      );
      appendChildren(wrapper, input, toggle);
      appendChildren(group, label, wrapper);
    } else {
      appendChildren(group, label, input);
    }

    return group;
  }

  function buildTotpOverlay(): HTMLDivElement {
    const overlay = createElement("div", { class: "totp-overlay totp-overlay--hidden" });
    const card = createElement("div", { class: "totp-card" });
    const title = createElement("h2", { class: "totp-title" }, "Двухфакторная аутентификация");
    const description = createElement("p", {
      class: "totp-subtitle",
    }, "Введите 6-значный код из приложения-аутентификатора.");

    totpInput = createElement("input", {
      class: "form-input",
      type: "text",
      maxlength: "6",
      placeholder: "000000",
      inputmode: "numeric",
      pattern: "[0-9]{6}",
      autocomplete: "one-time-code",
    });

    totpSubmitBtn = createElement("button", {
      class: "btn-primary",
      type: "button",
    }, "Подтвердить");

    const cancelBtn = createElement("button", {
      class: "totp-back",
      type: "button",
    }, "Отмена");

    totpSubmitBtn.addEventListener("click", handleTotpSubmit, { signal });
    cancelBtn.addEventListener("click", handleTotpCancel, { signal });

    // Allow Enter key in TOTP input
    totpInput.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void handleTotpSubmit();
        }
      },
      { signal },
    );

    appendChildren(card, title, description, totpInput, totpSubmitBtn, cancelBtn);
    overlay.appendChild(card);
    return overlay;
  }

  function buildAutoConnectOverlay(): HTMLDivElement {
    const overlay = createElement("div", { class: "auto-connect-overlay auto-connect-overlay--hidden" });
    const card = createElement("div", { class: "auto-connect-card" });

    const spinner = createElement("div", { class: "auto-connect-spinner" });
    const spinnerEl = createElement("div", { class: "spinner" });
    spinner.appendChild(spinnerEl);

    const title = createElement("h2", { class: "auto-connect-title" }, "Автоподключение...");
    autoConnectServerName = createElement("span", { class: "auto-connect-server" });

    const cancelBtn = createElement("button", {
      class: "btn-ghost auto-connect-cancel",
      type: "button",
    }, "Отмена");

    cancelBtn.addEventListener("click", () => {
      transitionTo("idle");
      onAutoLoginCancel?.();
    }, { signal });

    appendChildren(card, spinner, title, autoConnectServerName, cancelBtn);
    overlay.appendChild(card);
    return overlay;
  }

  // ---------------------------------------------------------------------------
  // Build elements (before state transition functions that reference them)
  // ---------------------------------------------------------------------------

  const panelEl = buildFormPanel();

  // Status bar (hidden by default, shown with .visible class)
  const statusBar = createElement("div", { class: "status-bar" });
  const statusBarFill = createElement("div", { class: "status-bar-fill" });
  statusBar.appendChild(statusBarFill);

  // TOTP overlay (hidden by default)
  const totpOverlay = buildTotpOverlay();

  // Auto-connect overlay (hidden by default)
  const autoConnectOverlay = buildAutoConnectOverlay();

  // ---------------------------------------------------------------------------
  // State transitions
  // ---------------------------------------------------------------------------

  function transitionTo(state: FormState, error?: string): void {
    formState = state;
    errorMessage = error ?? "";

    // Update UI based on state
    updateSubmitButton();
    updateErrorBanner();
    updateStatusBar();
    updateTotpOverlay();
    updateAutoConnectOverlay();
    updateFormInputsDisabled();
  }

  function updateSubmitButton(): void {
    const isLoading = formState === "loading" || formState === "connecting" || formState === "auto-connecting";
    submitBtn.disabled = isLoading;
    submitBtn.classList.toggle("loading", isLoading);

    if (formState === "connecting" || formState === "auto-connecting") {
      setText(submitBtnText, "Подключение\u2026");
    } else if (formState === "loading") {
      setText(submitBtnText, formMode === "login" ? "Вход\u2026" : "Регистрация\u2026");
    } else {
      setText(submitBtnText, formMode === "login" ? "Вход" : "Зарегистрироваться");
    }
  }

  function updateErrorBanner(): void {
    if (formState === "error" && errorMessage) {
      setText(errorBanner, errorMessage);
      errorBanner.classList.add("visible");
      // The shakeX animation plays automatically via CSS on .error-banner
      // Re-trigger animation by removing and re-adding the element
      errorBanner.style.animation = "none";
      // Force reflow to restart animation
      void errorBanner.offsetWidth;
      errorBanner.style.animation = "";
    } else {
      errorBanner.classList.remove("visible");
    }
  }

  function updateStatusBar(): void {
    switch (formState) {
      case "idle":
      case "totp":
      case "error":
        statusBar.classList.remove("visible", "indeterminate");
        break;
      case "loading":
      case "connecting":
      case "auto-connecting":
        statusBar.classList.add("visible", "indeterminate");
        break;
    }
  }

  function updateTotpOverlay(): void {
    if (formState === "totp") {
      totpOverlay.classList.remove("totp-overlay--hidden");
      totpInput.value = "";
      totpInput.focus();
    } else {
      totpOverlay.classList.add("totp-overlay--hidden");
    }
  }

  function updateAutoConnectOverlay(): void {
    if (formState === "auto-connecting") {
      autoConnectOverlay.classList.remove("auto-connect-overlay--hidden");
    } else {
      autoConnectOverlay.classList.add("auto-connect-overlay--hidden");
    }
  }

  function updateFormInputsDisabled(): void {
    const disable = formState === "loading" || formState === "connecting" || formState === "auto-connecting";
    hostInput.disabled = disable;
    usernameInput.disabled = disable;
    passwordInput.disabled = disable;
    inviteInput.disabled = disable;
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  function handleToggleMode(): void {
    formMode = formMode === "login" ? "register" : "login";

    setText(formTitle, formMode === "login" ? "Вход" : "Зарегистрироваться");
    setText(submitBtnText, formMode === "login" ? "Вход" : "Зарегистрироваться");
    setText(
      toggleModeBtn,
      formMode === "login" ? "Нет аккаунта? Зарегистрироваться" : "Уже есть аккаунт? Войти",
    );

    inviteGroup.classList.toggle("form-group--hidden", formMode === "login");

    // Clear any existing error
    if (formState === "error") {
      transitionTo("idle");
    }
  }

  function validateForm(): string | null {
    const host = hostInput.value.trim();
    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!host) {
      return "Укажите адрес сервера.";
    }
    if (!username) {
      return "Укажите имя пользователя.";
    }
    if (!password) {
      return "Укажите пароль.";
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return `Пароль должен содержать не менее ${MIN_PASSWORD_LENGTH} символов.`;
    }
    if (formMode === "register") {
      const inviteCode = inviteInput.value.trim();
      if (!inviteCode) {
        return "Для регистрации нужен код приглашения.";
      }
    }
    return null;
  }

  async function handleFormSubmit(e: Event): Promise<void> {
    e.preventDefault();

    if (formState === "loading" || formState === "connecting") {
      return;
    }

    const validationError = validateForm();
    if (validationError !== null) {
      transitionTo("error", validationError);
      return;
    }

    const host = hostInput.value.trim();
    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    transitionTo("loading");

    try {
      if (formMode === "login") {
        await onLogin(host, username, password);
      } else {
        const inviteCode = inviteInput.value.trim();
        await onRegister(host, username, password, inviteCode);
      }
      // If the callback didn't throw, the caller handles navigation.
      // The caller may also call showTotp() or showError() on this page.
    } catch (err: unknown) {
      let message: string;
      if (err instanceof Error) {
        message = err.message;
      } else if (typeof err === "string") {
        message = err;
      } else if (err !== null && typeof err === "object" && "message" in err) {
        message = String((err as { message: unknown }).message);
      } else {
        message = String(err);
      }
      transitionTo("error", message);
    }
  }

  async function handleTotpSubmit(): Promise<void> {
    const code = totpInput.value.trim();
    if (code.length !== 6 || !/^\d{6}$/.test(code)) {
      // Simple inline feedback — add error class to the input
      totpInput.classList.add("error");
      setTimeout(() => totpInput.classList.remove("error"), 500);
      return;
    }

    totpSubmitBtn.disabled = true;
    setText(totpSubmitBtn, "Проверка\u2026");

    try {
      await onTotpSubmit(code);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Ошибка проверки кода.";
      transitionTo("error", message);
    } finally {
      totpSubmitBtn.disabled = false;
      setText(totpSubmitBtn, "Подтвердить");
    }
  }

  function handleTotpCancel(): void {
    transitionTo("idle");
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    element: panelEl,
    statusBarElement: statusBar,
    totpOverlayElement: totpOverlay,
    autoConnectOverlayElement: autoConnectOverlay,

    showTotp(): void {
      transitionTo("totp");
    },

    showConnecting(): void {
      transitionTo("connecting");
    },

    showAutoConnecting(serverName: string): void {
      setText(autoConnectServerName, serverName);
      transitionTo("auto-connecting");
    },

    showError(message: string): void {
      transitionTo("error", message);
    },

    resetToIdle(): void {
      transitionTo("idle");
    },

    getRememberPassword(): boolean {
      return rememberPasswordCheckbox?.checked ?? false;
    },

    getPassword(): string {
      return passwordInput?.value ?? "";
    },

    setHost(host: string): void {
      hostInput.value = host;
    },

    setCredentials(username: string, password?: string): void {
      usernameInput.value = username;
      if (password) {
        passwordInput.value = password;
        rememberPasswordCheckbox.checked = true;
      }
    },

    getHost(): string {
      return hostInput?.value ?? "";
    },

    focusHost(): void {
      hostInput.focus();
    },

    destroy(): void {
      // Cleanup is handled by the shared AbortSignal from the parent
    },
  };
}
