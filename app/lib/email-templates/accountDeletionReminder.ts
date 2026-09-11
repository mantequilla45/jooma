import { escapeHtml, prose, button, siteUrl, DIVIDER, H1, P, SMALL, type RenderedEmail } from "./shared";

/**
 * Sent three days before a scheduled deletion completes.
 *
 * Thirty days is long enough to forget, and the consequence is irreversible, so
 * one reminder near the end is worth the extra email. Deliberately only one:
 * somebody who has decided to leave should not be nagged every week on their
 * way out.
 *
 * Sent by the same cron that performs the deletions, while it is already
 * iterating pending rows.
 */
export function accountDeletionReminderTemplate(
  params: Record<string, string>,
  bodyOverride?: string | null,
): RenderedEmail {
  const scheduledDate = escapeHtml(params.scheduledDate);
  const base = siteUrl();
  const cancelUrl = `${base}/profile?section=delete`;

  const intro =
    prose(bodyOverride) ??
    `
    <p ${P}>
      A quick reminder that your Jooma account is due to be deleted on
      ${scheduledDate}. This is the last email you will get about it before
      that happens.
    </p>`;

  return {
    subject: "Your Jooma account will be deleted in 3 days",
    html: `
    <h1 ${H1}>Your account will be deleted in 3 days</h1>
    ${intro}

    <p ${P}>
      If you would rather stay, one click stops it and nothing is lost.
    </p>

    ${button("Keep my account", cancelUrl)}

    ${DIVIDER}

    <p ${SMALL}>
      If you meant to leave, you do not need to do anything. Your resources,
      slideshows, timetable and badges will be removed on ${scheduledDate} and
      cannot be brought back afterwards.
    </p>
  `,
  };
}
