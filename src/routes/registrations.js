import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { v4 as uuidv4 } from 'uuid';
import { collection } from '../config/database.js';
import { adminMiddleware, authMiddleware } from '../middleware/authMiddleware.js';
import { createArtifacts, sendConfirmationEmail } from '../services/documents.js';

const router = express.Router();
const documentEncryptionKey = crypto.createHash('sha256').update(process.env.DOCUMENT_ENCRYPTION_KEY || process.env.JWT_SECRET || 'ranniti-dev-secret').digest();
const acceptedDocuments = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const acceptedPhotos = new Set(['image/jpeg', 'image/png', 'image/webp']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 2 },
  fileFilter: (req, file, callback) => callback(null, file.fieldname === 'professionalPhoto' ? acceptedPhotos.has(file.mimetype) : acceptedDocuments.has(file.mimetype)),
});
const parseUpload = (middleware) => (req, res, next) => middleware(req, res, (error) => {
  if (!error) return next();
  return res.status(400).json({ success: false, message: error.code === 'LIMIT_FILE_SIZE' ? 'Documents must be 5 MB or smaller' : error.message || 'Invalid document upload' });
});
const requireDocumentKey = (req, res, next) => {
  if ((process.env.NODE_ENV === 'production' || process.env.VERCEL || process.env.NETLIFY || process.env.RENDER || process.env.AWS_LAMBDA_FUNCTION_NAME) && !process.env.DOCUMENT_ENCRYPTION_KEY) {
    return res.status(503).json({ success: false, message: 'Secure document storage is not configured. Set DOCUMENT_ENCRYPTION_KEY on the server.' });
  }
  return next();
};
const validDocument = (file) => {
  if (!file || !acceptedDocuments.has(file.mimetype)) return false;
  if (file.mimetype === 'application/pdf') return file.buffer.subarray(0, 5).toString() === '%PDF-';
  if (file.mimetype === 'image/png') return file.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return file.buffer[0] === 0xff && file.buffer[1] === 0xd8 && file.buffer[2] === 0xff;
};
const validProfessionalPhoto = (file) => {
  if (!file || !acceptedPhotos.has(file.mimetype)) return false;
  const bytes = file.buffer;
  if (file.mimetype === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (file.mimetype === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return bytes.length >= 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
};
const confirmationTokenHash = (token) => crypto.createHash('sha256').update(String(token || '')).digest('hex');
const encryptDocument = (bytes) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', documentEncryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return { bytes: encrypted, encryption_iv: iv, encryption_tag: cipher.getAuthTag() };
};
const decryptDocument = (document) => {
  const toBuffer = (value) => Buffer.from(Buffer.isBuffer(value) ? value : value?.value?.(true) || value?.buffer || value);
  const bytes = toBuffer(document.bytes);
  if (!document.encryption_iv || !document.encryption_tag) return Buffer.from(bytes);
  const decipher = crypto.createDecipheriv('aes-256-gcm', documentEncryptionKey, toBuffer(document.encryption_iv));
  decipher.setAuthTag(toBuffer(document.encryption_tag));
  return Buffer.concat([decipher.update(Buffer.from(bytes)), decipher.final()]);
};
const packages = {
  'Triple Occupancy': 17698.82,
  'Double Occupancy': 20648.82,
  '1 Member + 1 Spouse + 1 Kid (Up to 5 years)': 30090,
  '1 Member + 1 Family Member + 1 Kid (Up to 5 years)': 30090,
  '1 Member + 1 Spouse + 1 Kid (Above 5 years)': 34810,
  '1 Member + 1 Family Member + 1 Kid (Above 5 years)': 34810,
};
const hoodieSizes = new Set(['36 – XS', '38 – S', '40 – M', '42 – L', '44 – XL', '46 – XXL', '48 – 3XL', '50 – 4XL', '52 – 5XL']);
const publicRegistration = (r) => { const { confirmation_token_hash, ...safeRegistration } = r; return { ...safeRegistration, registrationId: r.id, package: r.package_name, paymentStatus: r.payment_status, transactionId: r.transaction_id, paymentDate: r.payment_date, entryPassNumber: r.pass_number, invoiceNumber: r.invoice_number }; };

router.post('/registrations', parseUpload(upload.fields([{ name: 'aadhaarCard', maxCount: 1 }, { name: 'professionalPhoto', maxCount: 1 }])), requireDocumentKey, async (req, res) => {
  const body = req.body || {};
  const packageName = String(body.package || '').trim();
  const amount = packages[packageName] || Number(body.amount);
  const name = String(body.fullName || body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const attendeeNames = (Array.isArray(body.attendeeNames) ? body.attendeeNames : [body.attendee1, body.attendee2, body.attendee3, body.attendee4])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const aadhaarCard = req.files?.aadhaarCard?.[0];
  const professionalPhoto = req.files?.professionalPhoto?.[0];
  const stayPartner1 = String(body.stayPartner1 || '').trim();
  const stayPartner2 = String(body.stayPartner2 || '').trim();
  const isTriple = packageName === 'Triple Occupancy';
  const isDouble = packageName === 'Double Occupancy';
  const requiredFields = [body.mobile, body.region, body.chapter, body.city, body.dateOfBirth, body.hoodieSize, body.businessIntent, body.businessName, body.businessCategory, body.businessAddress];
  if (!['Male', 'Female'].includes(body.gender)) return res.status(400).json({ success: false, message: 'Select Male or Female for gender' });
  if (!name || !email || password.length < 8 || !packageName || !amount || requiredFields.some((value) => !String(value || '').trim())) {
    return res.status(400).json({ success: false, message: !packages[packageName] && packageName ? `Unknown package: ${packageName}` : 'Name, email, password (8+ characters) and package are required' });
  }
  if (!hoodieSizes.has(String(body.hoodieSize || '').trim())) return res.status(400).json({ success: false, message: 'Select a valid hoodie chest size' });
  if (body.informationConfirmed !== 'true' || body.termsAccepted !== 'true') return res.status(400).json({ success: false, message: 'Please confirm your information and accept the event terms' });
  if ((packageName.startsWith('1 Member + 1 Spouse + 1 Kid') || packageName.startsWith('1 Member + 1 Family Member + 1 Kid')) && attendeeNames.length < 3) return res.status(400).json({ success: false, message: 'Member, spouse and child names are required for the selected family package' });
  if (!aadhaarCard || !validDocument(aadhaarCard)) return res.status(400).json({ success: false, message: 'A valid Aadhaar Card PDF, JPG, JPEG or PNG (up to 5 MB) is required' });
  if (!professionalPhoto || !validProfessionalPhoto(professionalPhoto)) return res.status(400).json({ success: false, message: 'A valid professional photo in JPG, JPEG, PNG or WEBP format (up to 5 MB) is required' });
  if ((isTriple && (!stayPartner1 || !stayPartner2)) || (isDouble && !stayPartner1)) return res.status(400).json({ success: false, message: 'Required stay partner names are missing' });
  const id = `RN5-REG-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const confirmationToken = crypto.randomBytes(32).toString('hex');
  const now = new Date().toISOString();
  const savedAttendeeNames = attendeeNames.length ? attendeeNames : [name];
  const guestName = body.guestName || attendeeNames.slice(1).join(', ');
  const registration = { id, confirmation_token_hash: confirmationTokenHash(confirmationToken), full_name: name, email, mobile: body.mobile || '', company: body.company || '', business_name: String(body.businessName).trim(), business_category: String(body.businessCategory).trim(), business_address: String(body.businessAddress).trim(), information_confirmed: true, terms_accepted: true, guest_name: guestName, attendee_names: savedAttendeeNames, stay_partner_1: isTriple || isDouble ? stayPartner1 : '', stay_partner_2: isTriple ? stayPartner2 : '', region: body.region || '', chapter: body.chapter || '', gst_number: String(body.gstNumber || '').toUpperCase(), city: body.city || '', date_of_birth: body.dateOfBirth || '', hoodie_size: body.hoodieSize || '', business_intent: body.businessIntent || '', package_name: packageName, package_price: Number((amount / 1.18).toFixed(2)), gst_amount: Number((amount - amount / 1.18).toFixed(2)), total_amount: amount, amount, status: 'Pending', registration_status: 'Pending', payment_status: 'Pending', admin_remark: '', created_at: now, updated_at: now };
  registration.gender = body.gender;
  const registrations = await collection('registrations');
  const registrationDocuments = await collection('registration_documents');
  await registrations.insertOne(registration);
  try {
    const photoExtension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[professionalPhoto.mimetype];
    await registrationDocuments.insertMany([
      { id: uuidv4(), registration_id: id, type: 'aadhaar', filename: aadhaarCard.originalname, content_type: aadhaarCard.mimetype, ...encryptDocument(aadhaarCard.buffer), created_at: now },
      { id: uuidv4(), registration_id: id, type: 'professional-photo', filename: `professional-photo-${id}.${photoExtension}`, content_type: professionalPhoto.mimetype, ...encryptDocument(professionalPhoto.buffer), created_at: now },
    ]);
  } catch (error) {
    await registrationDocuments.deleteMany({ registration_id: id });
    await registrations.deleteOne({ id });
    throw error;
  }
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
  return res.status(201).json({ success: true, accountCreated, accountExists: Boolean(existing), registration: { id, amount, package: packageName, full_name: name, paymentStatus: 'Pending', confirmationToken } });
});

router.get('/registrations/:registrationId/confirmation', async (req, res) => {
  const registration = await (await collection('registrations')).findOne({ id: req.params.registrationId, confirmation_token_hash: confirmationTokenHash(req.get('x-registration-token')) }, { projection: { id: 1, full_name: 1, package_name: 1, amount: 1, total_amount: 1, payment_status: 1, registration_status: 1, _id: 0 } });
  if (!registration) return res.status(404).json({ success: false, message: 'Registration not found' });
  return res.json({ success: true, registration });
});

router.get('/member/dashboard', authMiddleware, async (req, res) => {
  const registrations = await (await collection('registrations')).find({ email: req.user.email }).sort({ created_at: -1 }).toArray();
  const ids = registrations.map((registration) => registration.id);
  const [payments, invoices, passes, checkins] = await Promise.all([ (await collection('payments')).find({ registration_id: { $in: ids } }).toArray(), (await collection('invoices')).find({ registration_id: { $in: ids } }).toArray(), (await collection('entry_passes')).find({ registration_id: { $in: ids } }).toArray(), (await collection('checkins')).find({ registration_id: { $in: ids } }).toArray() ]);
  const by = (rows) => new Map(rows.map((row) => [row.registration_id, row]));
  const paymentBy = by(payments); const invoiceBy = by(invoices); const passBy = by(passes); const checkinBy = by(checkins);
  return res.json({ success: true, member: { name: req.user.name, email: req.user.email }, registrations: registrations.map((registration) => ({ ...registration, password_hash: undefined, confirmation_token_hash: undefined, payment: paymentBy.get(registration.id) || null, invoice: invoiceBy.get(registration.id) || null, entryPass: passBy.get(registration.id) || null, checkin: checkinBy.get(registration.id) || null })) });
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

router.post('/payments/manual', parseUpload(upload.single('paymentProof')), requireDocumentKey, async (req, res) => {
  const { registrationId, transactionId } = req.body || {};
  const registration = await (await collection('registrations')).findOne({ id: registrationId });
  if (registration && registration.confirmation_token_hash !== confirmationTokenHash(req.get('x-registration-token'))) return res.status(403).json({ success: false, message: 'Registration session is invalid. Please register again.' });
  if (!registration || !transactionId || !req.file || !validDocument(req.file)) return res.status(400).json({ success: false, message: 'Registration ID, transaction ID and a valid payment proof (PDF, JPG, JPEG or PNG up to 5 MB) are required' });
  const now = new Date().toISOString();
  await (await collection('registration_documents')).updateOne({ registration_id: registrationId, type: 'payment-proof' }, { $set: { id: uuidv4(), registration_id: registrationId, type: 'payment-proof', filename: req.file.originalname, content_type: req.file.mimetype, ...encryptDocument(req.file.buffer), created_at: now } }, { upsert: true });
  await (await collection('payments')).updateOne({ registration_id: registrationId }, { $set: { id: uuidv4(), registration_id: registrationId, transaction_id: transactionId.trim(), amount: registration.amount, status: 'Payment Proof Uploaded', gateway: 'manual', payment_date: now, updated_at: now }, $setOnInsert: { created_at: now } }, { upsert: true });
  await (await collection('registrations')).updateOne({ id: registrationId }, { $set: { payment_status: 'Payment Proof Uploaded', transaction_id: transactionId.trim(), payment_date: now, updated_at: now } });
  return res.json({ success: true, status: 'Payment Proof Uploaded', registrationId });
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
  await (await collection('registrations')).updateOne({ id: registrationId }, { $set: { payment_status: 'Pending', transaction_id: paymentId, payment_date: now, updated_at: now } });
  return res.json({ success: true, status: 'Received' });
});

router.get('/admin/registrations', authMiddleware, adminMiddleware, async (req, res) => {
  const registrations = await (await collection('registrations')).find().sort({ created_at: -1 }).toArray();
  const [payments, invoices, passes] = await Promise.all([(await collection('payments')).find().toArray(), (await collection('invoices')).find().toArray(), (await collection('entry_passes')).find().toArray()]);
  const by = (rows) => new Map(rows.map((row) => [row.registration_id, row]));
  const paymentBy = by(payments); const invoiceBy = by(invoices); const passBy = by(passes);
  const documents = await (await collection('registration_documents')).find({ registration_id: { $in: registrations.map((r) => r.id) } }, { projection: { registration_id: 1, type: 1, _id: 0 } }).toArray();
  const docsByRegistration = new Map();
  documents.forEach((document) => docsByRegistration.set(document.registration_id, { ...(docsByRegistration.get(document.registration_id) || {}), [document.type]: true }));
  return res.json({ success: true, registrations: registrations.map((r) => publicRegistration({ ...r, ...(paymentBy.get(r.id) ? { payment_status: paymentBy.get(r.id).status, transaction_id: paymentBy.get(r.id).transaction_id, payment_date: paymentBy.get(r.id).payment_date } : {}), ...(invoiceBy.get(r.id) ? { invoice_number: invoiceBy.get(r.id).invoice_number } : {}), ...(passBy.get(r.id) ? { pass_number: passBy.get(r.id).pass_number } : {}), documents: docsByRegistration.get(r.id) || {} })) });
});

router.get('/admin/registrations/export.xlsx', authMiddleware, adminMiddleware, async (req, res) => {
  const registrations = await (await collection('registrations')).find().sort({ created_at: -1 }).toArray();
  const registrationIds = registrations.map((registration) => registration.id);
  const [payments, documents, passes, checkins] = await Promise.all([
    (await collection('payments')).find({ registration_id: { $in: registrationIds } }).toArray(),
    (await collection('registration_documents')).find({ registration_id: { $in: registrationIds } }, { projection: { registration_id: 1, type: 1, filename: 1, _id: 0 } }).toArray(),
    (await collection('entry_passes')).find({ registration_id: { $in: registrationIds } }, { projection: { registration_id: 1, pass_number: 1, _id: 0 } }).toArray(),
    (await collection('checkins')).find({ registration_id: { $in: registrationIds } }, { projection: { registration_id: 1, checked_at: 1, _id: 0 } }).toArray(),
  ]);
  const keyed = (items) => new Map(items.map((item) => [item.registration_id, item]));
  const paymentByRegistration = keyed(payments);
  const passByRegistration = keyed(passes);
  const checkinByRegistration = keyed(checkins);
  const documentsByRegistration = new Map();
  documents.forEach((document) => documentsByRegistration.set(document.registration_id, { ...(documentsByRegistration.get(document.registration_id) || {}), [document.type]: document.filename }));
  const safeCell = (value) => {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) value = value.join(', ');
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    const text = String(value);
    return /^[=+\-@]/.test(text) ? `'${text}` : text;
  };
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Registrations');
  sheet.columns = [
    ['Registration ID', 'id'], ['Full Name', 'full_name'], ['Gender', 'gender'], ['Member / Guest', 'member_guest'], ['Mobile Number', 'mobile'], ['Email', 'email'],
    ['Package', 'package_name'], ['Occupancy', 'occupancy'], ['Package Price', 'package_price'], ['GST', 'gst_amount'], ['Total Amount', 'total_amount'],
    ['Preferred Stay Partner 1', 'stay_partner_1'], ['Preferred Stay Partner 2', 'stay_partner_2'],
    ['Business Name', 'business_name'], ['Business Category', 'business_category'], ['Business Address', 'business_address'],
    ['Hoodie Size', 'hoodie_size'], ['Aadhaar / ID Proof File Name', 'aadhaar_filename'], ['Payment Proof File Name', 'payment_proof_filename'],
    ['Registration Date', 'registration_date'], ['Registration Time', 'registration_time'], ['Payment Status', 'payment_status'], ['Registration Status', 'registration_status'],
    ['Company', 'company'], ['Designation / Business Category', 'business_category'], ['BNI Region', 'region'], ['BNI Chapter', 'chapter'], ['GST Number', 'gst_number'], ['City', 'city'],
    ['Professional Photo', 'professional_photo'], ['Professional Photo Path', 'professional_photo_path'],
    ['Date of Birth', 'date_of_birth'], ['Business Intent', 'business_intent'], ['Guest Name', 'guest_name'], ['Family Member Names', 'attendee_names'],
    ['Information Confirmed', 'information_confirmed'], ['Terms Accepted', 'terms_accepted'], ['Transaction ID', 'transaction_id'], ['Payment Date', 'payment_date'],
    ['Admin Remark', 'admin_remark'], ['Entry Pass Number', 'pass_number'], ['Check-in Date/Time', 'checkin_date'],
  ].map(([header, key]) => ({ header, key, width: Math.min(Math.max(header.length + 3, 18), 42) }));
  for (const registration of registrations) {
    const payment = paymentByRegistration.get(registration.id) || {};
    const files = documentsByRegistration.get(registration.id) || {};
    const createdAt = registration.created_at ? new Date(registration.created_at) : null;
    const checkin = checkinByRegistration.get(registration.id);
    const packageName = registration.package_name || '';
    const occupancy = packageName.includes('Triple Occupancy') ? 'Triple Occupancy' : packageName.includes('Double Occupancy') ? 'Double Occupancy' : packageName ? 'Family Package' : '';
    const values = {
      ...registration,
      occupancy,
      package_price: registration.package_price ?? Number((Number(registration.amount || 0) / 1.18).toFixed(2)),
      gst_amount: registration.gst_amount ?? Number((Number(registration.amount || 0) - Number(registration.amount || 0) / 1.18).toFixed(2)),
      total_amount: registration.total_amount ?? registration.amount,
      aadhaar_filename: files.aadhaar,
      payment_proof_filename: files['payment-proof'],
      member_guest: registration.guest_name ? 'Guest' : 'Member',
      professional_photo: files['professional-photo'] || 'No Photo',
      professional_photo_path: files['professional-photo'] ? `/api/admin/documents/professional-photo/${encodeURIComponent(registration.id)}` : '',
      registration_date: createdAt && !Number.isNaN(createdAt.valueOf()) ? createdAt.toLocaleDateString('en-IN') : '',
      registration_time: createdAt && !Number.isNaN(createdAt.valueOf()) ? createdAt.toLocaleTimeString('en-IN') : '',
      payment_status: payment.status || registration.payment_status || 'Pending',
      registration_status: registration.registration_status || registration.status || 'Pending',
      transaction_id: payment.transaction_id || registration.transaction_id,
      payment_date: payment.payment_date || registration.payment_date,
      pass_number: passByRegistration.get(registration.id)?.pass_number,
      checkin_date: checkin?.checked_at,
    };
    sheet.addRow(Object.fromEntries(sheet.columns.map(({ key }) => [key, safeCell(values[key])])));
  }
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="ranniti5-registrations.xlsx"');
  res.setHeader('Cache-Control', 'private, no-store');
  return res.send(await workbook.xlsx.writeBuffer());
});

router.get('/admin/registrations/:registrationId', authMiddleware, adminMiddleware, async (req, res) => {
  const registration = await (await collection('registrations')).findOne({ id: req.params.registrationId });
  if (!registration) return res.status(404).json({ success: false, message: 'Registration not found' });
  const [payment, documents] = await Promise.all([
    (await collection('payments')).findOne({ registration_id: registration.id }),
    (await collection('registration_documents')).find({ registration_id: registration.id }, { projection: { type: 1, filename: 1, content_type: 1, created_at: 1, _id: 0 } }).toArray(),
  ]);
  const { confirmation_token_hash, ...safeRegistration } = registration;
  return res.json({ success: true, registration: { ...safeRegistration, payment_status: payment?.status || registration.payment_status || 'Pending', payment: payment || null, documents } });
});

router.patch('/admin/registrations/:registrationId', authMiddleware, adminMiddleware, async (req, res) => {
  const allowed = ['full_name', 'email', 'mobile', 'gender', 'company', 'business_name', 'business_category', 'business_address', 'guest_name', 'attendee_names', 'stay_partner_1', 'stay_partner_2', 'region', 'chapter', 'gst_number', 'city', 'date_of_birth', 'hoodie_size', 'business_intent', 'package_name', 'admin_remark'];
  const updates = Object.fromEntries(Object.entries(req.body || {}).filter(([key, value]) => allowed.includes(key) && value !== undefined));
  if (!Object.keys(updates).length) return res.status(400).json({ success: false, message: 'No editable fields provided' });
  const registrations = await collection('registrations');
  const current = await registrations.findOne({ id: req.params.registrationId });
  if (!current) return res.status(404).json({ success: false, message: 'Registration not found' });
  if (updates.gender !== undefined && updates.gender !== '' && !['Male', 'Female'].includes(updates.gender)) return res.status(400).json({ success: false, message: 'Gender must be Male or Female' });
  if (updates.gender === '') delete updates.gender;
  for (const field of ['business_name', 'business_category', 'business_address']) {
    if (updates[field] !== undefined && !String(updates[field]).trim()) return res.status(400).json({ success: false, message: `${field.replaceAll('_', ' ')} is required` });
    if (updates[field] !== undefined) updates[field] = String(updates[field]).trim();
  }
  if (updates.email) updates.email = String(updates.email).trim().toLowerCase();
  if (updates.full_name) updates.full_name = String(updates.full_name).trim();
  if (updates.package_name) {
    const amount = packages[updates.package_name];
    if (!amount) return res.status(400).json({ success: false, message: 'Unknown package' });
    updates.package_price = Number((amount / 1.18).toFixed(2));
    updates.gst_amount = Number((amount - amount / 1.18).toFixed(2));
    updates.total_amount = amount;
    updates.amount = amount;
  }
  const packageName = updates.package_name || current.package_name;
  const partner1 = updates.stay_partner_1 ?? current.stay_partner_1;
  const partner2 = updates.stay_partner_2 ?? current.stay_partner_2;
  if (packageName === 'Triple Occupancy' && (!String(partner1 || '').trim() || !String(partner2 || '').trim())) return res.status(400).json({ success: false, message: 'Both preferred stay partners are required for Triple Occupancy' });
  if (packageName === 'Double Occupancy' && !String(partner1 || '').trim()) return res.status(400).json({ success: false, message: 'A preferred stay partner is required for Double Occupancy' });
  if (packageName.startsWith('1 Member + 1 Spouse + 1 Kid') || packageName.startsWith('1 Member + 1 Family Member + 1 Kid')) {
    updates.stay_partner_1 = '';
    updates.stay_partner_2 = '';
  }
  updates.updated_at = new Date().toISOString();
  const result = await registrations.updateOne({ id: req.params.registrationId }, { $set: updates });
  if (!result.matchedCount) return res.status(404).json({ success: false, message: 'Registration not found' });
  return res.json({ success: true, registrationId: req.params.registrationId });
});

router.patch('/admin/registrations/:registrationId/status', authMiddleware, adminMiddleware, async (req, res) => {
  const { registrationStatus, adminRemark } = req.body || {};
  const allowedStatuses = ['Pending', 'Verified', 'Approved', 'Rejected'];
  if (registrationStatus && !allowedStatuses.includes(registrationStatus)) return res.status(400).json({ success: false, message: 'Invalid registration status' });
  const updates = { updated_at: new Date().toISOString() };
  if (registrationStatus) {
    updates.registration_status = registrationStatus;
    updates.status = registrationStatus === 'Approved' ? 'Confirmed' : registrationStatus;
  }
  if (adminRemark !== undefined) updates.admin_remark = String(adminRemark).trim();
  const result = await (await collection('registrations')).updateOne({ id: req.params.registrationId }, { $set: updates });
  if (!result.matchedCount) return res.status(404).json({ success: false, message: 'Registration not found' });
  return res.json({ success: true, registrationId: req.params.registrationId });
});

router.patch('/admin/payments/:registrationId/status', authMiddleware, adminMiddleware, async (req, res) => {
  const { paymentStatus, adminRemark } = req.body || {};
  if (!['Verified', 'Rejected'].includes(paymentStatus)) return res.status(400).json({ success: false, message: 'Payment status must be Verified or Rejected' });
  const now = new Date().toISOString();
  const payments = await collection('payments');
  const payment = await payments.findOne({ registration_id: req.params.registrationId });
  if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });
  await payments.updateOne({ registration_id: payment.registration_id }, { $set: { status: paymentStatus, admin_remark: String(adminRemark || '').trim(), updated_at: now } });
  await (await collection('registrations')).updateOne({ id: payment.registration_id }, { $set: { payment_status: paymentStatus, admin_remark: String(adminRemark || '').trim(), updated_at: now } });
  return res.json({ success: true, registrationId: payment.registration_id, paymentStatus });
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
  await registrations.updateOne({ id: registration.id }, { $set: { status: 'Confirmed', registration_status: 'Approved', payment_status: 'Verified', updated_at: now } });
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
  if (['aadhaar', 'payment-proof', 'professional-photo'].includes(req.params.type)) {
    if ((process.env.NODE_ENV === 'production' || process.env.VERCEL || process.env.NETLIFY || process.env.RENDER || process.env.AWS_LAMBDA_FUNCTION_NAME) && !process.env.DOCUMENT_ENCRYPTION_KEY) {
      return res.status(503).json({ success: false, message: 'Secure document storage is not configured. Set DOCUMENT_ENCRYPTION_KEY on the server.' });
    }
    const registrationId = req.params.id;
    const document = await (await collection('registration_documents')).findOne({ registration_id: registrationId, type: req.params.type });
    if (!document) return res.status(404).json({ success: false, message: 'Document not found' });
    res.setHeader('Content-Type', document.content_type);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.params.type === 'professional-photo' && req.query.view === '1') return res.setHeader('Content-Disposition', 'inline').send(decryptDocument(document));
    return res.attachment(document.filename).send(decryptDocument(document));
  }
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
