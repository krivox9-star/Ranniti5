import { packages } from '/package-pricing.js';

(() => {
  const canonicalPaymentStatus = (registration) => {
    const status = registration.payment_status || registration.paymentStatus || registration.payment?.status || 'Pending';
    return status === 'Received' ? 'Payment Proof Uploaded' : status === 'Confirmed' ? 'Verified' : status;
  };
  const canonicalRegistrationStatus = (registration) => registration.registration_status || (registration.status === 'Confirmed' ? 'Approved' : registration.status || 'Pending');
  const memberGuestType = (registration) => registration.guest_name ? 'Guest' : 'Member';
  const reviewBadge = (status) => {
    const tone = ['Verified', 'Approved'].includes(status) ? 'green' : status === 'Rejected' ? 'red' : 'amber';
    return `<span class="badge ${tone}">${esc(status)}</span>`;
  };
  const privateDocument = async (registrationId, type, filename, action = 'download') => {
    const previewWindow = action === 'view' ? window.open('about:blank', '_blank') : null;
    const response = await fetch(`/api/admin/documents/${type}/${encodeURIComponent(registrationId)}`, { headers: { Authorization: `Bearer ${state.token}` } });
    if (!response.ok) {
      previewWindow?.close();
      throw new Error('Unable to access document');
    }
    const url = URL.createObjectURL(await response.blob());
    if (previewWindow) {
      previewWindow.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      return;
    }
    const link = document.createElement('a');
    link.href = url;
    const disposition = response.headers.get('content-disposition') || '';
    const serverFilename = disposition.match(/filename="?([^";]+)"?/i)?.[1];
    link.download = filename || serverFilename || `${type}-${registrationId}`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const rowValue = (value) => value ? esc(value) : '<span class="muted">—</span>';
  const clearDataButton = document.createElement('button');
  clearDataButton.type = 'button';
  clearDataButton.className = 'btn danger';
  clearDataButton.textContent = 'Clear All Dashboard Data';
  document.querySelector('#view-dashboard .view-head .actions')?.append(clearDataButton);
  let clearInProgress = false;
  clearDataButton.addEventListener('click', () => {
    $('modalContent').innerHTML = `<h2>Clear All Dashboard Data</h2><p>Are you sure you want to clear all registration data from the dashboard? A complete backup will be exported and verified before any data is removed.</p><p class="muted" id="clearDataStatus" role="status"></p><div class="modal-foot"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="button" id="confirmClearData">Confirm &amp; Clear All Data</button></div>`;
    $('modal').classList.remove('hidden');
  });
  document.addEventListener('click', async (event) => {
    const confirmButton = event.target.closest('#confirmClearData');
    if (!confirmButton) {
      if (clearInProgress && event.target.closest('#modal')) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    clearInProgress = true;
    confirmButton.disabled = true;
    const cancelButton = $('modalContent').querySelector('[data-close]');
    if (cancelButton) cancelButton.disabled = true;
    const status = $('clearDataStatus');
    const request = async (url, options = {}) => {
      const response = await fetch(url, {
        ...options,
        headers: { Authorization: `Bearer ${state.token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || 'Unable to prepare registration backup');
      return body;
    };
    try {
      status.textContent = 'Creating and verifying the complete backup…';
      const backup = await request('/api/admin/registrations/backup', { method: 'POST' });
      status.textContent = `${backup.backedUp} records verified. Preparing the Excel download…`;
      const downloadResponse = await fetch(`/api/admin/registrations/backups/${encodeURIComponent(backup.backupId)}/download`, { headers: { Authorization: `Bearer ${state.token}` } });
      if (!downloadResponse.ok) {
        const body = await downloadResponse.json().catch(() => ({}));
        throw new Error(body.message || 'Unable to prepare the Excel download');
      }
      const file = await downloadResponse.blob();
      const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer());
      if (file.size < 4 || signature[0] !== 0x50 || signature[1] !== 0x4b || signature[2] !== 0x03 || signature[3] !== 0x04) {
        throw new Error('The Excel backup download could not be verified. No data was cleared.');
      }
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = backup.filename;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      status.textContent = 'Backup download prepared. Clearing the backed-up registrations…';
      const result = await request('/api/admin/registrations/clear', {
        method: 'POST',
        body: JSON.stringify({ backupId: backup.backupId }),
      });
      state.registrations = [];
      renderAll();
      $('modal').classList.add('hidden');
      clearInProgress = false;
      await window.loadData();
      notify(`${result.backedUp} records backed up; ${result.cleared} registrations cleared. File: ${result.filename}`);
    } catch (error) {
      clearInProgress = false;
      status.textContent = error.message;
      notify(error.message, true);
      confirmButton.disabled = false;
      if (cancelButton) cancelButton.disabled = false;
    }
  }, true);
  const registrationFilters = document.createElement('div');
  registrationFilters.className = 'toolbar';
  registrationFilters.id = 'registrationFilters';
  registrationFilters.innerHTML = `
    <input id="filterMember" placeholder="Member name" aria-label="Filter by member name" />
    <input id="filterMobile" placeholder="Mobile number" aria-label="Filter by mobile number" />
    <input id="filterRegistrationId" placeholder="Registration ID" aria-label="Filter by registration ID" />
    <select id="filterGender" aria-label="Filter by gender"><option value="">All genders</option><option>Male</option><option>Female</option></select>
    <input id="filterChapter" placeholder="Chapter" aria-label="Filter by chapter" />
    <select id="filterMemberType" aria-label="Filter by member or guest"><option value="">Members and guests</option><option>Member</option><option>Guest</option></select>
    <select id="filterPackage" aria-label="Filter by package"><option value="">All packages</option>${Object.keys(packages).map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}</select>
    <select id="filterPaymentStatus" aria-label="Filter by payment status"><option value="">All payment statuses</option><option>Pending</option><option>Payment Proof Uploaded</option><option>Verified</option><option>Rejected</option></select>
    <select id="filterRegistrationStatus" aria-label="Filter by registration status"><option value="">All registration statuses</option><option>Pending</option><option>Verified</option><option>Approved</option><option>Rejected</option></select>
    <input id="filterDate" type="date" aria-label="Filter by registration date" />
    <div class="quick-filters" role="group" aria-label="Quick registration filters">${['All', 'Male', 'Female', 'Members', 'Guests', 'Paid', 'Pending'].map((label) => `<button class="btn small quick-filter${label === 'All' ? ' active' : ''}" type="button" data-quick-filter="${label}">${label}</button>`).join('')}</div>`;
  const quickFilterStyle = document.createElement('style');
  quickFilterStyle.textContent = '.quick-filters{display:flex;gap:7px;flex-wrap:wrap;width:100%}.quick-filter.active{color:#fff;background:var(--red);border-color:var(--red)}.photo-thumb{display:grid;place-items:center;width:46px;height:46px;padding:0;border:1px solid var(--line);border-radius:5px;background:#f3f2f0;overflow:hidden}.photo-thumb img{width:100%;height:100%;object-fit:cover}.photo-view{display:block;max-width:min(100%,520px);max-height:65vh;margin:18px auto;object-fit:contain}';
  document.head.append(quickFilterStyle);
  document.querySelector('#view-registrations .toolbar')?.after(registrationFilters);

  const registrationTable = document.querySelector('#registrationBody')?.closest('table');
  if (registrationTable) {
    registrationTable.querySelector('thead').innerHTML = '<tr><th>Registration ID</th><th>Full Name</th><th>Gender</th><th>Mobile</th><th>Email</th><th>Company</th><th>Designation / Business Category</th><th>Chapter</th><th>Member / Guest</th><th>Package</th><th>Payment Status</th><th>Registration Status</th><th>Professional Photo</th><th>Aadhaar</th><th>Payment Proof</th><th>Date</th><th>Actions</th></tr>';
  }

  let quickFilter = 'All';
  async function fetchPhotoThumbnail(image) {
      const id = image.dataset.photoThumb;
      try {
        const response = await fetch(`/api/admin/documents/professional-photo/${encodeURIComponent(id)}?view=1`, { headers: { Authorization: `Bearer ${state.token}` } });
        if (!response.ok) throw new Error('Unable to access photo');
        const url = URL.createObjectURL(await response.blob());
        image.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
        image.src = url;
      } catch {
        image.closest('button').textContent = 'Unavailable';
      }
  }
  function loadPhotoThumbnails() {
    const images = [...document.querySelectorAll('[data-photo-thumb]')];
    if (!('IntersectionObserver' in window)) return images.forEach((image) => fetchPhotoThumbnail(image));
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);
      fetchPhotoThumbnail(entry.target);
    }), { root: registrationTable?.closest('.table-wrap') || null, rootMargin: '100px' });
    images.forEach((image) => observer.observe(image));
  }

  function renderManagedRegistrations() {
    const query = $('registrationSearch').value.trim().toLowerCase();
    const member = $('filterMember').value.trim().toLowerCase();
    const mobile = $('filterMobile').value.trim().toLowerCase();
    const idQuery = $('filterRegistrationId').value.trim().toLowerCase();
    const gender = $('filterGender').value;
    const chapter = $('filterChapter').value.trim().toLowerCase();
    const memberType = $('filterMemberType').value;
    const packageName = $('filterPackage').value;
    const paymentStatus = $('filterPaymentStatus').value;
    const registrationStatus = $('filterRegistrationStatus').value;
    const createdDate = $('filterDate').value;
    const matches = state.registrations.filter((registration) => {
      const date = String(registration.created_at || '').slice(0, 10);
      const searchFields = `${registration.registrationId || registration.id || ''} ${registration.full_name || ''} ${registration.email || ''} ${registration.mobile || ''} ${registration.gender || ''} ${registration.company || ''} ${registration.business_name || ''} ${registration.business_category || ''} ${registration.business_address || ''} ${registration.chapter || ''} ${registration.guest_name || ''}`.toLowerCase();
      const payment = canonicalPaymentStatus(registration);
      const type = memberGuestType(registration);
      return (!query || searchFields.includes(query))
        && (!member || String(registration.full_name || '').toLowerCase().includes(member))
        && (!mobile || String(registration.mobile || '').toLowerCase().includes(mobile))
        && (!idQuery || String(registration.registrationId || registration.id || '').toLowerCase().includes(idQuery))
        && (!gender || registration.gender === gender)
        && (!chapter || String(registration.chapter || '').toLowerCase().includes(chapter))
        && (!memberType || type === memberType)
        && (!packageName || (registration.package || registration.package_name) === packageName)
        && (!paymentStatus || canonicalPaymentStatus(registration) === paymentStatus)
        && (!registrationStatus || canonicalRegistrationStatus(registration) === registrationStatus)
        && (!createdDate || date === createdDate)
        && (quickFilter === 'All' || quickFilter === 'Male' && registration.gender === 'Male' || quickFilter === 'Female' && registration.gender === 'Female' || quickFilter === 'Members' && type === 'Member' || quickFilter === 'Guests' && type === 'Guest' || quickFilter === 'Paid' && payment === 'Verified' || quickFilter === 'Pending' && payment === 'Pending');
    }).sort((first, second) => $('registrationSort').value === 'amount'
      ? Number(second.amount || 0) - Number(first.amount || 0)
      : $('registrationSort').value === 'oldest'
        ? new Date(first.created_at) - new Date(second.created_at)
        : new Date(second.created_at) - new Date(first.created_at));
    $('registrationBody').innerHTML = matches.map((registration) => {
      const id = registration.registrationId || registration.id;
      const docs = registration.documents || {};
      const payment = canonicalPaymentStatus(registration);
      const registrationState = canonicalRegistrationStatus(registration);
      const photo = docs['professional-photo']
        ? `<button class="photo-thumb" type="button" data-photo-open="${esc(id)}" aria-label="View professional photo for ${esc(registration.full_name)}"><img data-photo-thumb="${esc(id)}" alt="Professional photo of ${esc(registration.full_name)}" /></button>`
        : '<span class="muted">No Photo</span>';
      return `<tr>
        <td class="mono">${esc(id)}</td>
        <td>${rowValue(registration.full_name)}</td>
        <td>${rowValue(registration.gender)}</td>
        <td>${rowValue(registration.mobile)}</td>
        <td>${rowValue(registration.email)}</td>
        <td>${rowValue(registration.company || registration.business_name)}</td>
        <td>${rowValue(registration.designation || registration.business_category)}</td>
        <td>${rowValue(registration.chapter)}</td>
        <td>${memberGuestType(registration)}</td>
        <td>${rowValue(registration.package || registration.package_name)}</td>
        <td>${reviewBadge(payment)}</td>
        <td>${reviewBadge(registrationState)}</td>
        <td>${photo}</td>
        <td>${docs.aadhaar ? `<button class="link" data-secure-document="aadhaar" data-registration-id="${esc(id)}">View / Download</button>` : '—'}</td>
        <td>${docs['payment-proof'] ? `<button class="link" data-secure-document="payment-proof" data-registration-id="${esc(id)}">View / Download</button>` : '—'}</td>
        <td>${date(registration.created_at)}</td>
        <td><div class="row-actions"><button class="btn small" data-managed-details="${esc(id)}">Open</button><button class="btn small" data-managed-edit="${esc(id)}">Edit</button></div></td>
      </tr>`;
    }).join('') || '<tr><td colspan="17" class="empty">No registrations match these filters.</td></tr>';
    loadPhotoThumbnails();
  }
  window.renderRegistrations = renderManagedRegistrations;
  ['filterMember', 'filterMobile', 'filterRegistrationId', 'filterGender', 'filterChapter', 'filterMemberType', 'filterPackage', 'filterPaymentStatus', 'filterRegistrationStatus', 'filterDate'].forEach((id) => {
    $(id).addEventListener('input', renderManagedRegistrations);
    $(id).addEventListener('change', renderManagedRegistrations);
  });
  registrationFilters.addEventListener('click', (event) => {
    const button = event.target.closest('[data-quick-filter]');
    if (!button) return;
    quickFilter = button.dataset.quickFilter;
    registrationFilters.querySelectorAll('[data-quick-filter]').forEach((item) => item.classList.toggle('active', item === button));
    renderManagedRegistrations();
  });
  const legacySearch = $('registrationSearch');
  legacySearch.placeholder = 'Search name, mobile, ID, email or company';
  legacySearch.oninput = renderManagedRegistrations;
  $('registrationFilter').parentElement?.querySelector('#registrationFilter')?.setAttribute('hidden', '');
  $('registrationFilter').onchange = renderManagedRegistrations;
  $('registrationSort').onchange = renderManagedRegistrations;
  const originalLoadData = loadData;
  window.loadData = async (...args) => {
    await originalLoadData(...args);
    state.registrations.forEach((registration) => {
      const paymentStatus = canonicalPaymentStatus(registration);
      registration.status = paymentStatus === 'Verified' ? 'Confirmed' : paymentStatus === 'Payment Proof Uploaded' ? 'Received' : paymentStatus;
    });
    renderDashboard();
    renderPayments();
    renderConfirmed();
    renderManagedRegistrations();
  };

  document.querySelectorAll('[data-export="registrations"]').forEach((button) => { button.textContent = 'Export to Excel'; });
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-export="registrations"]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      const response = await fetch('/api/admin/registrations/export.xlsx', { headers: { Authorization: `Bearer ${state.token}` } });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || 'Unable to export registrations');
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'ranniti5-registrations.xlsx';
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) { notify(error.message, true); }
  }, true);

  const field = (label, value) => `<div class="metric-row"><span>${esc(label)}</span><strong>${rowValue(value)}</strong></div>`;
  const detailDocument = (id, type, metadata) => metadata
    ? `<span class="row-actions"><button class="btn small" data-secure-document="${type}" data-document-action="view" data-registration-id="${esc(id)}">View</button><button class="btn small" data-secure-document="${type}" data-document-action="download" data-registration-id="${esc(id)}" data-document-filename="${esc(metadata.filename || '')}">Download</button></span>`
    : '<span class="muted">Not uploaded</span>';
  async function openManagedDetails(id, edit = false) {
    try {
      const body = await api(`/api/admin/registrations/${encodeURIComponent(id)}`);
      const registration = body.registration;
      const documents = Object.fromEntries((registration.documents || []).map((document) => [document.type, document]));
      const paymentStatus = canonicalPaymentStatus(registration);
      const registrationStatus = canonicalRegistrationStatus(registration);
      const allFields = [
        ['full_name', 'Member name'], ['gender', 'Gender'], ['email', 'Email'], ['mobile', 'Mobile'], ['company', 'Company'],
          ['business_name', 'Business Name'], ['business_category', 'Business Category'], ['business_address', 'Business Address'],
        ['region', 'BNI Region'], ['chapter', 'BNI Chapter'], ['gst_number', 'GST number'], ['city', 'City'],
        ['date_of_birth', 'Date of birth'], ['hoodie_size', 'Hoodie size'], ['business_intent', 'Business intent'],
        ['guest_name', 'Guest name'], ['attendee_names', 'Family member information'],
        ['information_confirmed', 'Information confirmed'], ['terms_accepted', 'Terms accepted'],
      ];
      if (registration.package_name === 'Triple Occupancy') allFields.push(['stay_partner_1', 'Preferred Stay Partner 1'], ['stay_partner_2', 'Preferred Stay Partner 2']);
      if (registration.package_name === 'Double Occupancy') allFields.push(['stay_partner_1', 'Preferred Stay Partner']);
      if (edit) {
        const editableFields = [
          ['full_name', 'Member name'], ['gender', 'Gender'], ['email', 'Email'], ['mobile', 'Mobile'], ['company', 'Company'],
            ['business_name', 'Business Name'], ['business_category', 'Business Category'], ['business_address', 'Business Address'],
          ['region', 'BNI Region'], ['chapter', 'BNI Chapter'], ['gst_number', 'GST number'], ['city', 'City'],
          ['date_of_birth', 'Date of birth'], ['hoodie_size', 'Hoodie size'], ['business_intent', 'Business intent'],
          ['guest_name', 'Guest name'], ['attendee_names', 'Family names (comma separated)'],
          ['stay_partner_1', 'Preferred Stay Partner 1'], ['stay_partner_2', 'Preferred Stay Partner 2'],
        ];
        $('modalContent').innerHTML = `<h2>Edit registration information</h2><p class="muted">${esc(id)}</p><form id="managedEditForm"><div class="form-grid">${editableFields.map(([key, label]) => {
          const value = key === 'attendee_names' && Array.isArray(registration[key]) ? registration[key].join(', ') : registration[key] || '';
          if (key === 'business_address') return `<label>${esc(label)}<textarea name="${key}" required style="width:100%;min-height:88px;margin-top:5px;padding:9px;border:1px solid var(--line);border-radius:5px;font:inherit">${esc(value)}</textarea></label>`;
          if (key === 'gender') return `<label>${esc(label)}<select name="gender"><option value="">Not provided</option><option value="Male" ${value === 'Male' ? 'selected' : ''}>Male</option><option value="Female" ${value === 'Female' ? 'selected' : ''}>Female</option></select></label>`;
          return `<label>${esc(label)}<input name="${key}" value="${esc(value)}" /></label>`;

        }).join('')}<label>Package<select name="package_name">${Object.keys(packages).map((name) => `<option value="${esc(name)}" ${name === registration.package_name ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></label></div><div class="modal-foot"><button type="button" class="btn" data-managed-back="${esc(id)}">Cancel</button><button class="btn primary">Save changes</button></div></form>`;
        $('managedEditForm').onsubmit = async (event) => {
          event.preventDefault();
          const updates = Object.fromEntries(new FormData(event.currentTarget));
          updates.attendee_names = updates.attendee_names.split(',').map((value) => value.trim()).filter(Boolean);
          try {
            await api(`/api/admin/registrations/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(updates) });
            await loadData();
            notify('Registration updated');
            openManagedDetails(id);
          } catch (error) { notify(error.message, true); }
        };
      } else {
        $('modalContent').innerHTML = `
          <h2>Registration details</h2><p class="muted">${esc(id)} · ${date(registration.created_at)}</p>
          <div class="eyebrow">Registration information</div><div class="metric-list" style="margin:12px 0 22px">
            ${field('Registration status', registrationStatus)}${allFields.map(([key, label]) => field(label, key === 'attendee_names' && Array.isArray(registration[key]) ? registration[key].join(', ') : registration[key])).join('')}
            ${field('Admin remark', registration.admin_remark)}
          </div>
          <div class="eyebrow">Package information</div><div class="metric-list" style="margin:12px 0 22px">
            ${field('Selected package', registration.package_name)}${field('Package price', money(registration.package_price ?? Number(registration.amount || 0) / 1.18))}${field('GST', money(registration.gst_amount ?? Number(registration.amount || 0) - Number(registration.amount || 0) / 1.18))}${field('Total amount', money(registration.total_amount ?? registration.amount))}${field('Payment status', paymentStatus)}${field('UTR / transaction', registration.payment?.transaction_id || registration.transaction_id)}${field('Payment date', date(registration.payment?.payment_date || registration.payment_date))}
          </div>
          <div class="eyebrow">Documents</div><div class="metric-list" style="margin:12px 0 22px">
            <div class="metric-row"><span>Aadhaar Card</span>${detailDocument(id, 'aadhaar', documents.aadhaar)}</div>
            <div class="metric-row"><span>Payment Proof</span>${detailDocument(id, 'payment-proof', documents['payment-proof'])}</div>
            <div class="metric-row"><span>Professional Photo</span>${detailDocument(id, 'professional-photo', documents['professional-photo'])}</div>
          </div>
          <label for="adminRemarkInput">Admin remark / rejection reason</label><input id="adminRemarkInput" value="${esc(registration.admin_remark || registration.payment?.admin_remark || '')}" style="width:100%;margin-top:6px" />
          <div class="modal-foot" style="justify-content:flex-start;flex-wrap:wrap">
            <button class="btn" data-registration-action="Verified" data-registration-id="${esc(id)}">Verify registration</button>
            <button class="btn primary" data-registration-action="Approved" data-registration-id="${esc(id)}">Approve registration</button>
            <button class="btn danger" data-registration-action="Rejected" data-registration-id="${esc(id)}">Reject registration</button>
            <button class="btn" data-payment-action="Verified" data-registration-id="${esc(id)}" ${registration.payment ? '' : 'disabled'}>Verify payment</button>
            <button class="btn danger" data-payment-action="Rejected" data-registration-id="${esc(id)}" ${registration.payment ? '' : 'disabled'}>Reject payment</button>
            <button class="btn" data-save-remark="${esc(id)}">Save remark</button>
            <button class="btn" data-managed-edit="${esc(id)}">Edit information</button>
            <button class="btn" data-close>Close</button>
          </div>`;
      }
      $('modal').classList.remove('hidden');
    } catch (error) { notify(error.message, true); }
  }

  window.showDetails = (id, edit = false) => openManagedDetails(id, edit);
  async function showRegistrationPhoto(id) {
    try {
      const response = await fetch(`/api/admin/documents/professional-photo/${encodeURIComponent(id)}?view=1`, { headers: { Authorization: `Bearer ${state.token}` } });
      if (!response.ok) throw new Error('Unable to access professional photo');
      const url = URL.createObjectURL(await response.blob());
      $('modalContent').innerHTML = `<h2>Professional photo</h2><p class="muted">${esc(id)}</p><img class="photo-view" src="${url}" alt="Participant professional photo" /><div class="modal-foot"><button class="btn" data-secure-document="professional-photo" data-registration-id="${esc(id)}" data-document-filename="professional-photo-${esc(id)}">Download original</button><button class="btn" data-close>Close</button></div>`;
      $('modalContent').querySelector('.photo-view').addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
      $('modal').classList.remove('hidden');
    } catch (error) { notify(error.message, true); }
  }
  document.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-managed-details], [data-managed-edit], [data-managed-back], [data-secure-document], [data-photo-open], [data-registration-action], [data-payment-action], [data-save-remark]');
    if (!target) return;
    if (target.matches('[data-photo-open]')) return showRegistrationPhoto(target.dataset.photoOpen);
    if (target.matches('[data-secure-document]')) {
      event.preventDefault();
      try { await privateDocument(target.dataset.registrationId, target.dataset.secureDocument, target.dataset.documentFilename, target.dataset.documentAction || 'download'); }
      catch (error) { notify(error.message, true); }
      return;
    }
    if (target.matches('[data-managed-details]')) return openManagedDetails(target.dataset.managedDetails);
    if (target.matches('[data-managed-edit]')) return openManagedDetails(target.dataset.managedEdit, true);
    if (target.matches('[data-managed-back]')) return openManagedDetails(target.dataset.managedBack);
    if (target.matches('[data-save-remark]')) {
      const id = target.dataset.saveRemark;
      try {
        await api(`/api/admin/registrations/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ adminRemark: $('adminRemarkInput').value }) });
        await loadData();
        notify('Admin remark saved');
        openManagedDetails(id);
      } catch (error) { notify(error.message, true); }
      return;
    }
    if (target.matches('[data-registration-action]')) {
      const id = target.dataset.registrationId;
      const remark = $('adminRemarkInput').value;
      try {
        await api(`/api/admin/registrations/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ registrationStatus: target.dataset.registrationAction, adminRemark: remark }) });
        await loadData();
        notify(`Registration ${target.dataset.registrationAction.toLowerCase()}`);
        openManagedDetails(id);
      } catch (error) { notify(error.message, true); }
      return;
    }
    if (target.matches('[data-payment-action]')) {
      const id = target.dataset.registrationId;
      const paymentStatus = target.dataset.paymentAction;
      const remark = $('adminRemarkInput').value;
      try {
        await api(`/api/admin/payments/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ paymentStatus, adminRemark: remark }) });
        if (paymentStatus === 'Verified') await api(`/api/admin/payments/${encodeURIComponent(id)}/confirm`, { method: 'POST', body: '{}' });
        await loadData();
        notify(`Payment ${paymentStatus.toLowerCase()}`);
        openManagedDetails(id);
      } catch (error) { notify(error.message, true); }
    }
  });

  const managedBody = $('registrationBody');
  if (managedBody) renderManagedRegistrations();
})();
