import { Resend } from "resend";

export type SendMailParams = {
  to: string | string[];
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
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
    });

    if (error) {
      const message = error.message || String(error);
      console.error("[mail] Resend error:", message);
      return { sent: false, reason: message };
    }

    console.log(`[mail] sent id=${data?.id ?? "?"} to=${Array.isArray(params.to) ? params.to.join(",") : params.to}`);
    return { sent: true, id: data?.id };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mail] send failed:", message);
    return { sent: false, reason: message };
  }
}
