// Stand-in values for the /admin/emails preview.
//
// Every name here matches what the real call site passes — see the trigger
// routes listed against each entry — so a preview exercises the same branches
// the live email will. Where a template changes shape depending on a parameter
// (teacher_invite reads differently with and without an inviter name), the
// sample fills it in, because the populated branch is the one that actually
// goes out.
//
// The values are deliberately obvious fakes. An admin looking at a preview
// should never be left wondering whether they are looking at a real teacher's
// details or an email that has already been sent.
import type { EmailTemplateKey } from "./index";

export const SAMPLE_PARAMS: Record<EmailTemplateKey, Record<string, string>> = {
  // app/api/admin/teachers/invite/route.ts
  teacher_invite: {
    inviteUrl: "https://jooma.app/signup?invite=sample-token",
    inviterName: "Sam Okafor",
  },

  // app/api/admin/teachers/reset-password/route.ts, and
  // app/api/auth/password-link/route.ts for the two self-serve triggers
  // (/forgot-password, and adding a password to a Google account). All three
  // pass the same two parameters, so one sample covers them.
  password_reset: {
    resetUrl: "https://jooma.app/create-password?token_hash=sample&type=recovery",
    firstName: "Priya",
  },

  // app/api/admin/teachers/suspend/route.ts — reason is optional in the real
  // send; populated here so the reason block renders and can be reviewed.
  account_suspended: {
    reason: "Repeated sharing of a single login across a department.",
  },

  // app/api/support/reply/route.ts
  support_reply: {
    subject: "Slideshow export is coming out blank",
    body: "Thanks for flagging this — we've pushed a fix. Please try the export again and let us know if it's still blank.",
    reference: "TK-1042",
    threadId: "00000000-0000-0000-0000-000000000000",
  },

  // app/api/enquiries/reply/route.ts — replyTo is filled in because the whole
  // point of this email is that it comes back to a real mailbox, and a preview
  // with the line missing would not show that.
  enquiry_reply: {
    name: "Priya Shah",
    body: "Thanks for getting in touch. For 25 teachers we'd look at a school licence, which pools credits across your staff and bills on one invoice. Happy to walk you through it on a call this week.",
    reference: "EN-1042",
    replyTo: "info@jooma.ai",
  },

  // app/api/account/deletion/route.ts. The date is pre-formatted by the caller
  // rather than passed as an ISO string, so the sample is too: a preview that
  // rendered "2026-10-13T00:00:00.000Z" would not show what lands in a mailbox.
  account_deletion_scheduled: {
    scheduledDate: "13 October 2026",
  },

  // app/api/cron/process-deletions/route.ts, three days before the deadline.
  account_deletion_reminder: {
    scheduledDate: "13 October 2026",
  },

  // app/api/cron/process-deletions/route.ts, once the deletion has run. Takes
  // no parameters: by this point there is no account left to say anything about.
  account_deleted: {},
};
