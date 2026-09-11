// Registry mapping an email_templates.key to the function that renders it.
// The keys here must exist in the email_templates table, which is what supplies
// the admin-editable subject line and the live/paused switch.
import type { EmailRenderer } from "./shared";
import { teacherInviteTemplate } from "./teacherInvite";
import { passwordResetTemplate } from "./passwordReset";
import { accountSuspendedTemplate } from "./accountSuspended";
import { supportReplyTemplate } from "./supportReply";
import { enquiryReplyTemplate } from "./enquiryReply";
import { accountDeletionScheduledTemplate } from "./accountDeletionScheduled";
import { accountDeletionReminderTemplate } from "./accountDeletionReminder";
import { accountDeletedTemplate } from "./accountDeleted";

export type EmailTemplateKey =
  | "teacher_invite"
  | "password_reset"
  | "account_suspended"
  | "support_reply"
  | "enquiry_reply"
  | "account_deletion_scheduled"
  | "account_deletion_reminder"
  | "account_deleted";

export const TEMPLATES: Record<EmailTemplateKey, EmailRenderer> = {
  teacher_invite: teacherInviteTemplate,
  password_reset: passwordResetTemplate,
  account_suspended: accountSuspendedTemplate,
  support_reply: supportReplyTemplate,
  enquiry_reply: enquiryReplyTemplate,
  account_deletion_scheduled: accountDeletionScheduledTemplate,
  account_deletion_reminder: accountDeletionReminderTemplate,
  account_deleted: accountDeletedTemplate,
};
