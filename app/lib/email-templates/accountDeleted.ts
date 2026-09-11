import { prose, siteUrl, DIVIDER, H1, P, SMALL, type RenderedEmail } from "./shared";

/**
 * Sent once the deletion has actually happened.
 *
 * Sent to the address stored on the deletion request row rather than looked up
 * from the account, because by this point the account is gone. That is why
 * account_deletion_requests.email exists.
 *
 * No CTA button: there is no account left to link them to, and a "come back"
 * button on the confirmation that you have honoured someone's deletion request
 * reads badly. The signup link in the closing line is enough.
 */
export function accountDeletedTemplate(
  params: Record<string, string>,
  bodyOverride?: string | null,
): RenderedEmail {
  const base = siteUrl();

  const intro =
    prose(bodyOverride) ??
    `
    <p ${P}>
      Your Jooma account has now been deleted, along with your resources,
      slideshows, timetable and badges. Thank you for giving Jooma a go.
    </p>`;

  return {
    subject: "Your Jooma account has been deleted",
    html: `
    <h1 ${H1}>Your account has been deleted</h1>
    ${intro}

    <p ${P}>
      There is nothing left for you to do, and you will not hear from us again
      unless you sign up.
    </p>

    ${DIVIDER}

    <p ${SMALL}>
      We keep a record of your invoices and payments, which the law requires us
      to hold on to even after an account closes. Everything else has gone.
    </p>
    <p ${SMALL}>
      If you ever want to come back, you can start again at
      <a href="${base}" style="color:#1D1730;font-weight:500;">jooma.ai</a>.
    </p>
  `,
  };
}
