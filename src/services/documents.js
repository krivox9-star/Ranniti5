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

const numberWords = (value) => {
  const small = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const wordsBelowHundred = (number) => number < 20 ? small[number] : `${tens[Math.floor(number / 10)]}${number % 10 ? ` ${small[number % 10]}` : ''}`;
  const wordsBelowThousand = (number) => `${number >= 100 ? `${small[Math.floor(number / 100)]} Hundred${number % 100 ? ' ' : ''}` : ''}${number % 100 ? wordsBelowHundred(number % 100) : ''}`;
  const groups = [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand'], [100, 'Hundred']];
  let remaining = Math.floor(Math.max(0, Number(value) || 0));
  const parts = [];
  for (const [size, label] of groups) {
    const count = Math.floor(remaining / size);
    if (count) {
      parts.push(`${count < 1000 ? wordsBelowThousand(count) : numberWords(count)} ${label}`);
      remaining %= size;
    }
  }
  if (remaining) parts.push(wordsBelowHundred(remaining));
  return parts.join(' ') || 'Zero';
};

const amountInWords = (amount) => {
  const paise = Math.round((Number(amount) || 0) * 100);
  const rupees = Math.floor(paise / 100);
  const remainder = paise % 100;
  return `Indian Rupees ${numberWords(rupees)}${remainder ? ` and ${numberWords(remainder)} Paise` : ''} Only`;
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
  const eventDate = '18–20 December 2026';
  const eventVenue = 'Dhordo, Kutch';
  const supplierName = process.env.GST_SUPPLIER_NAME || 'IMPERIAL INNOVENTURES';
  const supplierAddress = (process.env.GST_SUPPLIER_ADDRESS || 'GROUND FLOOR, SHOP NO. 5|PLOT NO. 231, WARD - 12B|RATNAKALA ARCADE|GANDHIDHAM').split('|');
  const supplierGstNumber = process.env.GST_SUPPLIER_GSTIN || '24ADSPV9796P1ZW';
  const supplierState = process.env.GST_SUPPLIER_STATE || 'Gujarat';
  const supplierStateCode = process.env.GST_SUPPLIER_STATE_CODE || supplierGstNumber.slice(0, 2);
  const supplierPan = process.env.GST_SUPPLIER_PAN || 'ADSPV9796P';
  const hsnSac = process.env.GST_HSN_SAC || '998311';
  const drawFooter = (doc) => {
    doc.fillColor('#77736f').font('Helvetica').fontSize(8).text('RANNITI 5 Strategy Summit  |  BNI Kutch  |  Dhordo, Kutch', 48, 776, { width: 499, align: 'center' });
  };
  const drawField = (doc, label, value, x, y, width) => {
    doc.fillColor('#77736f').font('Helvetica-Bold').fontSize(8).text(label.toUpperCase(), x, y, { width });
    drawFitText(doc, value || '-', x, y + 13, width, { color: '#151515', fontSize: 11, minFontSize: 8, ellipsis: true });
  };
  const drawFitText = (doc, value, x, y, width, { color = '#151515', font = 'Helvetica', fontSize = 11, minFontSize = 8, align = 'left', ellipsis = true } = {}) => {
    let text = String(value || '-');
    let size = fontSize;
    doc.font(font);
    while (size > minFontSize && doc.widthOfString(text, { size }) > width) size -= 0.5;
    if (doc.widthOfString(text, { size }) > width && ellipsis) {
      while (text.length > 1 && doc.widthOfString(`${text}...`, { size }) > width) text = text.slice(0, -1).trimEnd();
      text = `${text}...`;
    }
    doc.fillColor(color).font(font).fontSize(size).text(text, x, y, { width, lineBreak: false, align, ellipsis: ellipsis && false });
  };
  const drawHeaderText = (doc, text, x, y, width) => {
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8).text(text, x, y, { width, align: 'left' });
  };
  const invoicePath = await writePdf(`${invoiceNumber}.pdf`, (doc) => {
    const total = Number(registration.amount ?? registration.total_amount ?? 0);
    const taxRate = Number(registration.gst_percent || 18);
    const taxable = Number(registration.package_price ?? total / (1 + taxRate / 100));
    const taxTotal = Number(registration.gst_amount ?? total - taxable);
    const roundOff = Math.round((total - taxable - taxTotal) * 100) / 100;
    const buyerGstNumber = String(registration.gst_number || '').toUpperCase();
    const buyerState = registration.business_state || (buyerGstNumber ? `State code ${buyerGstNumber.slice(0, 2)}` : supplierState);
    const sameState = buyerGstNumber
      ? buyerGstNumber.slice(0, 2) === supplierStateCode
      : buyerState.trim().toLowerCase() === supplierState.trim().toLowerCase();
    const cgst = sameState ? Math.round(taxTotal / 2 * 100) / 100 : 0;
    const sgst = sameState ? Math.round((taxTotal - cgst) * 100) / 100 : 0;
    const igst = sameState ? 0 : taxTotal;
    const format = (value) => Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const invoiceDate = new Date(now).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
    const left = 38;
    const width = 519;
    const border = '#555555';
    const drawBox = (x, y, w, h) => doc.rect(x, y, w, h).lineWidth(0.6).strokeColor(border).stroke();
    const cell = (x, y, w, h, value, { bold = false, align = 'left', size = 8, padding = 5 } = {}) => {
      drawBox(x, y, w, h);
      doc.fillColor('#111111').font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size)
        .text(String(value ?? ''), x + padding, y + padding, { width: w - padding * 2, height: h - padding * 2, align, valign: 'center' });
    };
    const text = (value, x, y, w, { bold = false, size = 8, align = 'left' } = {}) => {
      doc.fillColor('#111111').font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size)
        .text(String(value ?? ''), x, y, { width: w, align, lineGap: 1 });
    };
    const amountY = 314;
    const columns = [26, 211, 55, 45, 63, 30, 89];
    const columnX = columns.map((_, index) => left + columns.slice(0, index).reduce((sum, columnWidth) => sum + columnWidth, 0));
    const row = (y, height, values, options = {}) => columns.forEach((columnWidth, index) => cell(columnX[index], y, columnWidth, height, values[index], { ...options, align: index === 1 ? 'left' : index === 0 || index === 2 ? 'center' : 'right' }));
    const supplierLines = [supplierName, ...supplierAddress, `GSTIN/UIN: ${supplierGstNumber}`, `State Name: ${supplierState}, Code: ${supplierStateCode}`];
    const billedName = registration.business_name || registration.company || registration.full_name || 'Member';
    const billedAddress = [registration.business_address, [registration.city, registration.business_state].filter(Boolean).join(', ')].filter(Boolean).join('\n');
    const paymentReference = payment.transaction_id || 'Manual confirmation';

    doc.rect(0, 0, 595, 842).fill('#ffffff');
    text('Tax Invoice', left, 28, width, { bold: true, size: 17, align: 'center' });
    drawBox(left, 57, 310, 136);
    supplierLines.forEach((line, index) => text(line, left + 7, 65 + index * 17, 296, { bold: index === 0, size: index === 0 ? 11 : 8 }));
    const metaX = left + 310;
    cell(metaX, 57, 108, 34, 'Invoice No.', { size: 8 });
    cell(metaX + 108, 57, 101, 34, 'Dated', { size: 8 });
    cell(metaX, 91, 108, 38, invoiceNumber, { bold: true, size: 8 });
    cell(metaX + 108, 91, 101, 38, invoiceDate, { bold: true, size: 8 });
    cell(metaX, 129, 108, 30, 'Payment reference', { size: 8 });
    cell(metaX + 108, 129, 101, 30, 'Status', { size: 8 });
    cell(metaX, 159, 108, 34, paymentReference, { size: 7 });
    cell(metaX + 108, 159, 101, 34, 'PAID', { bold: true, size: 9 });

    drawBox(left, 193, 310, 111);
    text('Buyer (Bill to)', left + 7, 200, 296, { size: 8 });
    text(billedName, left + 7, 216, 296, { bold: true, size: 10 });
    text(`Attn: ${registration.full_name || ''}`, left + 7, 232, 296, { size: 8 });
    text(billedAddress || 'Address not provided', left + 7, 247, 296, { size: 8 });
    text(`GSTIN/UIN: ${buyerGstNumber || 'Unregistered recipient'}`, left + 7, 278, 296, { size: 8 });
    text(`State / Place of Supply: ${buyerState}`, left + 7, 291, 296, { size: 8 });
    drawBox(metaX, 193, 209, 111);
    text('Registration ID', metaX + 7, 201, 195, { size: 8 });
    text(registration.id, metaX + 7, 217, 195, { bold: true, size: 8 });
    text('Description of service', metaX + 7, 239, 195, { size: 8 });
    text('RANNITI 5 event registration', metaX + 7, 255, 195, { bold: true, size: 8 });
    text('Supply: event registration service', metaX + 7, 277, 195, { size: 8 });

    row(amountY, 31, ['Sl No.', 'Particulars', 'HSN/SAC', 'Quantity', 'Rate', 'per', 'Amount'], { bold: true, size: 7 });
    row(amountY + 31, 34, ['1', registration.package_name || 'RANNITI 5 event registration', hsnSac, '1', format(taxable), 'Event', format(taxable)], { size: 7 });
    let currentY = amountY + 65;
    if (cgst || igst) {
      row(currentY, 27, ['', sameState ? `OUTPUT CGST @ ${taxRate / 2}%` : `OUTPUT IGST @ ${taxRate}%`, '', '', sameState ? `${format(taxRate / 2)}%` : `${format(taxRate)}%`, '', format(sameState ? cgst : igst)], { size: 7 });
      currentY += 27;
    }
    if (sgst) {
      row(currentY, 27, ['', `OUTPUT SGST @ ${taxRate / 2}%`, '', '', `${format(taxRate / 2)}%`, '', format(sgst)], { size: 7 });
      currentY += 27;
    }
    if (roundOff) {
      row(currentY, 27, ['', 'ROUND OFF', '', '', '', '', format(roundOff)], { size: 7 });
      currentY += 27;
    }
    row(currentY, 30, ['', '', '', '', '', 'Total', `₹ ${format(total)}`], { bold: true, size: 8 });
    currentY += 30;
    cell(left, currentY, width, 43, `Amount Chargeable (in words): ${amountInWords(total)}`, { bold: true, size: 8 });
    currentY += 43;

    const taxColumns = [115, 83, 51, 67, 51, 67, 85];
    const taxX = taxColumns.map((_, index) => left + taxColumns.slice(0, index).reduce((sum, columnWidth) => sum + columnWidth, 0));
    const taxHeadings = ['HSN/SAC', 'Taxable Value', sameState ? 'CGST Rate' : 'IGST Rate', sameState ? 'CGST Amount' : 'IGST Amount', 'SGST Rate', 'SGST Amount', 'Tax Amount'];
    taxColumns.forEach((columnWidth, index) => cell(taxX[index], currentY, columnWidth, 33, taxHeadings[index], { bold: true, align: 'center', size: 6 }));
    currentY += 33;
    const taxValues = [hsnSac, format(taxable), sameState ? `${format(taxRate / 2)}%` : `${format(taxRate)}%`, format(sameState ? cgst : igst), sameState ? `${format(taxRate / 2)}%` : '-', format(sgst), format(taxTotal)];
    taxColumns.forEach((columnWidth, index) => cell(taxX[index], currentY, columnWidth, 25, taxValues[index], { align: index ? 'right' : 'center', size: 7 }));
    currentY += 25;
    const taxTotals = ['Total', format(taxable), '', format(sameState ? cgst : igst), '', format(sgst), format(taxTotal)];
    taxColumns.forEach((columnWidth, index) => cell(taxX[index], currentY, columnWidth, 25, taxTotals[index], { bold: true, align: index ? 'right' : 'center', size: 7 }));
    currentY += 31;
    text(`Tax Amount (in words): ${amountInWords(taxTotal)}`, left, currentY, width, { size: 8 });
    currentY += 34;
    drawBox(left, currentY, width, 63);
    text(`Company's PAN: ${supplierPan}`, left + 7, currentY + 9, 220, { size: 8 });
    text(`for ${supplierName}`, left + 220, currentY + 9, 292, { bold: true, size: 8, align: 'right' });
    text('Authorised Signatory', left + 220, currentY + 42, 292, { size: 8, align: 'right' });
    text('This is a Computer Generated Invoice', left, currentY + 72, width, { size: 8, align: 'center' });
  });
  const qrData = await QRCode.toDataURL(qrToken, { margin: 1, width: 220 });
  const entryPassPath = await writePdf(`${passNumber}.pdf`, (doc) => {
    doc.rect(0, 0, 595, 841).fill('#ffffff');
    doc.save().path('M 385 0 L 595 0 L 595 158 L 438 113 Z').fill('#b50813').restore();
    doc.save().path('M 355 0 L 595 0 L 595 137 L 418 94 Z').fill('#e11925').restore();
    drawHeaderText(doc, 'BIGGER NETWORKS', 450, 42, 120);
    drawHeaderText(doc, 'STRONGER BUSINESS', 450, 58, 120);
    doc.fillColor('#d71920').roundedRect(30, 172, 535, 67, 12).fill();
    drawFitText(doc, 'DIGITAL ENTRY PASS', 50, 191, 495, { color: '#ffffff', font: 'Helvetica-Bold', fontSize: 27, minFontSize: 18, align: 'center' });
    doc.fillColor('#38465c').font('Helvetica').fontSize(17).text('RANNITI 5 STRATEGY SUMMIT', 32, 258, { width: 531, align: 'center', characterSpacing: 2 });
    doc.fillColor('#d71920').rect(32, 289, 531, 2).fill();
    drawFitText(doc, registration.full_name, 42, 316, 510, { color: '#151c2b', font: 'Helvetica-Bold', fontSize: 31, minFontSize: 16 });
    drawFitText(doc, registration.company || registration.chapter || 'RANNITI 5 Delegate', 42, 359, 510, { color: '#38465c', fontSize: 15, minFontSize: 10 });
    doc.fillColor('#d71920').lineWidth(1).moveTo(298, 404).lineTo(298, 515).stroke();
    doc.fillColor('#d71920').circle(66, 423, 20).fill();
    doc.fillColor('#ffffff').circle(66, 417, 6).fill().roundedRect(57, 427, 18, 11, 6).fill();
    drawField(doc, 'Registration ID', registration.id, 96, 402, 180);
    doc.fillColor('#d71920').roundedRect(46, 474, 40, 40, 8).stroke();
    doc.fillColor('#d71920').font('Helvetica-Bold').fontSize(11).text('ID', 46, 489, { width: 40, align: 'center' });
    drawField(doc, 'Entry pass', passNumber, 96, 474, 180);
    doc.fillColor('#d71920').roundedRect(322, 403, 40, 40, 8).stroke();
    doc.fillColor('#d71920').font('Helvetica-Bold').fontSize(11).text('EV', 322, 418, { width: 40, align: 'center' });
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
        textContent: `Payment confirmed for ${registration.full_name}. Your GST tax invoice and entry pass are attached. Please check that the billing name, address, and GSTIN are correct for your records. Registration ID: ${registration.id}. Entry Pass: ${artifacts.entryPass.pass_number}.`,
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