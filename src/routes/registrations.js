import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { collection } from '../config/database.js';
import { adminMiddleware, authMiddleware } from '../middleware/authMiddleware.js';
import { createArtifacts, sendConfirmationEmail } from '../services/documents.js';

const router = express.Router();
const packages = {
  'Triple Occupancy': 17698.82,
  'Double Occupancy': 20648.82,
  '1 Member + 1 Spouse + 1 Kid (Up to 5 years)': 29999,
  '1 Member + 1 Family Member + 1 Kid (Up to 5 years)': 29999,
  '1 Member + 1 Spouse + 1 Kid (Above 5 years)': 34999,
  '1 Member + 1 Family Member + 1 Kid (Above 5 years)': 34999,
};
const publicRegistration = (r) => ({ ...r, registrationId: r.id, package: r.package_name, paymentStatus: r.payment_status, transactionId: r.transaction_id, paymentDate: r.payment_date, entryPassNumber: r.pass_number, invoiceNumber: r.invoice_number });

router.post('/registrations', async (req, res) => {
  const body = req.body || {};
  const packageName = String(body.package || '').trim();
  const amount = packages[packageName] || Number(body.amount);
  const name = String(body.fullName || body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const attendeeNames = (Array.isArray(body.attendeeNames) ? body.attendeeNames : [body.attendee1, body.attendee2, body.attendee3, body.attendee4])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  if (!name || !email || password.length < 8 || !packageName || !baseAmount) {
    return res.status(400).json({ success: false, message: !packages[packageName] && packageName ? `Unknown package: ${packageName}` : 'Name, email, password (8+ characters) and package are required' });
  }
  const id = `RN5-REG-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const now = new Date().toISOString();
  const guestName = body.guestName || attendeeNames.slice(1).join(', ');
  await (await collection('registrations')).insertOne({ id, full_name: name, email, mobile: body.mobile || '', company: body.company || '', guest_name: guestName, attendee_names: attendeeNames, region: body.region || '', chapter: body.chapter || '', gst_number: String(body.gstNumber || '').toUpperCase(), city: body.city || '', date_of_birth: body.dateOfBirth || '', hoodie_size: body.hoodieSize || '', business_intent: body.businessIntent || '', package_name: packageName, amount, status: 'Pending', created_at: now, updated_at: now });
  const users = await collection('users');
  const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const role = adminEmail && email === adminEmail ? 'admin' : 'user';
  const existing = await users.findOne({ email });
  let accountCreated = false;
  if (!existing) {
    await users.insertOne({ id: uuidv4(), name, username: email, email, password_hash: await bcrypt.hash(password, 12), role, created_at: now, updated_at: now });
    accountCreated = true;
  } else if (!existing.password_hash) {
    await users.updateOne({ _id: existing._id }, { $set: { password_hash: await bcrypt.hash(password, 12), username: existing.username || email, name: existing.name || name, role: existing.role === 'admin' ? 'admin' : role, updated_at: now } });
    accountCreated = true;
  }
  return res.status(201).json({ success: true, accountCreated, accountExists: Boolean(existing), registration: { id, amount, package: packageName } });
});

router.get('/member/dashboard', authMiddleware, async (req, res) => {
  const registrations = await (await collection('registrations')).find({ email: req.user.email }).sort({ created_at: -1 }).toArray();
  const ids = registrations.map((registration) => registration.id);
  const [payments, invoices, passes, checkins] = await Promise.all([ (await collection('payments')).find({ registration_id: { $in: ids } }).toArray(), (await collection('invoices')).find({ registration_id: { $in: ids } }).toArray(), (await collection('entry_passes')).find({ registration_id: { $in: ids } }).toArray(), (await collection('checkins')).find({ registration_id: { $in: ids } }).toArray() ]);
  const by = (rows) => new Map(rows.map((row) => [row.registration_id, row]));
  const paymentBy = by(payments); const invoiceBy = by(invoices); const passBy = by(passes); const checkinBy = by(checkins);
  return res.json({ success: true, member: { name: req.user.name, email: req.user.email }, registrations: registrations.map((registration) => ({ ...registration, password_hash: undefined, payment: paymentBy.get(registration.id) || null, invoice: invoiceBy.get(registration.id) || null, entryPass: passBy.get(registration.id) || null, checkin: checkinBy.get(registration.id) || null })) });
});

router.get('/member/documents/:type/:id', authMiddleware, async (req, res) => {
  const registration = await (await collection('registrations')).findOne({ id: req.params.id, email: req.user.email });
  if (!registration) return res.status(404).json({ success: false, message: 'Registration not found' });
  const table = req.params.type === 'invoice' ? 'invoices' : req.params.type === 'entry-pass' ? 'entry_passes' : null;
  if (!table) return res.status(400).json({ success: false, message: 'Invalid document type' });
  const document = await (await collection(table)).findOne({ registration_id: registration.id });
  if (!document) return res.status(404).json({ success: false, message: 'Document not available until payment is confirmed' });
  return res.download(document.file_path);
});

router.post('/payments/manual', async (req, res) => {
  const { registrationId, transactionId } = req.body || {};
  const registration = await (await collection('registrations')).findOne({ id: registrationId });
  if (!registration || !transactionId) return res.status(400).json({ success: false, message: 'Registration ID and transaction ID are required' });
  const now = new Date().toISOString();
  await (await collection('payments')).updateOne({ registration_id: registrationId }, { $set: { id: uuidv4(), registration_id: registrationId, transaction_id: transactionId.trim(), amount: registration.amount, status: 'Received', gateway: 'manual', payment_date: now, updated_at: now }, $setOnInsert: { created_at: now } }, { upsert: true });
  return res.json({ success: true, status: 'Received', registrationId });
});

router.post('/payments/order', async (req, res) => {
  const registration = await (await collection('registrations')).findOne({ id: req.body?.registrationId });
  if (!registration) return res.status(404).json({ success: false, message: 'Registration not found' });
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return res.status(503).json({ success: false, message: 'Razorpay is not configured. Use manual payment until gateway keys are set.' });
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const response = await fetch('https://api.razorpay.com/v1/orders', { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: Math.round(registration.amount * 100), currency: 'INR', receipt: registration.id }) });
  const order = await response.json();
  if (!response.ok) return res.status(502).json({ success: false, message: order.error?.description || 'Unable to create payment order' });
  const now = new Date().toISOString();
  await (await collection('payments')).updateOne({ registration_id: registration.id }, { $set: { id: uuidv4(), registration_id: registration.id, amount: registration.amount, status: 'Pending', gateway: 'razorpay', gateway_order_id: order.id, updated_at: now }, $setOnInsert: { created_at: now } }, { upsert: true });
  return res.json({ success: true, keyId: process.env.RAZORPAY_KEY_ID, order, registrationId: registration.id });
});

router.post('/payments/razorpay/verify', async (req, res) => {
  const { registrationId, razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body || {};
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '').update(`${orderId}|${paymentId}`).digest('hex');
  if (!signature || signature !== expected) return res.status(400).json({ success: false, message: 'Invalid payment signature' });
  const now = new Date().toISOString();
  const result = await (await collection('payments')).updateOne({ registration_id: registrationId, gateway_order_id: orderId }, { $set: { transaction_id: paymentId, status: 'Received', payment_date: now, updated_at: now } });
  if (!result.matchedCount) return res.status(404).json({ success: false, message: 'Payment order not found' });
  return res.json({ success: true, status: 'Received' });
});

router.get('/admin/registrations', authMiddleware, adminMiddleware, async (req, res) => {
  const registrations = await (await collection('registrations')).find().sort({ created_at: -1 }).toArray();
  const [payments, invoices, passes] = await Promise.all([(await collection('payments')).find().toArray(), (await collection('invoices')).find().toArray(), (await collection('entry_passes')).find().toArray()]);
  const by = (rows) => new Map(rows.map((row) => [row.registration_id, row]));
  const paymentBy = by(payments); const invoiceBy = by(invoices); const passBy = by(passes);
  return res.json({ success: true, registrations: registrations.map((r) => publicRegistration({ ...r, ...(paymentBy.get(r.id) ? { payment_status: paymentBy.get(r.id).status, transaction_id: paymentBy.get(r.id).transaction_id, payment_date: paymentBy.get(r.id).payment_date } : {}), ...(invoiceBy.get(r.id) ? { invoice_number: invoiceBy.get(r.id).invoice_number } : {}), ...(passBy.get(r.id) ? { pass_number: passBy.get(r.id).pass_number } : {}) })) });
});

router.patch('/admin/registrations/:registrationId', authMiddleware, adminMiddleware, async (req, res) => {
  const allowed = ['full_name', 'email', 'mobile', 'company', 'guest_name', 'region', 'chapter', 'gst_number', 'city', 'date_of_birth', 'hoodie_size', 'business_intent', 'package_name'];
  const updates = Object.fromEntries(Object.entries(req.body || {}).filter(([key, value]) => allowed.includes(key) && value !== undefined));
  if (!Object.keys(updates).length) return res.status(400).json({ success: false, message: 'No editable fields provided' });
  if (updates.email) updates.email = String(updates.email).trim().toLowerCase();
  if (updates.full_name) updates.full_name = String(updates.full_name).trim();
  updates.updated_at = new Date().toISOString();
  const result = await (await collection('registrations')).updateOne({ id: req.params.registrationId }, { $set: updates });
  if (!result.matchedCount) return res.status(404).json({ success: false, message: 'Registration not found' });
  return res.json({ success: true, registrationId: req.params.registrationId });
});

router.get('/admin/overview', authMiddleware, adminMiddleware, async (req, res) => {
  const [confirmed, payments, invoices, passes, checkins, emailLogs] = await Promise.all([(await collection('registrations')).find({ status: 'Confirmed' }).sort({ updated_at: -1 }).toArray(), (await collection('payments')).find().sort({ updated_at: -1 }).toArray(), (await collection('invoices')).find().sort({ created_at: -1 }).toArray(), (await collection('entry_passes')).find().sort({ created_at: -1 }).toArray(), (await collection('checkins')).find().sort({ checked_at: -1 }).toArray(), (await collection('email_logs')).find().sort({ sent_at: -1 }).toArray()]);
  return res.json({ success: true, confirmed, payments, invoices, passes, checkins, emailLogs });
});

router.post('/admin/payments/:registrationId/confirm', authMiddleware, adminMiddleware, async (req, res) => {
  const registrations = await collection('registrations');
  const payments = await collection('payments');
  const registration = await registrations.findOne({ id: req.params.registrationId });
  const payment = await payments.findOne({ registration_id: req.params.registrationId });
  if (!registration || !payment) return res.status(404).json({ success: false, message: 'Registration or payment not found' });
  if (payment.status === 'Confirmed') return res.json({ success: true, message: 'Payment already confirmed', artifacts: await createArtifacts(registration, payment) });
  const now = new Date().toISOString();
  await payments.updateOne({ registration_id: registration.id }, { $set: { status: 'Confirmed', updated_at: now, payment_date: payment.payment_date || now } });
  await registrations.updateOne({ id: registration.id }, { $set: { status: 'Confirmed', updated_at: now } });
  const artifacts = await createArtifacts(registration, { ...payment, status: 'Confirmed' });
  let email;
  try { email = await sendConfirmationEmail(registration, artifacts); } catch (error) { return res.status(502).json({ success: false, message: error.message, artifacts }); }
  return res.json({ success: true, registrationId: registration.id, artifacts, email });
});

router.post('/admin/payments/:registrationId/resend', authMiddleware, adminMiddleware, async (req, res) => {
  const registration = await (await collection('registrations')).findOne({ id: req.params.registrationId });
  const payment = await (await collection('payments')).findOne({ registration_id: req.params.registrationId });
  if (!registration || !payment || payment.status !== 'Confirmed') return res.status(400).json({ success: false, message: 'Payment must be confirmed before sending email' });
  try {
    await sendConfirmationEmail(registration, await createArtifacts(registration, payment));
  } catch (error) {
    return res.status(502).json({ success: false, message: error.message });
  }
  return res.json({ success: true, message: 'Confirmation email sent' });
});

router.get('/admin/documents/:type/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const table = req.params.type === 'invoice' ? 'invoices' : 'entry_passes';
  const row = await (await collection(table)).findOne({ $or: [{ registration_id: req.params.id }, { id: req.params.id }] });
  if (!row) return res.status(404).json({ success: false, message: 'Document not found' });
  return res.download(row.file_path);
});

router.post('/admin/checkins', authMiddleware, adminMiddleware, async (req, res) => {
  const code = String(req.body.code || '').trim();
  const pass = await (await collection('entry_passes')).aggregate([{ $match: { $or: [{ pass_number: code }, { qr_token: code }] } }, { $lookup: { from: 'registrations', localField: 'registration_id', foreignField: 'id', as: 'registration' } }, { $unwind: '$registration' }]).next();
  if (!pass) return res.status(404).json({ success: false, result: 'INVALID ENTRY PASS' });
  if (pass.registration.status !== 'Confirmed') return res.status(403).json({ success: false, result: 'PAYMENT NOT CONFIRMED', member: pass.registration.full_name });
  const checkins = await collection('checkins');
  const existing = await checkins.findOne({ registration_id: pass.registration_id });
  if (existing) return res.status(409).json({ success: false, result: 'ALREADY CHECKED IN', checkin: existing, member: pass.registration.full_name });
  const checkin = { id: uuidv4(), entry_pass_number: pass.pass_number, registration_id: pass.registration_id, member_name: pass.registration.full_name, checked_at: new Date().toISOString(), method: req.body.method === 'manual' ? 'Manual' : 'QR', checked_by: req.user.email };
  await checkins.insertOne(checkin);
  return res.json({ success: true, result: 'ENTRY VERIFIED', member: { ...pass.registration, pass_number: pass.pass_number }, checkin });
});

router.get('/admin/checkins.csv', authMiddleware, adminMiddleware, async (req, res) => {
  const rows = await (await collection('checkins')).find().sort({ checked_at: -1 }).toArray();
  const csv = ['Entry Pass Number,Registration ID,Member,Date,Time,Method,Checked By', ...rows.map((r) => { const date = new Date(r.checked_at); return [r.entry_pass_number, r.registration_id, r.member_name, date.toLocaleDateString('en-IN'), date.toLocaleTimeString('en-IN'), r.method, r.checked_by].map((v) => `"${String(v).replaceAll('"', '""')}"`).join(','); })].join('\n');
  res.type('text/csv').attachment('ranniti5-check-in-log.csv').send(csv);
});

export default router;
