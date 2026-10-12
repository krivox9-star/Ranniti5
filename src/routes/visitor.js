import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import ExcelJS from 'exceljs';
import { v4 as uuidv4 } from 'uuid';
import { collection } from '../config/database.js';
import { adminMiddleware, authMiddleware, visitorAdminMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();
const documentEncryptionKey = crypto.createHash('sha256').update(process.env.DOCUMENT_ENCRYPTION_KEY || process.env.JWT_SECRET || 'ranniti-dev-secret').digest();
const visitorFields = [
  'id', 'full_name', 'gender', 'email', 'mobile', 'company', 'business_name', 'business_category', 'business_address',
  'guest_name', 'attendee_names', 'stay_partner_1', 'stay_partner_2', 'region', 'chapter', 'gst_number', 'city',
  'date_of_birth', 'hoodie_size', 'business_intent', 'information_confirmed', 'terms_accepted',
  'package_name', 'package_price', 'gst_amount', 'gst_percent', 'total_amount', 'amount', 'status', 'registration_status',
  'payment_status', 'transaction_id', 'payment_date', 'created_at', 'updated_at',
];
const safeRegistration = (registration) => Object.fromEntries(visitorFields
  .filter((field) => registration[field] !== undefined)
  .map((field) => [field, registration[field]]));
const audit = async (action, req, details = {}) => (await collection('audit_logs')).insertOne({
  id: uuidv4(), action, actor_id: req.user.id, actor_email: req.user.email, details, created_at: new Date().toISOString(),
});
const isDuplicateKey = (error) => error?.code === 11000;

router.get('/admin/visitor-admins', authMiddleware, adminMiddleware, async (req, res) => {
  const users = await (await collection('users')).find({ role: 'visitor_admin' }, {
    projection: { _id: 0, id: 1, name: 1, email: 1, account_status: 1, created_at: 1, updated_at: 1, last_login_at: 1 },
  }).sort({ created_at: -1 }).toArray();
  return res.json({ success: true, visitorAdmins: users });
});

router.post('/admin/visitor-admins', authMiddleware, adminMiddleware, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const accountStatus = req.body?.accountStatus === 'inactive' ? 'inactive' : 'active';
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
    return res.status(400).json({ success: false, message: 'Full name, valid email, and a temporary password of at least 8 characters are required' });
  }
  const users = await collection('users');
  if (await users.findOne({ $or: [{ email }, { username: email }] })) {
    return res.status(409).json({ success: false, message: 'An account already uses this email address' });
  }
  const now = new Date().toISOString();
  const user = { id: uuidv4(), name, username: email, email, password_hash: await bcrypt.hash(password, 12), role: 'visitor_admin', account_status: accountStatus, created_at: now, updated_at: now };
  try {
    await users.insertOne(user);
  } catch (error) {
    if (isDuplicateKey(error)) return res.status(409).json({ success: false, message: 'An account already uses this email address' });
    throw error;
  }
  await audit('visitor_admin.created', req, { visitorAdminId: user.id, email, accountStatus });
  return res.status(201).json({ success: true, visitorAdmin: { id: user.id, name, email, account_status: accountStatus, created_at: now } });
});

router.patch('/admin/visitor-admins/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const users = await collection('users');
  const user = await users.findOne({ id: req.params.id, role: 'visitor_admin' });
  if (!user) return res.status(404).json({ success: false, message: 'Visitor Admin account not found' });
  const updates = {};
  if (req.body?.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) return res.status(400).json({ success: false, message: 'Full name is required' });
    updates.name = name;
  }
  if (req.body?.email !== undefined) {
    const email = String(req.body.email).trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ success: false, message: 'Enter a valid email address' });
    if (await users.findOne({ email, id: { $ne: user.id } })) return res.status(409).json({ success: false, message: 'An account already uses this email address' });
    updates.email = email;
    updates.username = email;
  }
  if (req.body?.accountStatus !== undefined) {
    if (!['active', 'inactive'].includes(req.body.accountStatus)) return res.status(400).json({ success: false, message: 'Account status must be active or inactive' });
    updates.account_status = req.body.accountStatus;
  }
  if (!Object.keys(updates).length) return res.status(400).json({ success: false, message: 'No account changes provided' });
  updates.updated_at = new Date().toISOString();
  try {
    await users.updateOne({ _id: user._id }, { $set: updates });
  } catch (error) {
    if (isDuplicateKey(error)) return res.status(409).json({ success: false, message: 'An account already uses this email address' });
    throw error;
  }
  const action = updates.account_status === 'inactive' && user.account_status !== 'inactive'
    ? 'visitor_admin.deactivated'
    : updates.account_status === 'active' && user.account_status !== 'active'
      ? 'visitor_admin.activated'
      : 'visitor_admin.updated';
  await audit(action, req, { visitorAdminId: user.id, changes: Object.keys(updates) });
  return res.json({ success: true });
});

router.post('/admin/visitor-admins/:id/reset-password', authMiddleware, adminMiddleware, async (req, res) => {
  const password = String(req.body?.password || '');
  if (password.length < 8) return res.status(400).json({ success: false, message: 'Temporary password must be at least 8 characters' });
  const users = await collection('users');
  const user = await users.findOne({ id: req.params.id, role: 'visitor_admin' });
  if (!user) return res.status(404).json({ success: false, message: 'Visitor Admin account not found' });
  await users.updateOne({ _id: user._id }, { $set: { password_hash: await bcrypt.hash(password, 12), updated_at: new Date().toISOString() }, $unset: { reset_token_hash: '', reset_token_expires_at: '' } });
  await audit('visitor_admin.password_reset', req, { visitorAdminId: user.id });
  return res.json({ success: true });
});

const loadVisitorRows = async () => {
  const registrations = await (await collection('registrations')).find().sort({ created_at: -1 }).toArray();
  const ids = registrations.map((registration) => registration.id);
  const [payments, passes, checkins, documents] = await Promise.all([
    (await collection('payments')).find({ registration_id: { $in: ids } }, { projection: { registration_id: 1, status: 1, transaction_id: 1, payment_date: 1, _id: 0 } }).toArray(),
    (await collection('entry_passes')).find({ registration_id: { $in: ids } }, { projection: { registration_id: 1, pass_number: 1, _id: 0 } }).toArray(),
    (await collection('checkins')).find({ registration_id: { $in: ids } }, { projection: { registration_id: 1, entry_pass_number: 1, checked_at: 1, checked_by: 1, _id: 0 } }).toArray(),
    (await collection('registration_documents')).find({ registration_id: { $in: ids }, type: 'professional-photo' }, { projection: { registration_id: 1, _id: 0 } }).toArray(),
  ]);
  const byRegistration = (rows) => new Map(rows.map((row) => [row.registration_id, row]));
  const paymentById = byRegistration(payments);
  const passById = byRegistration(passes);
  const checkinById = byRegistration(checkins);
  const photoIds = new Set(documents.map((document) => document.registration_id));
  return registrations.map((registration) => {
    const payment = paymentById.get(registration.id) || {};
    const pass = passById.get(registration.id) || {};
    const checkin = checkinById.get(registration.id) || null;
    const safe = safeRegistration(registration);
    return {
      ...safe,
      registrationId: registration.id,
      package: registration.package_name,
      payment_status: payment.status || registration.payment_status || 'Pending',
      transaction_id: payment.transaction_id || registration.transaction_id,
      payment_date: payment.payment_date || registration.payment_date,
      pass_number: pass.pass_number || '',
      checkin,
      has_professional_photo: photoIds.has(registration.id),
    };
  });
};

router.get('/visitor/registrations', authMiddleware, visitorAdminMiddleware, async (req, res) => {
  const query = String(req.query.search || '').trim().toLowerCase();
  const packageName = String(req.query.package || '');
  const paymentStatus = String(req.query.paymentStatus || '');
  const date = String(req.query.date || '');
  const all = await loadVisitorRows();
  let registrations = all;
  if (query) registrations = registrations.filter((item) => `${item.registrationId} ${item.full_name} ${item.email} ${item.mobile}`.toLowerCase().includes(query));
  if (packageName) registrations = registrations.filter((item) => item.package === packageName);
  if (paymentStatus) registrations = registrations.filter((item) => item.payment_status === paymentStatus);
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) registrations = registrations.filter((item) => String(item.created_at || '').slice(0, 10) === date);
  const summary = all.reduce((result, item) => {
    result.total += 1;
    result.paymentStatuses[item.payment_status] = (result.paymentStatuses[item.payment_status] || 0) + 1;
    if (item.checkin) result.checkedIn += 1;
    return result;
  }, { total: 0, checkedIn: 0, paymentStatuses: {} });
  return res.json({ success: true, registrations, summary });
});

router.get('/visitor/registration/:registrationId', authMiddleware, visitorAdminMiddleware, async (req, res) => {
  const registration = (await loadVisitorRows()).find((item) => item.registrationId === req.params.registrationId);
  if (!registration) return res.status(404).json({ success: false, message: 'Registration not found' });
  return res.json({ success: true, registration });
});

router.get('/visitor/documents/entry-pass/:registrationId', authMiddleware, visitorAdminMiddleware, async (req, res) => {
  const pass = await (await collection('entry_passes')).findOne({ registration_id: req.params.registrationId });
  if (!pass?.file_path) return res.status(404).json({ success: false, message: 'Entry pass not available' });
  return res.download(pass.file_path);
});

router.get('/visitor/documents/professional-photo/:registrationId', authMiddleware, visitorAdminMiddleware, async (req, res) => {
  if ((process.env.NODE_ENV === 'production' || process.env.VERCEL || process.env.NETLIFY || process.env.RENDER || process.env.AWS_LAMBDA_FUNCTION_NAME) && !process.env.DOCUMENT_ENCRYPTION_KEY) {
    return res.status(503).json({ success: false, message: 'Secure document storage is not configured. Set DOCUMENT_ENCRYPTION_KEY on the server.' });
  }
  const document = await (await collection('registration_documents')).findOne({ registration_id: req.params.registrationId, type: 'professional-photo' });
  if (!document) return res.status(404).json({ success: false, message: 'Professional photo not found' });
  const toBuffer = (value) => Buffer.from(Buffer.isBuffer(value) ? value : value?.value?.(true) || value?.buffer || value);
  const bytes = toBuffer(document.bytes);
  let photo = Buffer.from(bytes);
  if (document.encryption_iv && document.encryption_tag) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', documentEncryptionKey, toBuffer(document.encryption_iv));
    decipher.setAuthTag(toBuffer(document.encryption_tag));
    photo = Buffer.concat([decipher.update(bytes), decipher.final()]);
  }
  res.setHeader('Content-Type', document.content_type);
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.send(photo);
});

router.get('/visitor/registrations/export.xlsx', authMiddleware, visitorAdminMiddleware, async (req, res) => {
  const registrations = await loadVisitorRows();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Registrations');
  const columns = [
    ['Registration ID', 'registrationId'], ['Full Name', 'full_name'], ['Gender', 'gender'], ['Email', 'email'], ['Mobile Number', 'mobile'],
    ['Package', 'package'], ['Payment Status', 'payment_status'], ['Registration Status', 'registration_status'], ['Registration Date', 'created_at'],
    ['Amount', 'total_amount'], ['Company', 'company'], ['Business Name', 'business_name'], ['Business Category', 'business_category'],
    ['Business Address', 'business_address'], ['BNI Region', 'region'], ['BNI Chapter', 'chapter'], ['City', 'city'], ['Hoodie Size', 'hoodie_size'],
    ['Date of Birth', 'date_of_birth'], ['GST Number', 'gst_number'], ['Business Intent', 'business_intent'],
    ['Preferred Stay Partner 1', 'stay_partner_1'], ['Preferred Stay Partner 2', 'stay_partner_2'],
    ['Guest Name', 'guest_name'], ['Attendee Names', 'attendee_names'], ['Information Confirmed', 'information_confirmed'], ['Terms Accepted', 'terms_accepted'],
    ['Transaction ID', 'transaction_id'], ['Payment Date', 'payment_date'],
    ['Entry Pass Number', 'pass_number'], ['Check-in Date/Time', 'checkin.checked_at'],
    ['Professional Photo Link', 'photo_link'],
  ];
  sheet.columns = columns.map(([header, key]) => ({ header, key, width: Math.min(Math.max(header.length + 3, 18), 42) }));
  const safeCell = (value) => {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) value = value.join(', ');
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    const text = String(value);
    return /^[=+\-@]/.test(text) ? `'${text}` : text;
  };
  registrations.forEach((registration) => sheet.addRow(Object.fromEntries(columns.map(([, key]) => {
    const value = key === 'photo_link' && registration.has_professional_photo
      ? `/api/visitor/documents/professional-photo/${encodeURIComponent(registration.registrationId)}`
      : key.split('.').reduce((current, part) => current?.[part], registration);
    return [key, safeCell(value)];
  }))));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  await audit('visitor_admin.registrations_exported', req, { count: registrations.length });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="ranniti5-registrations.xlsx"');
  res.setHeader('Cache-Control', 'private, no-store');
  return res.send(await workbook.xlsx.writeBuffer());
});

router.post('/visitor/checkins', authMiddleware, visitorAdminMiddleware, async (req, res) => {
  const code = String(req.body?.code || '').trim();
  if (!code) return res.status(400).json({ success: false, result: 'INVALID ENTRY PASS' });
  const pass = await (await collection('entry_passes')).aggregate([
    { $match: { $or: [{ pass_number: code }, { qr_token: code }, { registration_id: code }] } },
    { $lookup: { from: 'registrations', localField: 'registration_id', foreignField: 'id', as: 'registration' } },
    { $unwind: '$registration' },
  ]).next();
  if (!pass) return res.status(404).json({ success: false, result: 'INVALID ENTRY PASS', message: 'Registration or entry pass not found' });
  const checkins = await collection('checkins');
  const existing = await checkins.findOne({ registration_id: pass.registration_id });
  if (existing) return res.status(409).json({ success: false, result: 'ALREADY CHECKED IN', checkin: existing, member: { full_name: pass.registration.full_name, registration_id: pass.registration_id, package: pass.registration.package_name, pass_number: pass.pass_number } });
  const payment = await (await collection('payments')).findOne({ registration_id: pass.registration_id });
  const paymentStatus = payment?.status || pass.registration.payment_status;
  const eligible = pass.registration.status === 'Confirmed' && ['Confirmed', 'Verified'].includes(paymentStatus);
  if (!eligible) return res.status(403).json({ success: false, result: 'PAYMENT NOT CONFIRMED', message: 'This registration is not eligible for entry', member: { full_name: pass.registration.full_name, registration_id: pass.registration_id, package: pass.registration.package_name, payment_status: paymentStatus || 'Pending' } });
  const checkin = {
    id: uuidv4(), entry_pass_number: pass.pass_number, registration_id: pass.registration_id,
    member_name: pass.registration.full_name, checked_at: new Date().toISOString(),
    method: req.body?.method === 'manual' ? 'Manual' : 'QR', checked_by: req.user.email,
    checked_by_user_id: req.user.id, checked_by_name: req.user.name,
  };
  try {
    await checkins.insertOne(checkin);
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    const previous = await checkins.findOne({ registration_id: pass.registration_id });
    return res.status(409).json({ success: false, result: 'ALREADY CHECKED IN', checkin: previous, member: { full_name: pass.registration.full_name, registration_id: pass.registration_id, package: pass.registration.package_name, pass_number: pass.pass_number } });
  }
  await audit('visitor_admin.entry_checked_in', req, { registrationId: pass.registration_id, entryPassNumber: pass.pass_number, method: checkin.method });
  return res.json({ success: true, result: 'VALID ENTRY', member: { full_name: pass.registration.full_name, registration_id: pass.registration_id, package: pass.registration.package_name, payment_status: paymentStatus, pass_number: pass.pass_number }, checkin });
});

export default router;