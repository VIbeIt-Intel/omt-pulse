import { Resend } from "resend";

export type SendMailAttachment = {
  filename: string;
  /** Base64-encoded file contents (no data: prefix). */
  content: string;
  contentType?: string;
};

export type SendMailParams = {
  to: string | string[];
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  attachments?: SendMailAttachment[];
};

export type SendMailResult = {
  sent: boolean;
  reason?: string;
  id?: string;
};

function mailFrom(): string {
  const raw = process.env.RESEND_FROM_EMAIL?.trim() || "OMT Pulse <sales@intelafri-imt.co.za>";
  // Allow either "Name <email>" or bare email
  return raw;
}

function friendlyResendReason(message: string, statusCode?: number): string {
  if (statusCode === 401 || /api key is invalid/i.test(message)) {
    return "Email service API key is invalid — set a valid RESEND_API_KEY in the server .env and restart omt-pulse";
  }
  if (/not verified|domain/i.test(message) && /from/i.test(message)) {
    return `From-address domain is not verified in Resend (check RESEND_FROM_EMAIL): ${message}`;
  }
  return message;
}

/** Shared Resend mailer for Archon invites + contact form. */
export async function sendAppEmail(params: SendMailParams): Promise<SendMailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.log("[mail] RESEND_API_KEY not set — skipping email");
    return { sent: false, reason: "RESEND_API_KEY is not set on the server" };
  }

  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from: mailFrom(),
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html,
      replyTo: params.replyTo,
      attachments: params.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        ...(a.contentType ? { contentType: a.contentType } : {}),
      })),
    });

    if (error) {
      const message = error.message || String(error);
      const statusCode =
        typeof (error as { statusCode?: unknown }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : undefined;
      const reason = friendlyResendReason(message, statusCode);
      console.error("[mail] Resend error:", message, statusCode != null ? `(status ${statusCode})` : "");
      return { sent: false, reason };
    }

    console.log(`[mail] sent id=${data?.id ?? "?"} to=${Array.isArray(params.to) ? params.to.join(",") : params.to}`);
    return { sent: true, id: data?.id };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mail] send failed:", message);
    return { sent: false, reason: friendlyResendReason(message) };
  }
}
