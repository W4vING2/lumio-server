import nodemailer from "nodemailer";
import { env } from "../config/env.js";

const isProd = env.NODE_ENV === "production";

const getTransporter = (): nodemailer.Transporter => {
  if (!env.SMTP_USER || !env.SMTP_PASS) {
    throw new Error("SMTP is not configured. Set SMTP_USER and SMTP_PASS.");
  }

  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS
    }
  });
};

export const sendVerificationEmail = async (to: string, code: string): Promise<void> => {
  if (!env.SMTP_FROM_EMAIL || !env.SMTP_USER || !env.SMTP_PASS) {
    if (isProd) {
      throw new Error("SMTP is not configured. Set SMTP_FROM_EMAIL, SMTP_USER and SMTP_PASS.");
    }
    process.stdout.write(`[Lumio email verification][dev-fallback] ${to}: ${code}\n`);
    return;
  }

  const transporter = getTransporter();
  await transporter.sendMail({
    from: env.SMTP_FROM_EMAIL,
    to,
    subject: "Код подтверждения Lumio",
    html: `
      <div style="font-family:Inter,Arial,sans-serif;line-height:1.5;color:#111">
        <h2 style="margin:0 0 12px">Подтверждение почты в Lumio</h2>
        <p style="margin:0 0 12px">Ваш код подтверждения:</p>
        <div style="font-size:28px;font-weight:700;letter-spacing:6px;margin:8px 0 16px">${code}</div>
        <p style="margin:0;color:#666">Код действует ${env.EMAIL_VERIFICATION_CODE_TTL_MIN} минут.</p>
      </div>
    `
  });
};

