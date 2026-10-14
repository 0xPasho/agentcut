// Sign-in on agentcut.studio: an email, then the six-digit code Clerk emails to it. Clerk's
// own browser library, loaded from the instance's Frontend API, does the talking, so the
// session it starts is an ordinary Clerk session: the server reads it from the __session
// cookie like any other, and keeps it fresh with Clerk's handshake. An address Clerk does
// not know becomes an account on the way, so there is no separate sign-up step.
// The markup is SignInPage in src/views/account.tsx.
(() => {
  const root = document.querySelector("[data-sign-in]");
  if (!root) return;
  const { publishableKey, frontendApi, next } = root.dataset;
  const emailForm = root.querySelector('[data-step="email"]');
  const codeForm = root.querySelector('[data-step="code"]');
  const emailInput = emailForm.querySelector('input[name="email"]');
  const codeInput = codeForm.querySelector('input[name="code"]');
  const errorBox = root.querySelector("#sign-in-error");
  const errorTemplate = root.querySelector("[data-error-template]");

  /** The sign-in or sign-up Clerk is waiting on a code for, and which of the two it is. */
  let pending = null;
  let email = "";

  const clerkReady = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://${frontendApi}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`;
    script.crossOrigin = "anonymous";
    script.async = true;
    script.dataset.clerkPublishableKey = publishableKey;
    script.onload = async () => {
      try {
        await window.Clerk.load();
        resolve(window.Clerk);
      } catch (error) {
        reject(error);
      }
    };
    script.onerror = () => reject(new Error("clerk-js did not load"));
    document.head.append(script);
  });

  clerkReady.then(
    (clerk) => {
      // Already signed in on this browser: nothing to ask.
      if (clerk.user) return location.replace(next);
      emailForm.querySelector('button[type="submit"]').disabled = false;
    },
    () => showError("Sign-in could not load. Check your connection and reload the page."),
  );

  function showError(message) {
    errorBox.replaceChildren();
    if (!message) return;
    const alert = errorTemplate.content.firstElementChild.cloneNode(true);
    alert.querySelector("[data-message]").textContent = message;
    errorBox.append(alert);
  }

  /** What Clerk said, in words for the person reading it. */
  function describe(error) {
    const first = error?.errors?.[0];
    switch (first?.code) {
      case "form_code_incorrect":
        return "That code is not right. Check the email and try again.";
      case "verification_expired":
        return "That code has expired. Send a new one.";
      case "verification_failed":
      case "too_many_requests":
        return "Too many tries. Wait a minute, then send a new code.";
      case "form_param_format_invalid":
      case "form_identifier_invalid":
        return "That does not look like an email address.";
      case "session_exists":
        location.replace(next);
        return "";
    }
    if (error?.status === 429) return "Too many tries. Wait a minute, then try again.";
    return first?.longMessage || first?.message || "Something went wrong. Try again in a moment.";
  }

  /** Disables a control while it works and says what it is doing. */
  async function busy(button, work) {
    const label = button.querySelector("[data-label]");
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    if (label) label.textContent = label.dataset.busyLabel;
    try {
      return await work();
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      if (label) label.textContent = label.dataset.label;
    }
  }

  /** Asks Clerk to email a code: to the account when there is one, to a new one otherwise. */
  async function sendCode(clerk) {
    try {
      const signIn = await clerk.client.signIn.create({ identifier: email });
      const factor = signIn.supportedFirstFactors?.find((f) => f.strategy === "email_code");
      if (!factor) throw { errors: [{ longMessage: "This account cannot sign in with an email code." }] };
      await signIn.prepareFirstFactor({ strategy: "email_code", emailAddressId: factor.emailAddressId });
      pending = { kind: "sign-in", resource: signIn, factor };
    } catch (error) {
      if (error?.errors?.[0]?.code !== "form_identifier_not_found") throw error;
      const signUp = await clerk.client.signUp.create({ emailAddress: email });
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      pending = { kind: "sign-up", resource: signUp };
    }
  }

  async function resendCode() {
    if (pending.kind === "sign-in") {
      await pending.resource.prepareFirstFactor({ strategy: "email_code", emailAddressId: pending.factor.emailAddressId });
    } else {
      await pending.resource.prepareEmailAddressVerification({ strategy: "email_code" });
    }
  }

  function showStep(step) {
    emailForm.hidden = step !== "email";
    codeForm.hidden = step !== "code";
    (step === "email" ? emailInput : codeInput).focus();
  }

  emailForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    email = emailInput.value.trim();
    if (!email || !emailInput.checkValidity()) {
      emailInput.setAttribute("aria-invalid", "true");
      emailInput.focus();
      return showError(email ? "That does not look like an email address." : "Enter your email address.");
    }
    emailInput.removeAttribute("aria-invalid");
    showError("");
    const button = emailForm.querySelector('button[type="submit"]');
    try {
      await busy(button, async () => sendCode(await clerkReady));
      codeForm.querySelector("[data-email]").textContent = email;
      codeInput.value = "";
      showStep("code");
    } catch (error) {
      showError(describe(error));
    }
  });

  codeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = codeInput.value.replace(/\D/g, "");
    if (code.length !== 6) {
      codeInput.setAttribute("aria-invalid", "true");
      return showError("The code is six digits.");
    }
    codeInput.removeAttribute("aria-invalid");
    showError("");
    const button = codeForm.querySelector('button[type="submit"]');
    try {
      await busy(button, async () => {
        const clerk = await clerkReady;
        const done =
          pending.kind === "sign-in"
            ? await pending.resource.attemptFirstFactor({ strategy: "email_code", code })
            : await pending.resource.attemptEmailAddressVerification({ code });
        if (done.status !== "complete" || !done.createdSessionId) {
          throw { errors: [{ longMessage: "Clerk needs more than an email for this account. Try again in a moment." }] };
        }
        await clerk.setActive({ session: done.createdSessionId });
        // Keep the button busy until the next page replaces this one.
        location.assign(next);
        await new Promise(() => {});
      });
    } catch (error) {
      showError(describe(error));
      codeInput.select();
    }
  });

  // A pasted or autofilled code signs in without a second click.
  codeInput.addEventListener("input", () => {
    codeInput.value = codeInput.value.replace(/\D/g, "").slice(0, 6);
    const submit = codeForm.querySelector('button[type="submit"]');
    if (codeInput.value.length === 6 && !submit.disabled) codeForm.requestSubmit();
  });

  codeForm.querySelector('[data-action="restart"]').addEventListener("click", () => {
    pending = null;
    showError("");
    showStep("email");
  });

  const resend = codeForm.querySelector('[data-action="resend"]');
  resend.addEventListener("click", async () => {
    showError("");
    try {
      await busy(resend, resendCode);
      codeInput.value = "";
      codeInput.focus();
    } catch (error) {
      showError(describe(error));
    }
  });
})();
