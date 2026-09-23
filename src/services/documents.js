import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import { collection, nextSequence } from '../config/database.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = process.env.VERCEL || process.env.NETLIFY
  ? path.join('/tmp', 'ranniti5-generated')
  : path.join(root, 'data', 'generated');
const logoUrl = 'https://ranniti5.bnikutch.com/__l5e/assets-v1/76b9250f-a5af-4bcb-89fa-e47c73ba89c5/ranniti-5-logo.png';
let logoBuffer;

const getLogo = async () => {
  if (logoBuffer) return logoBuffer;
  try {
    const response = await fetch(logoUrl);
    if (response.ok) logoBuffer = Buffer.from(await response.arrayBuffer());
  } catch {
    // The PDF remains usable with the text fallback when the logo host is unavailable.
  }
  return logoBuffer;
};

const pdfBuffer = (draw) => new Promise((resolve, reject) => {
  const doc = new PDFDocument({ size: 'A4', margin: 52 });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.on('error', reject);
  draw(doc);
  doc.end();
});

const writePdf = async (filename, draw) => {
  await fs.mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, filename);
  await fs.writeFile(filePath, await pdfBuffer(draw));
  return filePath;
};

export const createArtifacts = async (registration, payment) => {
  const invoices = await collection('invoices');
  const passes = await collection('entry_passes');
  const existing = await invoices.findOne({ registration_id: registration.id });
  const existingPass = existing && await passes.findOne({ registration_id: registration.id });
  const now = new Date().toISOString();
  const invoiceNumber = existing?.invoice_number || `RN5-INV-${String(await nextSequence('invoice')).padStart(3, '0')}`;
  const passNumber = existingPass?.pass_number || `RN5-${String(await nextSequence('entry_pass')).padStart(3, '0')}`;
  const qrToken = existingPass?.qr_token || `RANNITI5:${registration.id}:${uuidv4()}`;
  const logo = await getLogo();
  const eventDate = '18–20 December 2026';
  const eventVenue = 'Dhordo, Kutch';
  const drawBrand = (doc, title, number) => {
    doc.save().rect(0, 0, 595, 116).fill('#151515').restore();
    if (logo) doc.image(logo, 48, 28, { fit: [128, 54] });
    else doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(25).text('RANNITI 5', 48, 39);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18).text(title, 350, 37, { width: 197, align: 'right' });
    doc.fillColor('#e8e1dc').font('Helvetica').fontSize(9).text(number, 350, 66, { width: 197, align: 'right' });
    doc.fillColor('#d71920').rect(0, 112, 595, 4).fill();
  };
  const drawFooter = (doc) => {
    doc.fillColor('#77736f').font('Helvetica').fontSize(8).text('RANNITI 5 Strategy Summit  |  BNI Kutch  |  Dhordo, Kutch', 48, 776, { width: 499, align: 'center' });
  };
  const drawField = (doc, label, value, x, y, width) => {
    doc.fillColor('#77736f').font('Helvetica-Bold').fontSize(8).text(label.toUpperCase(), x, y, { width });
    doc.fillColor('#151515').font('Helvetica').fontSize(11).text(String(value || '—'), x, y + 13, { width });
  };
  const invoicePath = await writePdf(`${invoiceNumber}.pdf`, (doc) => {
    const amount = `INR ${Number(registration.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    const invoiceDate = new Date(now).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });
    doc.rect(0, 0, 595, 841).fill('#ffffff');
    doc.save().path('M 395 0 L 595 0 L 595 154 L 438 114 Z').fill('#b50813').restore();
    doc.save().path('M 365 0 L 595 0 L 595 132 L 420 93 Z').fill('#e11925').restore();
    if (logo) doc.image(logo, 48, 36, { fit: [215, 82] });
    else doc.fillColor('#d71920').font('Helvetica-Bold').fontSize(35).text('RANNITI 5', 48, 55);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9).text('BIGGER NETWORKS', 466, 40, { width: 100, align: 'left' });
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9).text('STRONGER BUSINESS', 466, 56, { width: 110, align: 'left' });
    doc.fillColor('#151c2b').font('Helvetica-Bold').fontSize(31).text('INVOICE', 76, 172);
    doc.fillColor('#38465c').font('Helvetica').fontSize(11).text('RANNITI 5  ·  EVENT REGISTRATION', 77, 211);
    doc.fillColor('#d71920').rect(48, 246, 499, 2).fill();
    drawField(doc, 'Invoice number', invoiceNumber, 48, 274, 160);
    doc.fillColor('#d0d5dd').rect(212, 269, 1, 46).fill();
    drawField(doc, 'Date', invoiceDate, 236, 274, 240);
    doc.fillColor('#16a05d').roundedRect(454, 270, 93, 31, 16).fill();
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10).text('✓  PAID', 454, 280, { width: 93, align: 'center' });
    doc.fillColor('#f4f5f8').roundedRect(48, 344, 499, 112, 7).fill();
    doc.fillColor('#d71920').circle(83, 400, 24).fill();
    doc.fillColor('#ffffff').circle(83, 392, 8).fill().roundedRect(72, 402, 22, 14, 7).fill();
    doc.fillColor('#68758a').font('Helvetica').fontSize(10).text('Billed to', 123, 369);
    doc.fillColor('#1d2a40').font('Helvetica-Bold').fontSize(15).text(registration.full_name, 123, 389);
    doc.fillColor('#38465c').font('Helvetica').fontSize(10).text(`✉  ${registration.email}`, 123, 414);
    doc.text(`☎  ${registration.mobile || '—'}`, 123, 433);
    drawField(doc, 'Registration ID', registration.id, 48, 488, 235);
    drawField(doc, 'Transaction ID', payment.transaction_id || 'Manual confirmation', 310, 488, 237);
    doc.fillColor('#d71920').rect(48, 548, 499, 35).fill();
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11).text('Package', 64, 560);
    doc.text('Amount', 445, 560, { width: 85, align: 'right' });
    doc.fillColor('#f9fafc').rect(48, 583, 499, 58).fill();
    doc.fillColor('#1d2a40').font('Helvetica').fontSize(10).text(registration.package_name || 'RANNITI 5 event registration', 64, 606, { width: 335 });
    doc.fillColor('#1d2a40').font('Helvetica-Bold').fontSize(11).text(amount, 400, 606, { width: 116, align: 'right' });
    doc.fillColor('#fff3f3').roundedRect(48, 662, 499, 77, 7).fill();
    doc.fillColor('#d71920').circle(83, 700, 21).fill();
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(21).text('₹', 75, 689);
    doc.fillColor('#68758a').font('Helvetica').fontSize(10).text('Amount paid', 123, 684);
    doc.fillColor('#d71920').font('Helvetica-Bold').fontSize(21).text(amount, 123, 700);
    doc.fillColor('#16a05d').roundedRect(403, 681, 113, 36, 18).fill();
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(12).text('✓  PAID', 403, 693, { width: 113, align: 'center' });
    doc.fillColor('#d71920').font('Helvetica-Oblique').fontSize(22).text('Thank You!', 48, 710);
    doc.fillColor('#38465c').font('Helvetica').fontSize(9).text('We are excited to have you join RANNITI 5.', 48, 742);
    doc.text('Your participation makes this journey stronger!', 48, 756);
    doc.save().rect(0, 775, 595, 66).fill('#151c2b').restore();
  });
  const qrData = await QRCode.toDataURL(qrToken, { margin: 1, width: 220 });
  const entryPassPath = await writePdf(`${passNumber}.pdf`, (doc) => {
    doc.rect(0, 0, 595, 841).fill('#ffffff');
    doc.save().path('M 385 0 L 595 0 L 595 158 L 438 113 Z').fill('#b50813').restore();
    doc.save().path('M 355 0 L 595 0 L 595 137 L 418 94 Z').fill('#e11925').restore();
    if (logo) doc.image(logo, 48, 37, { fit: [215, 82] });
    else doc.fillColor('#d71920').font('Helvetica-Bold').fontSize(35).text('RANNITI 5', 48, 55);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9).text('BIGGER NETWORKS', 466, 42, { width: 100 });
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9).text('STRONGER BUSINESS', 466, 58, { width: 110 });
    doc.fillColor('#d71920').roundedRect(30, 172, 535, 67, 12).fill();
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(27).text('DIGITAL ENTRY PASS', 138, 191, { width: 400, align: 'center' });
    doc.fillColor('#ffffff').lineWidth(2).moveTo(120, 184).lineTo(120, 226).stroke();
    doc.fillColor('#38465c').font('Helvetica').fontSize(17).text('R A N N I T I   5   S T R A T E G Y   S U M M I T', 32, 258, { width: 531, align: 'center' });
    doc.fillColor('#d71920').rect(32, 289, 531, 2).fill();
    doc.fillColor('#151c2b').font('Helvetica-Bold').fontSize(31).text(registration.full_name, 42, 316, { width: 510 });
    doc.fillColor('#38465c').font('Helvetica').fontSize(15).text(registration.company || registration.chapter || 'RANNITI 5 Delegate', 42, 359);
    doc.fillColor('#d71920').lineWidth(1).moveTo(298, 404).lineTo(298, 515).stroke();
    doc.fillColor('#d71920').circle(66, 423, 20).fill();
    doc.fillColor('#ffffff').circle(66, 417, 6).fill().roundedRect(57, 427, 18, 11, 6).fill();
    drawField(doc, 'Registration ID', registration.id, 96, 402, 180);
    doc.fillColor('#d71920').roundedRect(46, 474, 40, 40, 8).stroke();
    doc.fillColor('#d71920').font('Helvetica-Bold').fontSize(20).text('↔', 56, 483);
    drawField(doc, 'Entry pass', passNumber, 96, 474, 180);
    doc.fillColor('#d71920').roundedRect(322, 403, 40, 40, 8).stroke();
    doc.fillColor('#d71920').font('Helvetica-Bold').fontSize(20).text('▣', 332, 412);
    drawField(doc, 'Event', 'RANNITI 5 Strategy Summit', 374, 402, 190);
    drawField(doc, 'Dates', eventDate, 374, 445, 190);
    drawField(doc, 'Venue', eventVenue, 374, 480, 190);
    doc.roundedRect(183, 524, 229, 205, 9).lineWidth(3).strokeColor('#d71920').stroke();
    doc.image(Buffer.from(qrData.split(',')[1], 'base64'), 205, 546, { width: 185, height: 185 });
    doc.fillColor('#38465c').font('Helvetica').fontSize(10).text('PRESENT THIS PASS AT THE VENUE ENTRANCE', 75, 735, { width: 445, align: 'center' });
    doc.save().rect(0, 755, 595, 86).fill('#b50813').restore();
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9).text('CONNECT', 92, 770);
    doc.text('COLLABORATE', 244, 770);
    doc.text('CONQUER', 438, 770);
    doc.fillColor('#ffffff').fontSize(17).text('•', 185, 764).text('•', 382, 764);
  });
  const invoiceId = uuidv4();
  const passId = uuidv4();
  const invoice = existing
    ? { ...existing, file_path: invoicePath }
    : { id: invoiceId, registration_id: registration.id, invoice_number: invoiceNumber, file_path: invoicePath, created_at: now };
  const entryPass = existingPass
    ? { ...existingPass, file_path: entryPassPath }
    : { id: passId, registration_id: registration.id, pass_number: passNumber, qr_token: qrToken, file_path: entryPassPath, created_at: now };
  if (existing) await invoices.updateOne({ _id: existing._id }, { $set: { file_path: invoicePath } });
  else await invoices.insertOne(invoice);
  if (existingPass) await passes.updateOne({ _id: existingPass._id }, { $set: { file_path: entryPassPath } });
  else await passes.insertOne(entryPass);
  return { invoice, entryPass };
};

export const sendConfirmationEmail = async (registration, artifacts) => {
  const subject = 'RANNITI 5 – Payment Confirmed | Entry Pass & Invoice';
  const emailLogs = await collection('email_logs');
  const sentAt = new Date().toISOString();
  try {
    if (!process.env.BREVO_API_KEY || !process.env.BREVO_SENDER_EMAIL) throw new Error('Brevo is not configured. Set BREVO_API_KEY and BREVO_SENDER_EMAIL.');
    if (process.env.BREVO_API_KEY.startsWith('xsmtpsib-')) throw new Error('Brevo SMTP credentials cannot be used with the HTTP API. Set a Brevo v3 API key beginning with xkeysib-.');
    const attachments = await Promise.all([artifacts.invoice.file_path, artifacts.entryPass.file_path].map(async (filePath) => ({ name: path.basename(filePath), content: (await fs.readFile(filePath)).toString('base64') })));
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { accept: 'application/json', 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        sender: { name: process.env.BREVO_SENDER_NAME || 'RANNITI 5', email: process.env.BREVO_SENDER_EMAIL },
        to: [{ email: registration.email, name: registration.full_name }],
        subject,
        textContent: `Payment confirmed for ${registration.full_name}. Registration ID: ${registration.id}. Entry Pass: ${artifacts.entryPass.pass_number}.`,
        attachment: attachments,
      }),
    });
    if (!response.ok) throw new Error(`Brevo rejected email: ${await response.text()}`);
    await emailLogs.insertOne({ id: uuidv4(), registration_id: registration.id, recipient: registration.email, subject, status: 'Sent', sent_at: sentAt });
    return { status: 'Sent' };
  } catch (error) {
    await emailLogs.insertOne({ id: uuidv4(), registration_id: registration.id, recipient: registration.email, subject, status: 'Failed', sent_at: sentAt, error: error.message });
    throw error;
  }
};

export const sendPasswordResetEmail = async (user, token, appUrl) => {
  const subject = 'RANNITI 5 | Reset your password';
  const resetUrl = `${appUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
  const text = `Reset your RANNITI 5 password using this link. It expires in 30 minutes: ${resetUrl}`;
  const resetBrevoApiKey = process.env.BREVO_RESET_PASSWORD_API_KEY || process.env['BREVO_RESET-PASSWORD_API_KEY'] || process.env.BREVO_API_KEY;
  const resetBrevoSenderEmail = process.env.BREVO_RESET_PASSWORD_SENDER_EMAIL || process.env['BREVO_RESET-PASSWORD_SENDER_EMAIL'] || process.env.BREVO_SENDER_EMAIL;
  const resetBrevoSenderName = process.env.BREVO_RESET_PASSWORD_SENDER_NAME || process.env['BREVO_RESET-PASSWORD_SENDER_NAME'] || process.env.BREVO_SENDER_NAME;
  if (resetBrevoApiKey && resetBrevoSenderEmail) {
    if (resetBrevoApiKey.startsWith('xsmtpsib-')) throw new Error('Brevo SMTP credentials cannot be used with the HTTP API. Set a Brevo v3 API key beginning with xkeysib-.');
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { accept: 'application/json', 'api-key': resetBrevoApiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        sender: { name: resetBrevoSenderName || 'RANNITI 5', email: resetBrevoSenderEmail },
        to: [{ email: user.email, name: user.name }],
        subject,
        textContent: text,
      }),
    });
    if (!response.ok) throw new Error(`Brevo rejected password reset email: ${await response.text()}`);
    return;
  }
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) throw new Error('Email is not configured. Set a Brevo reset-password API key and sender email, or RESEND_API_KEY and RESEND_FROM_EMAIL.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL, to: [user.email], subject, text }),
  });
  if (!response.ok) throw new Error(`Resend rejected password reset email: ${await response.text()}`);
};