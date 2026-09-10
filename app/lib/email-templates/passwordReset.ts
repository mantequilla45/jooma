import { button, escapeHtml, prose, DIVIDER, H1, P, SMALL, type RenderedEmail } from "./shared";

/**
 * Sent for all three password links, which are the same email:
 *
 *   - an admin resetting from the Teachers drawer
 *     (app/api/admin/teachers/reset-password/route.ts)
 *   - a teacher who used /forgot-password
 *   - a Google teacher adding a password from /profile
 *     (both via app/api/auth/password-link/route.ts)
 *
 * The wording is deliberately neutral about who started it. It used to say
 * "someone on the Jooma team started a password reset", which was true when an
 * admin was the only trigger and became a lie the moment a teacher could do it
 * themselves. Naming the wrong actor in a security email is worse than naming
 * none: a teacher who reset their own password would read that we did it.
 *
 * What matters to the reader is unchanged and stays explicit: this was
 * requested, and ignoring it costs them nothing. A reset email the recipient
 * didn't ask for reads as a breach attempt otherwise.
 */
export function passwordResetTemplate(
  params: Record<string, string>,
  bodyOverride?: string | null,
): RenderedEmail {
  const resetUrl = params.resetUrl ?? "#";
  const firstName = escapeHtml(params.firstName);

  // Override replaces the explanation only. The footnote below the button
  // stays: "if you didn't ask for this, nothing has changed" is a security
  // notice, not marketing copy, and it should not be editable away.
  const intro =
    prose(bodyOverride) ??
    `
    <p ${P}>
      ${firstName ? `Hi ${firstName}, a` : "A"} password reset was requested for
      your Jooma account. Click below to choose a new password.
    </p>`;

  return {
    subject: "Reset your Jooma password",
    html: `
    <h1 ${H1}>Reset your password</h1>
    ${intro}

    ${button("Choose a new password", resetUrl)}

    ${DIVIDER}

    <p ${SMALL}>
      This link expires shortly and can only be used once. If you didn&rsquo;t ask
      for a reset you can ignore this email. Your current password will keep
      working and nothing has changed.
    </p>
  `,
  };
}
