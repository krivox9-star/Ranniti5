(() => {
  const token = localStorage.getItem('ranniti_visitor_token');
  if (!token) {
    window.location.replace('/login');
    return;
  }
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const date = (value) => value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const state = { registrations: [], scanner: null, loading: false, verifying: false, packageOptions: new Set(), paymentOptions: new Set() };
  const api = async (url, options = {}) => {
    const response = await fetch(url, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.message || body.result || 'Request failed');
      error.body = body;
      error.status = response.status;
      if (response.status === 401) {
        localStorage.removeItem('ranniti_visitor_token');
        window.location.replace('/login');
      }
      throw error;
    }
    return body;
  };
  const statusBadge = (status) => {
    const value = String(status || 'Pending');
    const tone = ['Confirmed', 'Verified'].includes(value) ? 'green' : ['Rejected', 'Failed'].includes(value) ? 'red' : value === 'Pending' ? 'amber' : 'gray';
    return `<span class="badge ${tone}">${escapeHtml(value)}</span>`;
  };
  const view = (name) => {
    document.querySelectorAll('.view').forEach((section) => section.classList.toggle('active', section.id === `view-${name}`));
    document.querySelectorAll('.nav button').forEach((button) => button.classList.toggle('active', button.dataset.view === name));
    if (name !== 'gate') stopScanner();
  };
  function updateFilterOptions() {
    const packageSelect = $('packageFilter');
    const paymentSelect = $('paymentFilter');
    const selectedPackage = packageSelect.value;
    const selectedPayment = paymentSelect.value;
    state.registrations.forEach((registration) => {
      if (registration.package) state.packageOptions.add(registration.package);
      if (registration.payment_status) state.paymentOptions.add(registration.payment_status);
    });
    packageSelect.innerHTML = '<option value="">All packages</option>' + [...state.packageOptions].sort().map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
    paymentSelect.innerHTML = '<option value="">All payment statuses</option>' + [...state.paymentOptions].sort().map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
    packageSelect.value = selectedPackage;
    paymentSelect.value = selectedPayment;
  }
  function renderRows() {
    $('registrationRows').innerHTML = state.registrations.map((registration) => `<tr>
      <td class="mono">${escapeHtml(registration.registrationId)}</td>
      <td><div class="name">${escapeHtml(registration.full_name || '—')}</div><div class="sub">${escapeHtml(registration.email || '—')} · ${escapeHtml(registration.mobile || '—')}</div></td>
      <td>${escapeHtml(registration.package || '—')}</td>
      <td>${statusBadge(registration.payment_status)}</td>
      <td>${date(registration.created_at)}</td>
      <td>${registration.checkin ? '<span class="badge green">Checked in</span>' : escapeHtml(registration.pass_number || 'No pass')}</td>
      <td>${registration.has_professional_photo ? `<button class="btn" data-photo="${escapeHtml(registration.registrationId)}">View photo</button>` : '<span class="muted">—</span>'}</td>
      <td><button class="btn" data-details="${escapeHtml(registration.registrationId)}">View</button></td>
    </tr>`).join('') || '<tr><td colspan="8" class="empty">No registrations match these filters.</td></tr>';
  }
  function renderSummary(summary) {
    const statuses = summary?.paymentStatuses || {};
    $('totalCount').textContent = summary?.total || 0;
    $('confirmedCount').textContent = (statuses.Confirmed || 0) + (statuses.Verified || 0);
    $('pendingCount').textContent = statuses.Pending || 0;
    $('proofCount').textContent = (statuses['Payment Proof Uploaded'] || 0) + (statuses.Received || 0);
    $('otherPaymentCount').textContent = Math.max((summary?.total || 0) - $('confirmedCount').textContent - $('pendingCount').textContent - $('proofCount').textContent, 0);
    $('checkedInCount').textContent = summary?.checkedIn || 0;
    $('paymentSummary').innerHTML = Object.entries(statuses).sort(([first], [second]) => first.localeCompare(second)).map(([status, count]) => `<span>${statusBadge(status)} <strong>${count}</strong></span>`).join('') || '<span>No payment records</span>';
  }
  async function loadRegistrations() {
    if (state.loading) return;
    state.loading = true;
    $('listNotice').textContent = 'Loading registrations…';
    const params = new URLSearchParams();
    if ($('search').value.trim()) params.set('search', $('search').value.trim());
    if ($('packageFilter').value) params.set('package', $('packageFilter').value);
    if ($('paymentFilter').value) params.set('paymentStatus', $('paymentFilter').value);
    if ($('dateFilter').value) params.set('date', $('dateFilter').value);
    try {
      const body = await api(`/api/visitor/registrations?${params}`);
      state.registrations = body.registrations || [];
      updateFilterOptions();
      renderRows();
      renderSummary(body.summary);
      $('listNotice').textContent = `${state.registrations.length} registration${state.registrations.length === 1 ? '' : 's'} shown`;
    } catch (error) {
      $('listNotice').textContent = error.message;
      $('registrationRows').innerHTML = '<tr><td colspan="8" class="empty">Unable to load registrations.</td></tr>';
    } finally { state.loading = false; }
  }
  async function downloadExcel() {
    const button = $('downloadExcel');
    button.disabled = true;
    button.textContent = 'Preparing…';
    try {
      const response = await fetch('/api/visitor/registrations/export.xlsx', { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || 'Unable to download registration data');
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = 'ranniti5-registrations.xlsx';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    } catch (error) { $('listNotice').textContent = error.message; }
    finally { button.disabled = false; button.textContent = 'Download Excel'; }
  }
  function showDetails(registration) {
    const fields = [
      ['Registration ID', registration.registrationId], ['Member name', registration.full_name], ['Email', registration.email], ['Mobile', registration.mobile],
      ['Package', registration.package], ['Payment status', registration.payment_status], ['Registration status', registration.registration_status],
      ['Registration date', date(registration.created_at)], ['Entry pass', registration.pass_number], ['Company', registration.company || registration.business_name],
      ['Business category', registration.business_category], ['BNI region', registration.region], ['BNI chapter', registration.chapter],
      ['Guest name', registration.guest_name], ['Attendee names', Array.isArray(registration.attendee_names) ? registration.attendee_names.join(', ') : registration.attendee_names],
      ['Check-in time', registration.checkin ? date(registration.checkin.checked_at) : 'Not checked in'],
      ['Checked in by', registration.checkin?.checked_by_name || registration.checkin?.checked_by],
    ];
    $('detailsContent').innerHTML = `<h2>${escapeHtml(registration.full_name || 'Registration')}</h2><div class="detail-grid">${fields.map(([label, value]) => `<div class="detail"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || '—')}</strong></div>`).join('')}</div>${registration.pass_number ? '<button class="btn" id="downloadPass" style="margin-top:16px">Download entry pass</button>' : ''}`;
    const downloadButton = $('downloadPass');
    if (downloadButton) downloadButton.onclick = () => downloadEntryPass(registration.registrationId);
    $('detailsDialog').showModal();
  }
  async function downloadEntryPass(registrationId) {
    try {
      const response = await fetch(`/api/visitor/documents/entry-pass/${encodeURIComponent(registrationId)}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('Unable to download entry pass');
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `entry-pass-${registrationId}.pdf`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    } catch (error) { $('listNotice').textContent = error.message; }
  }
  async function showPhoto(registrationId) {
    $('detailsContent').innerHTML = `<h2>Professional photo</h2><p class="muted">Loading photo…</p>`;
    $('detailsDialog').showModal();
    try {
      const response = await fetch(`/api/visitor/documents/professional-photo/${encodeURIComponent(registrationId)}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('Unable to load professional photo');
      const objectUrl = URL.createObjectURL(await response.blob());
      $('detailsContent').innerHTML = `<h2>Professional photo</h2><p class="muted">${escapeHtml(registrationId)}</p><img class="photo" src="${objectUrl}" alt="Registrant professional photo" />`;
      $('detailsContent').querySelector('img').addEventListener('load', () => URL.revokeObjectURL(objectUrl), { once: true });
    } catch (error) { $('detailsContent').innerHTML = `<h2>Photo unavailable</h2><p>${escapeHtml(error.message)}</p>`; }
  }
  function showGateResult(result, kind = 'ready') {
    const panel = $('gateResult');
    panel.className = `gate-panel ${kind}`;
    panel.innerHTML = result;
  }
  async function verifyEntry(code, method = 'manual') {
    if (!code || state.verifying) return;
    state.verifying = true;
    showGateResult('<h3>Checking pass…</h3><p>Verifying eligibility and previous entry records.</p>');
    try {
      const body = await api('/api/visitor/checkins', { method: 'POST', body: JSON.stringify({ code, method }) });
      const member = body.member || {};
      showGateResult(`<h3>VALID ENTRY</h3><p><strong>${escapeHtml(member.full_name)}</strong></p><p>Registration: ${escapeHtml(member.registration_id)}</p><p>Package: ${escapeHtml(member.package)}</p><p>Payment: ${escapeHtml(member.payment_status)}</p><p>Checked in: ${date(body.checkin?.checked_at)}</p>`, 'success');
      $('manualCode').value = '';
      await loadRegistrations();
    } catch (error) {
      const body = error.body || {};
      if (body.result === 'ALREADY CHECKED IN') {
        showGateResult(`<h3>ALREADY CHECKED IN</h3><p><strong>${escapeHtml(body.member?.full_name || 'Registrant')}</strong></p><p>Registration: ${escapeHtml(body.member?.registration_id)}</p><p>Package: ${escapeHtml(body.member?.package || '—')}</p><p>Previous check-in: ${date(body.checkin?.checked_at)}</p><p>Checked by: ${escapeHtml(body.checkin?.checked_by_name || body.checkin?.checked_by || '—')}</p>`, 'already');
      } else {
        const heading = body.result || (error.status === 403 ? 'ENTRY NOT ELIGIBLE' : 'ENTRY NOT VERIFIED');
        showGateResult(`<h3>${escapeHtml(heading)}</h3><p>${escapeHtml(body.message || error.message)}</p>${body.member ? `<p>${escapeHtml(body.member.full_name)} · ${escapeHtml(body.member.registration_id)}</p><p>Package: ${escapeHtml(body.member.package)}</p><p>Payment: ${escapeHtml(body.member.payment_status)}</p>` : ''}`, 'error');
      }
      await loadRegistrations();
    } finally { state.verifying = false; }
  }
  async function startScanner() {
    $('cameraNotice').textContent = '';
    if (!window.Html5Qrcode) {
      $('cameraNotice').textContent = 'Camera scanner is unavailable. Enter a registration ID or pass number manually.';
      return;
    }
    if (state.scanner) return;
    try {
      state.scanner = new Html5Qrcode('qr-reader');
      await state.scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 250, height: 250 } }, async (code) => {
        if (state.verifying) return;
        await stopScanner();
        await verifyEntry(code, 'QR');
      }, () => {});
    } catch (error) {
      state.scanner = null;
      $('cameraNotice').textContent = `Camera unavailable: ${error.message || 'check camera permissions or use manual lookup'}`;
    }
  }
  async function stopScanner() {
    if (!state.scanner) return;
    const scanner = state.scanner;
    state.scanner = null;
    try {
      if (scanner.isScanning) await scanner.stop();
      scanner.clear();
    } catch { }
  }
  $('nav')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-view]');
    if (button) view(button.dataset.view);
  });
  $('registrationRows').addEventListener('click', (event) => {
    const detailsButton = event.target.closest('[data-details]');
    const photoButton = event.target.closest('[data-photo]');
    if (detailsButton) {
      const registration = state.registrations.find((item) => item.registrationId === detailsButton.dataset.details);
      if (registration) showDetails(registration);
    }
    if (photoButton) showPhoto(photoButton.dataset.photo);
  });
  $('closeDetails').onclick = () => $('detailsDialog').close();
  $('downloadExcel').onclick = downloadExcel;
  $('startScanner').onclick = startScanner;
  $('stopScanner').onclick = stopScanner;
  $('manualScan').onclick = () => verifyEntry($('manualCode').value.trim(), 'manual');
  $('manualCode').addEventListener('keydown', (event) => { if (event.key === 'Enter') verifyEntry($('manualCode').value.trim(), 'manual'); });
  $('logout').onclick = async () => {
    await stopScanner();
    localStorage.removeItem('ranniti_visitor_token');
    window.location.replace('/login');
  };
  let filterTimer;
  $('search').addEventListener('input', () => { window.clearTimeout(filterTimer); filterTimer = window.setTimeout(loadRegistrations, 220); });
  ['packageFilter', 'paymentFilter', 'dateFilter'].forEach((id) => $(id).addEventListener('change', loadRegistrations));
  api('/api/users/me').then(({ user }) => {
    if (user.role !== 'visitor_admin') throw new Error('Visitor Admin access required');
    $('operatorName').childNodes[0].textContent = user.name || 'Visitor Admin';
    $('operatorEmail').textContent = user.email || '';
  }).catch(() => {
    localStorage.removeItem('ranniti_visitor_token');
    window.location.replace('/login');
  });
  loadRegistrations();
})();