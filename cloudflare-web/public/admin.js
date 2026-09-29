const root = document.querySelector('#admin-app');
const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));

function fmt(value) {
  if (!value) return '—';
  try { return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
  catch { return String(value); }
}

function statusLabel(user) {
  if (user.account_status === 'licensed') return '<span class="license-chip licensed">Lisanslı</span>';
  if (user.account_status === 'blocked') return '<span class="license-chip blocked">Pasif</span>';
  return '<span class="license-chip free">Ücretsiz</span>';
}

async function loadUsers(query = '') {
  const users = await MiniMeetAuth.adminUsers(query);
  const rows = users.map((u) => `
    <tr>
      <td><strong>${esc(u.full_name || '—')}</strong><small>${esc(u.email || '')}</small></td>
      <td>${statusLabel(u)}</td>
      <td><small>Her yeni toplantı için 59 dakika</small></td>
      <td>${esc(fmt(u.license_expires_at))}</td>
      <td class="admin-actions">
        <button class="mini-action success" data-action="licensed" data-id="${esc(u.id)}">Süresiz lisans</button>
        <button class="mini-action" data-action="free" data-id="${esc(u.id)}">Ücretsiz</button>
        <button class="mini-action danger" data-action="blocked" data-id="${esc(u.id)}">Pasif</button>
      </td>
    </tr>`).join('');
  document.querySelector('#admin-users-body').innerHTML = rows || '<tr><td colspan="5" class="admin-empty">Kullanıcı bulunamadı.</td></tr>';
}

async function boot() {
  try {
    await MiniMeetAuth.init();
    const account = await MiniMeetAuth.getAccount(true);
    if (!account) {
      root.innerHTML = '<div class="admin-message">Önce MiniMeet ana sayfasından yönetici hesabınızla giriş yapın.</div>';
      return;
    }
    if (!account.is_admin) {
      root.innerHTML = '<div class="admin-message danger-box">Bu hesap lisans yönetimi yetkisine sahip değil.</div>';
      return;
    }
    root.innerHTML = `
      <div class="admin-toolbar">
        <div><strong>Hesaplar</strong><small>Lisans durumunu buradan yönetebilirsiniz.</small></div>
        <input id="admin-search" class="field" placeholder="E-posta veya ad ara" />
      </div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>Kullanıcı</th><th>Durum</th><th>Ücretsiz plan</th><th>Lisans bitişi</th><th>İşlem</th></tr></thead>
          <tbody id="admin-users-body"><tr><td colspan="5">Yükleniyor…</td></tr></tbody>
        </table>
      </div>`;
    await loadUsers('');
    let timer = null;
    document.querySelector('#admin-search').addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => loadUsers(e.target.value.trim()).catch(console.error), 250);
    });
    document.querySelector('#admin-users-body').addEventListener('click', async (e) => {
      const button = e.target.closest('[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      const id = button.dataset.id;
      const text = action === 'licensed' ? 'Bu hesabı süresiz lisanslı yapmak istiyor musunuz?' : action === 'blocked' ? 'Bu hesabı pasif yapmak istiyor musunuz? Aktif toplantısı kapanır.' : 'Bu hesabı ücretsiz moda almak istiyor musunuz?';
      if (!confirm(text)) return;
      button.disabled = true;
      try {
        await MiniMeetAuth.adminSetLicense(id, action);
        await loadUsers(document.querySelector('#admin-search')?.value.trim() || '');
      } catch (error) {
        alert(`İşlem yapılamadı: ${error.message}`);
      } finally {
        button.disabled = false;
      }
    });
  } catch (error) {
    root.innerHTML = `<div class="admin-message danger-box">Yönetim paneli açılamadı: ${esc(error.message)}</div>`;
  }
}
boot();
