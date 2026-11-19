/**
 * PulseSport demo login (front-end only, self-contained).
 * - Login is REQUIRED before the shop is usable (set REQUIRE_LOGIN = false to make it optional).
 * - Any valid email + password of 6+ characters logs in.
 * - The session lives in localStorage so it survives refresh.
 * - After login (and on every page load while logged in) the email is passed
 *   to TruePrivacy through Auth.identify().
 * - Its own styles are injected from this file, so nothing else needs deploying.
 */
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
  KEY: 'pulsesport_user',
  REQUIRE_LOGIN: true,
  user: null,

  init() {
    const style = document.createElement('style');
    style.textContent = AUTH_CSS;
    document.head.appendChild(style);

    this.user = this.read();
    this.renderHeader();
    this.bind();

    if (this.user) {
      if (document.readyState === 'complete') this.identify(this.user.email);
      else window.addEventListener('load', () => this.identify(this.user.email));
    } else if (this.REQUIRE_LOGIN) {
      this.openModal();
    }
  },

  // ─── STORAGE ──────────────────────────────────────────────────
  read() {
    try { return JSON.parse(localStorage.getItem(this.KEY)); } catch (e) { return null; }
  },

  // ─── TRUEPRIVACY LINKING ──────────────────────────────────────
  // The banner (banner.js) keeps an anonymous "subject" per visitor and lets you
  // attach an identifier to it (type "email"). Consent Management then shows that
  // identifier for the subject. We do this in two ways:
  //   1) Preferred: call the banner's own identify(email, 'email') if its global is found.
  //   2) Fallback: call the same public endpoint the banner uses, once the visitor
  //      has a subject id (i.e. after they make a cookie choice).
  TP_GLOBALS: ['TruePrivacy', 'trueprivacy', 'truePrivacy', 'TruePrivacyConsent', 'TP', 'tp'],
  TP_MARKER: 'pulsesport_tp_linked',
  _linkTimer: null,

  tpSdk() {
    for (const name of this.TP_GLOBALS) {
      const g = window[name];
      if (g && typeof g.identify === 'function') return g;
    }
    return null;
  },

  tpScript() {
    return document.querySelector('script[data-key^="tp_ck_"]');
  },

  tpSubjectId() {
    const m = document.cookie.match(/(?:^|; )_tp_consent=([^;]*)/);
    if (m) return decodeURIComponent(m[1]);
    try { return localStorage.getItem('_tp_consent_sid'); } catch (e) { return null; }
  },

  identify(email) {
    const sdk = this.tpSdk();
    if (sdk) {
      console.log('[PulseSport] Linking email via TruePrivacy SDK:', email);
      try { sdk.identify(email, 'email'); } catch (err) { console.warn('[PulseSport] SDK identify failed:', err); }
      return;
    }
    console.warn('[PulseSport] TruePrivacy SDK global not found; using direct API link instead.');
    this.linkViaApi(email);
  },

  linkViaApi(email) {
    clearInterval(this._linkTimer);
    const script = this.tpScript();
    if (!script) { console.warn('[PulseSport] TruePrivacy banner <script data-key=...> not found.'); return; }

    const key = script.getAttribute('data-key');
    const base = (script.getAttribute('data-api') || 'https://consent.truecookieconsent.com').replace(/\/$/, '');
    let tries = 0;

    const attempt = async () => {
      const subjectId = this.tpSubjectId();
      if (!subjectId) {
        // No subject yet: it is created when the visitor makes a cookie choice. Keep waiting (up to ~10 min).
        if (++tries > 600) clearInterval(this._linkTimer);
        return;
      }
      clearInterval(this._linkTimer);

      const marker = subjectId + '|' + email;
      try { if (localStorage.getItem(this.TP_MARKER) === marker) return; } catch (e) {}

      try {
        const res = await fetch(`${base}/v1/public/consent/${key}/identify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'omit',
          body: JSON.stringify({ subjectId, identifier: email, identifierType: 'email' })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        try { localStorage.setItem(this.TP_MARKER, marker); } catch (e) {}
        console.log('[PulseSport] Linked', email, 'to TruePrivacy subject', subjectId);
      } catch (err) {
        console.warn('[PulseSport] Could not link email to TruePrivacy:', err);
      }
    };

    this._linkTimer = setInterval(attempt, 1000);
    attempt();
  },

  // On logout, drop the link so the next visitor/user gets a fresh anonymous subject.
  clearIdentity() {
    clearInterval(this._linkTimer);
    const sdk = this.tpSdk();
    if (sdk && typeof sdk.reset === 'function') {
      try { sdk.reset(); console.log('[PulseSport] TruePrivacy identity reset'); return; } catch (err) {}
    }
    // Manual equivalent of the SDK's reset()
    document.cookie = '_tp_consent=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax';
    ['_tp_consent_sid', '_tp_uid_linked', '_tp_identified_email', '_tp_identified_hashed_email',
     '_tp_identified_external_id', '_tp_consent_receipt', this.TP_MARKER].forEach((k) => {
      try { localStorage.removeItem(k); } catch (e) {}
    });
    window.location.reload();
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

    this.user = { email, loggedInAt: new Date().toISOString() };
    try { localStorage.setItem(this.KEY, JSON.stringify(this.user)); } catch (err) {}

    this.closeModal();
    this.renderHeader();
    this.identify(email);
    App.showToast('Logged in as ' + email);
  },

  logout() {
    this.user = null;
    try { localStorage.removeItem(this.KEY); } catch (err) {}
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