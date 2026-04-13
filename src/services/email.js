const BREVO_API_KEY = process.env.BREVO_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@spendex.app';
const FROM_NAME = process.env.FROM_NAME || 'Spendex';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

async function sendEmail({ to, toName, subject, htmlContent }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': BREVO_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: FROM_NAME, email: FROM_EMAIL },
      to: [{ email: to, name: toName || to }],
      subject,
      htmlContent,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Brevo error: ${err}`);
  }
}

async function sendVerificationEmail(email, name, token) {
  const url = `${APP_URL}/auth/verify?token=${token}`;
  await sendEmail({
    to: email,
    toName: name,
    subject: 'Potvrďte svůj účet – Spendex',
    htmlContent: `
      <p>Ahoj ${name || ''},</p>
      <p>Pro aktivaci účtu klikněte na odkaz níže:</p>
      <p><a href="${url}">${url}</a></p>
      <p>Odkaz je platný 24 hodin.</p>
    `,
  });
}

async function sendPasswordResetEmail(email, name, token) {
  const url = `${APP_URL}/auth/reset?token=${token}`;
  await sendEmail({
    to: email,
    toName: name,
    subject: 'Obnovení hesla – Spendex',
    htmlContent: `
      <p>Ahoj ${name || ''},</p>
      <p>Pro nastavení nového hesla klikněte na odkaz níže:</p>
      <p><a href="${url}">${url}</a></p>
      <p>Odkaz je platný 1 hodinu.</p>
    `,
  });
}

module.exports = { sendEmail, sendVerificationEmail, sendPasswordResetEmail };
