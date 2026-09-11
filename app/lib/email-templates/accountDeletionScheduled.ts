import { escapeHtml, prose, button, siteUrl, DIVIDER, H1, P, SMALL, type RenderedEmail } from "./shared";

/**
 * Sent the moment a teacher asks to delete their account.
 *
 * This is the most important of the three, because it is the only channel that
 * reaches somebody who makes the request and then never opens the app again.
 * Everything they need to change their mind has to be in here: the date, and a
 * link that takes them straight to the cancel button.
 *
 * It also doubles as the "was this you?" mail. An account deletion nobody
 * recognises is exactly the thing a teacher needs to hear about immediately,
 * which is why it sends even though the app already showed them the same date
 * on screen.
 */
export function accountDeletionScheduledTemplate(
  params: Record<string, string>,
  bodyOverride?: string | null,
): RenderedEmail {
  const scheduledDate = escapeHtml(params.scheduledDate);
  const base = siteUrl();
  const cancelUrl = `${base}/profile?section=delete`;

  // The override replaces the opening explanation only. The date block, the
  // button and the "if this wasn't you" footnote below are not editable: they
  // are the actionable parts, and an admin rewording the intro should not be
  // able to drop them.
  const intro =
    prose(bodyOverride) ??
    `
    <p ${P}>
      You asked us to delete your Jooma account. Before anything is removed we
      hold it for 30 days, so there is plenty of time to change your mind.
    </p>`;

  return {
    subject: "Your Jooma account is scheduled for deletion",
    html: `
    <h1 ${H1}>Your account is scheduled for deletion</h1>
    ${intro}

    <table cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 16px 0;background-color:#F1ECFC;border-radius:12px;">
      <tr><td style="padding:14px 16px;">
        <p style="margin:0 0 4px 0;color:#6D6683;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">Deletion date</p>
        <p style="margin:0;color:#1D1730;font-size:16px;font-weight:700;line-height:1.5;">${scheduledDate}</p>
      </td></tr>
    </table>

    <p ${P}>
      Until then your account works exactly as it did before. Nothing has been
      removed yet, and you can keep using Jooma normally.
    </p>

    ${button("Keep my account", cancelUrl)}

    ${DIVIDER}

    <p ${SMALL}>
      After ${scheduledDate} your resources, slideshows, timetable and badges
      will be permanently removed and cannot be brought back, even if you sign
      up again with the same email address. Your billing history is kept, as
      the law requires.
    </p>
    <p ${SMALL}>
      If you did not ask for this, open the link above to cancel it, and reply
      to this email so we can look into it.
    </p>
  `,
  };
}
