import { env } from "../config/env.js";

const isProd = env.NODE_ENV === "production";

export const sendVerificationEmail = async (to: string, code: string): Promise<void> => {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    if (isProd) {
      throw new Error("Resend is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL.");
    }
    process.stdout.write(`[Lumio email verification][dev-fallback] ${to}: ${code}\n`);
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: [to],
      subject: "Код подтверждения Lumio",
      html: `
        <div style="font-family:Inter,Arial,sans-serif;line-height:1.5;color:#111">
          <h2 style="margin:0 0 12px">Подтверждение почты в Lumio</h2>
          <p style="margin:0 0 12px">Ваш код подтверждения:</p>
          <div style="font-size:28px;font-weight:700;letter-spacing:6px;margin:8px 0 16px">${code}</div>
          <p style="margin:0;color:#666">Код действует ${env.EMAIL_VERIFICATION_CODE_TTL_MIN} минут.</p>
        </div>
      `
    })
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Resend request failed (${response.status}): ${details}`);
  }
};

