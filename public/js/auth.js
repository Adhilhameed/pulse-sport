/**
 * PulseSport demo login (front-end only, self-contained).
 * - Login is REQUIRED before the shop is usable (set REQUIRE_LOGIN = false to make it optional).
 * - Any valid email + password of 6+ characters logs in.
 * - The session lives in a signed httpOnly cookie set by the server (/api/login, /api/me).
 *   The server also issues the TruePrivacy identity token for the signed-in email.
 * - After login (and on every page load while logged in) the email is sent to
 *   TruePrivacy with identify(); on logout, reset() is called.
 * - Its own styles are injected from this file, so nothing else needs deploying.
 */
// TruePrivacy command queue: safe to push to before banner.js has finished loading.
window.TruePrivacyQueue = window.TruePrivacyQueue || [];

const AUTH_CSS = `.account-wrap { position: relative; display: flex; align-items: center; gap: 10px; }

.auth-email {
  display: none;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--text-secondary);
}
.auth-email.show { display: block; }
@media (max-width: 900px) { .auth-email { display: none !important; } }

#account-btn.logged-in { border-color: var(--accent); color: var(--accent); }

.auth-menu {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  min-width: 240px;
  padding: 14px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
  z-index: 200;
}
.auth-menu-label { font-size: 12px; color: var(--text-muted); margin-bottom: 2px; }
.auth-menu-email {
  font-size: 14px;
  font-weight: 600;
  word-break: break-all;
  margin-bottom: 12px;
}

.auth-overlay {
  position: fixed;
  inset: 0;
  z-index: 300;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(10, 10, 10, 0.96);
  backdrop-filter: blur(6px);
}

.auth-card {
  position: relative;
  width: 100%;
  max-width: 400px;
  padding: 32px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 16px;
}
.auth-card h2 { font-size: 24px; margin-bottom: 6px; }
.auth-sub { color: var(--text-secondary); font-size: 14px; margin-bottom: 24px; }

.auth-close {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text-secondary);
  cursor: pointer;
}
.auth-close:hover { color: var(--text-primary); border-color: var(--border-hover); }

.auth-field { margin-bottom: 16px; }
.auth-field label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px; }
.auth-field input {
  width: 100%;
  padding: 11px 14px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-primary);
  font: inherit;
  font-size: 14px;
}
.auth-field input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-glow);
}
.auth-field.invalid input { border-color: var(--danger); }
.auth-error { min-height: 16px; margin-top: 5px; font-size: 12px; color: var(--danger); }

.auth-submit { width: 100%; justify-content: center; margin-top: 4px; }
.auth-note { margin-top: 18px; font-size: 12px; color: var(--text-muted); line-height: 1.5; }

.auth-card .brand { display:flex; align-items:center; gap:10px; margin-bottom:20px; font-weight:800; font-size:18px; }
`;

const Auth = {
  REQUIRE_LOGIN: true,
  user: null,

  init() {
    const style = document.createElement('style');
    style.textContent = AUTH_CSS;
    document.head.appendChild(style);

    this.bind();
    this.loadSession().then(() => {
      this.renderHeader();
      if (this.user) {
        if (document.readyState === 'complete') this.identify(this.user);
        else window.addEventListener('load', () => this.identify(this.user));
      } else if (this.REQUIRE_LOGIN) {
        this.openModal();
      }
    });
  },

  // Ask the server who is signed in (and get a fresh identity token).
  async loadSession() {
    try {
      const r = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
      this.user = r.ok ? await r.json() : null;
    } catch (e) { this.user = null; }
  },

  // ─── TRUEPRIVACY ──────────────────────────────────────────────
  // Official queue API. identify() is safe to call on every page; TruePrivacy
  // sends it only once per user. We send a stable user id (-> "User ID" field)
  // and the email (-> email identifier).
  identify(user) {
    window.TruePrivacyQueue.push((trueprivacy) => {
      console.log('[PulseSport] TruePrivacy identify:', user.id, user.email);
      trueprivacy.identify(user.id);              // shows in the "User ID" field
      // Email link needs the server-issued identity token (HMAC of this exact email).
      const opts = user.identityToken ? { identityToken: user.identityToken } : undefined;
      if (opts) trueprivacy.identify(user.email, 'email', opts);
      else trueprivacy.identify(user.email, 'email');
    });
  },

  // On sign-out: reset so the next visitor/user gets a fresh anonymous subject.
  clearIdentity() {
    window.TruePrivacyQueue.push((trueprivacy) => {
      console.log('[PulseSport] TruePrivacy reset');
      trueprivacy.reset();
    });
  },

  // ─── UI ───────────────────────────────────────────────────────
  renderHeader() {
    const btn = document.getElementById('account-btn');
    const label = document.getElementById('auth-email');
    const menuEmail = document.getElementById('auth-menu-email');
    const loggedIn = !!this.user;

    btn.classList.toggle('logged-in', loggedIn);
    btn.title = loggedIn ? 'Account' : 'Log in';
    label.textContent = loggedIn ? this.user.email : '';
    label.classList.toggle('show', loggedIn);
    menuEmail.textContent = loggedIn ? this.user.email : '';
  },

  onAccountClick() {
    const menu = document.getElementById('auth-menu');
    if (this.user) menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
    else this.openModal();
  },

  openModal() {
    document.getElementById('auth-modal').style.display = 'flex';
    document.getElementById('auth-form').reset();
    this.setError('email', '');
    this.setError('password', '');
    // When login is required, there is no way to dismiss the popup
    document.querySelector('.auth-close').style.display = this.REQUIRE_LOGIN && !this.user ? 'none' : 'flex';
    setTimeout(() => document.getElementById('auth-email-input').focus(), 0);
  },

  closeModal() {
    if (this.REQUIRE_LOGIN && !this.user) return;
    document.getElementById('auth-modal').style.display = 'none';
  },

  setError(field, message) {
    document.getElementById(`auth-${field}-error`).textContent = message;
    document.getElementById(`auth-${field}-field`).classList.toggle('invalid', !!message);
  },

  // ─── ACTIONS ──────────────────────────────────────────────────
  submit(e) {
    e.preventDefault();
    const email = document.getElementById('auth-email-input').value.trim();
    const password = document.getElementById('auth-password-input').value;
    let ok = true;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.setError('email', 'Enter a valid email address, like name@example.com.');
      ok = false;
    } else this.setError('email', '');

    if (password.length < 6) {
      this.setError('password', 'Password must be at least 6 characters.');
      ok = false;
    } else this.setError('password', '');

    if (!ok) return;

    fetch('/api/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) { this.setError(data.field || 'email', data.error || 'Login failed'); return; }
        this.user = data;                      // { email, id, identityToken, ... }
        this.closeModal();
        this.renderHeader();
        this.identify(this.user);
        App.showToast('Logged in as ' + email);
      })
      .catch(() => this.setError('email', 'Could not reach the server. Try again.'));
  },

  logout() {
    this.user = null;
    fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    document.getElementById('auth-menu').style.display = 'none';
    this.renderHeader();
    this.clearIdentity();
    if (this.REQUIRE_LOGIN) this.openModal();
    else App.showToast('Logged out');
  },

  bind() {
    document.getElementById('auth-form').addEventListener('submit', (e) => this.submit(e));
    document.getElementById('auth-modal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeModal();
        document.getElementById('auth-menu').style.display = 'none';
      }
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.account-wrap')) {
        document.getElementById('auth-menu').style.display = 'none';
      }
    });
  }
};

document.addEventListener('DOMContentLoaded', () => Auth.init());