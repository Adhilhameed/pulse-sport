/**
 * PulseSport demo login (front-end only).
 * - Any valid email + password of 6+ characters logs in.
 * - The session lives in localStorage so it survives refresh.
 * - After login (and on every page load while logged in) the user's
 *   email is handed to TruePrivacy via Auth.identify().
 */
const Auth = {
  KEY: 'pulsesport_user',
  user: null,

  init() {
    this.user = this.read();
    this.renderHeader();
    this.bind();
    // Returning, already-logged-in user: re-send identity once the page (and banner) have loaded
    if (this.user) {
      if (document.readyState === 'complete') this.identify(this.user.email);
      else window.addEventListener('load', () => this.identify(this.user.email));
    }
  },

  // ─── STORAGE ──────────────────────────────────────────────────
  read() {
    try { return JSON.parse(localStorage.getItem(this.KEY)); } catch (e) { return null; }
  },

  // ─── TRUEPRIVACY HOOK ─────────────────────────────────────────
  // Replace the body of this function with the identify call from the
  // TruePrivacy dashboard / docs (Cookie Banner → install section).
  identify(email) {
    console.log('[TruePrivacy] identify user:', email);
    // TODO: e.g. window.<TruePrivacySDK>.<identifyMethod>({ email });
  },

  // Called on logout so later consent events aren't attached to this user.
  clearIdentity() {
    console.log('[TruePrivacy] clear user identity');
    // TODO: call TruePrivacy's reset/clear-identity method if the SDK has one.
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
    if (this.user) document.getElementById('auth-menu').classList.toggle('show');
    else this.openModal();
  },

  openModal() {
    document.getElementById('auth-modal').classList.add('show');
    document.getElementById('auth-form').reset();
    this.setError('email', '');
    this.setError('password', '');
    setTimeout(() => document.getElementById('auth-email-input').focus(), 0);
  },

  closeModal() {
    document.getElementById('auth-modal').classList.remove('show');
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
    document.getElementById('auth-menu').classList.remove('show');
    this.renderHeader();
    this.clearIdentity();
    App.showToast('Logged out');
  },

  bind() {
    document.getElementById('auth-form').addEventListener('submit', (e) => this.submit(e));
    document.getElementById('auth-modal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeModal();
        document.getElementById('auth-menu').classList.remove('show');
      }
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.account-wrap')) {
        document.getElementById('auth-menu').classList.remove('show');
      }
    });
  }
};

document.addEventListener('DOMContentLoaded', () => Auth.init());