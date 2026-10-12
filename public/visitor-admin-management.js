(() => {
  const nav = document.getElementById('nav');
  const content = document.querySelector('.content');
  if (!nav || !content) return;
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const token = () => localStorage.getItem('ranniti_admin_token') || '';
  const request = async (url, options = {}) => {
    const response = await fetch(url, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token()}`, ...(options.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || 'Request failed');
    return body;
  };
  const navButton = document.createElement('button');
  navButton.dataset.view = 'visitor-admins';
  navButton.innerHTML = '<span>12</span>Visitor Admin Management';
  nav.append(navButton);
  const section = document.createElement('section');
  section.className = 'view';
  section.id = 'view-visitor-admins';
  section.innerHTML = `<div class="view-head"><div><h2>Visitor Admin Management</h2><p>Manage accounts authorized for registration lookup and entry verification.</p></div><button class="btn primary" id="createVisitorAdmin">Create Visitor Admin</button></div><div class="card"><div class="card-head"><h3>Visitor Admin accounts</h3><button class="btn small" id="refreshVisitorAdmins">Refresh</button></div><div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Last login</th><th>Created</th><th>Actions</th></tr></thead><tbody id="visitorAdminBody"><tr><td colspan="6" class="empty">Loading accounts…</td></tr></tbody></table></div></div>`;
  content.append(section);

  const formatDate = (value) => value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Never';
  const notify = (message, error = false) => {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.style.background = error ? 'var(--red)' : 'var(--ink)';
    toast.classList.remove('hidden');
    window.setTimeout(() => toast.classList.add('hidden'), 3600);
  };
  const modal = document.getElementById('modal');
  const modalContent = document.getElementById('modalContent');
  const closeModal = () => modal?.classList.add('hidden');
  async function loadAccounts() {
    const tbody = document.getElementById('visitorAdminBody');
    tbody.innerHTML = '<tr><td colspan="6" class="empty">Loading accounts…</td></tr>';
    try {
      const body = await request('/api/admin/visitor-admins');
      tbody.innerHTML = body.visitorAdmins.map((account) => {
        const active = account.account_status === 'active';
        return `<tr><td class="name">${escapeHtml(account.name)}</td><td>${escapeHtml(account.email)}</td><td><span class="badge ${active ? 'green' : 'gray'}">${active ? 'Active' : 'Inactive'}</span></td><td>${formatDate(account.last_login_at)}</td><td>${formatDate(account.created_at)}</td><td><div class="row-actions"><button class="btn small" data-visitor-edit="${escapeHtml(account.id)}">Edit</button><button class="btn small" data-visitor-toggle="${escapeHtml(account.id)}" data-status="${active ? 'inactive' : 'active'}">${active ? 'Deactivate' : 'Activate'}</button><button class="btn small" data-visitor-reset="${escapeHtml(account.id)}">Reset password</button></div></td></tr>`;
      }).join('') || '<tr><td colspan="6" class="empty">No Visitor Admin accounts yet.</td></tr>';
      window.visitorAdminAccounts = body.visitorAdmins;
    } catch (error) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">${escapeHtml(error.message)}</td></tr>`;
      notify(error.message, true);
    }
  }
  function showAccountForm(account = null) {
    const editing = Boolean(account);
    modalContent.innerHTML = `<h2>${editing ? 'Edit Visitor Admin' : 'Create Visitor Admin'}</h2><form id="visitorAdminForm"><div class="form-grid"><label>Full name<input name="name" value="${escapeHtml(account?.name || '')}" autocomplete="name" required /></label><label>Email address<input name="email" type="email" value="${escapeHtml(account?.email || '')}" autocomplete="email" required /></label>${editing ? '' : '<label>Temporary password<input name="password" type="password" minlength="8" autocomplete="new-password" required /></label>'}<label>Account status<select name="accountStatus"><option value="active" ${account?.account_status !== 'inactive' ? 'selected' : ''}>Active</option><option value="inactive" ${account?.account_status === 'inactive' ? 'selected' : ''}>Inactive</option></select></label></div><div class="modal-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">${editing ? 'Save changes' : 'Create account'}</button></div></form>`;
    modal.classList.remove('hidden');
    document.getElementById('visitorAdminForm').onsubmit = async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.currentTarget));
      try {
        await request(editing ? `/api/admin/visitor-admins/${encodeURIComponent(account.id)}` : '/api/admin/visitor-admins', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(values) });
        closeModal();
        await loadAccounts();
        notify(editing ? 'Visitor Admin updated' : 'Visitor Admin created');
      } catch (error) { notify(error.message, true); }
    };
  }
  function showPasswordForm(account) {
    modalContent.innerHTML = `<h2>Reset password</h2><p class="muted">Set a temporary password for ${escapeHtml(account.name)}.</p><form id="visitorPasswordForm"><label>New temporary password<input name="password" type="password" minlength="8" autocomplete="new-password" required /></label><div class="modal-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Reset password</button></div></form>`;
    modal.classList.remove('hidden');
    document.getElementById('visitorPasswordForm').onsubmit = async (event) => {
      event.preventDefault();
      const password = new FormData(event.currentTarget).get('password');
      try {
        await request(`/api/admin/visitor-admins/${encodeURIComponent(account.id)}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) });
        closeModal();
        notify('Password reset');
      } catch (error) { notify(error.message, true); }
    };
  }
  document.getElementById('createVisitorAdmin').onclick = () => showAccountForm();
  document.getElementById('refreshVisitorAdmins').onclick = loadAccounts;
  navButton.addEventListener('click', () => window.setTimeout(() => { document.getElementById('pageTitle').textContent = 'Visitor Admin Management'; loadAccounts(); }, 0));
  section.addEventListener('click', async (event) => {
    const edit = event.target.closest('[data-visitor-edit]');
    const toggle = event.target.closest('[data-visitor-toggle]');
    const reset = event.target.closest('[data-visitor-reset]');
    const account = (window.visitorAdminAccounts || []).find((item) => item.id === (edit?.dataset.visitorEdit || toggle?.dataset.visitorToggle || reset?.dataset.visitorReset));
    if (!account) return;
    if (edit) return showAccountForm(account);
    if (reset) return showPasswordForm(account);
    if (toggle) {
      const nextStatus = toggle.dataset.status;
      if (nextStatus === 'inactive' && !window.confirm(`Deactivate ${account.name}? Their access will stop immediately.`)) return;
      try {
        await request(`/api/admin/visitor-admins/${encodeURIComponent(account.id)}`, { method: 'PATCH', body: JSON.stringify({ accountStatus: nextStatus }) });
        await loadAccounts();
        notify(nextStatus === 'inactive' ? 'Visitor Admin deactivated' : 'Visitor Admin activated');
      } catch (error) { notify(error.message, true); }
    }
  });
  modal?.addEventListener('click', (event) => { if (event.target === modal || event.target.closest('[data-close]')) closeModal(); });
})();