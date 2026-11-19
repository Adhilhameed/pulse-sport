const App = {
  products: [],
  cart: [],
  activeCategory: 'all',
  sortBy: 'default',
  searchQuery: '',
  selectedProduct: null,
  modalQty: 1,
  modalSize: '',
  modalColor: '',

  async init() {
    await this.loadProducts();
    await this.loadCart();
    this.render();
    this.bindGlobalEvents();
  },

  // ─── DATA ─────────────────────────────────────────────────────
  async loadProducts() {
    try {
      const params = new URLSearchParams();
      if (this.activeCategory !== 'all') params.set('category', this.activeCategory);
      if (this.searchQuery) params.set('search', this.searchQuery);
      if (this.sortBy !== 'default') params.set('sort', this.sortBy);

      const res = await fetch('/api/products?' + params.toString());
      const data = await res.json();
      this.products = data.products;
    } catch (e) {
      console.error('Failed to load products', e);
    }
  },

  async loadCart() {
    try {
      const res = await fetch('/api/cart');
      const data = await res.json();
      this.cart = data;
    } catch (e) {
      console.error('Failed to load cart', e);
    }
    this.updateCartBadge();
  },

  // ─── RENDERING ────────────────────────────────────────────────
  render() {
    this.renderProducts();
    this.updateCartBadge();
  },

  renderProducts() {
    const grid = document.getElementById('product-grid');
    if (!grid) return;

    if (this.products.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <svg width="64" height="64" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          <h3>No products found</h3>
          <p>Try adjusting your search or filters</p>
          <button class="btn btn-secondary btn-sm" style="margin-top:16px" onclick="App.clearFilters()">Clear Filters</button>
        </div>`;
      return;
    }

    grid.innerHTML = this.products.map(p => `
      <div class="product-card" onclick="App.openProduct(${p.id})">
        <div class="product-card-image">
          <img src="${p.image}" alt="${p.name}" loading="lazy">
          ${p.badge ? `<span class="product-card-badge">${p.badge}</span>` : ''}
          <button class="product-card-wishlist" onclick="event.stopPropagation(); App.toggleWishlist(${p.id})" title="Add to wishlist">
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>
          </button>
        </div>
        <div class="product-card-body">
          <div class="product-card-category">${p.category}</div>
          <div class="product-card-name">${p.name}</div>
          <div class="product-card-rating">
            <span class="stars">${this.renderStars(p.rating)}</span>
            <span class="rating-text">${p.rating} (${p.reviews})</span>
          </div>
          <div class="product-card-footer">
            <div class="product-price">
              $${p.price.toFixed(2)}
              ${p.originalPrice ? `<span class="original">$${p.originalPrice.toFixed(2)}</span>` : ''}
            </div>
            <button class="add-cart-btn" onclick="event.stopPropagation(); App.quickAdd(${p.id})" title="Add to cart">
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
            </button>
          </div>
        </div>
      </div>
    `).join('');
  },

  renderStars(rating) {
    const full = Math.floor(rating);
    const half = rating % 1 >= 0.5 ? 1 : 0;
    const empty = 5 - full - half;
    return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty);
  },

  updateCartBadge() {
    const badge = document.getElementById('cart-badge');
    if (!badge) return;
    const count = this.cart.itemCount || 0;
    badge.textContent = count;
    badge.style.display = count > 0 ? 'flex' : 'none';
  },

  // ─── PRODUCT DETAIL MODAL ────────────────────────────────────
  async openProduct(id) {
    try {
      const res = await fetch(`/api/products/${id}`);
      const data = await res.json();
      this.selectedProduct = data.product;
      this.modalQty = 1;
      this.modalSize = data.product.sizes[0] || '';
      this.modalColor = data.product.colors[0] || '';
      this.renderModal(data.product, data.related);
    } catch (e) {
      console.error('Failed to load product', e);
    }
  },

  renderModal(product, related) {
    const overlay = document.getElementById('product-modal');
    const body = document.getElementById('modal-body');

    const savings = product.originalPrice ? (product.originalPrice - product.price).toFixed(2) : null;

    body.innerHTML = `
      <div class="modal-image">
        <img src="${product.gallery[0] || product.image}" alt="${product.name}">
      </div>
      <div class="modal-info">
        <button class="modal-close" onclick="App.closeModal()">
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
        <div class="modal-category">${product.category} / ${product.subcategory || ''}</div>
        <h2 class="modal-name">${product.name}</h2>
        <div class="modal-price-row">
          <span class="modal-price">$${product.price.toFixed(2)}</span>
          ${product.originalPrice ? `<span class="modal-original-price">$${product.originalPrice.toFixed(2)}</span>` : ''}
          ${savings ? `<span class="modal-save-badge">Save $${savings}</span>` : ''}
        </div>
        <div class="product-card-rating" style="margin-bottom:16px">
          <span class="stars">${this.renderStars(product.rating)}</span>
          <span class="rating-text">${product.rating} · ${product.reviews} reviews</span>
        </div>
        <p class="modal-desc">${product.description}</p>
        <div class="modal-features">
          ${product.features.map(f => `<span class="feature-tag">✓ ${f}</span>`).join('')}
        </div>

        ${product.sizes.length > 0 ? `
          <div class="option-group">
            <span class="option-label">Size</span>
            <div class="option-chips">
              ${product.sizes.map(s => `<button class="option-chip ${s === this.modalSize ? 'selected' : ''}" onclick="App.selectSize('${s}')">${s}</button>`).join('')}
            </div>
          </div>
        ` : ''}

        ${product.colors.length > 0 ? `
          <div class="option-group">
            <span class="option-label">Color</span>
            <div class="option-chips">
              ${product.colors.map(c => `<button class="option-chip ${c === this.modalColor ? 'selected' : ''}" onclick="App.selectColor('${c}')">${c}</button>`).join('')}
            </div>
          </div>
        ` : ''}

        <div class="option-group">
          <span class="option-label">Quantity</span>
          <div class="qty-control">
            <button class="qty-btn" onclick="App.changeModalQty(-1)">−</button>
            <input type="text" class="qty-value" value="${this.modalQty}" readonly>
            <button class="qty-btn" onclick="App.changeModalQty(1)">+</button>
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn btn-primary" style="flex:1" onclick="App.addFromModal()">
            <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/></svg>
            Add to Cart — $${(product.price * this.modalQty).toFixed(2)}
          </button>
        </div>

        <p style="margin-top:14px;font-size:12px;color:var(--text-muted)">
          ${product.inStock ? `<span style="color:var(--success)">✓ In Stock</span> — ${product.stockCount} units available` : '<span style="color:var(--danger)">✗ Out of Stock</span>'}
        </p>
      </div>
    `;

    overlay.classList.add('show');
    document.body.style.overflow = 'hidden';
  },

  selectSize(size) {
    this.modalSize = size;
    if (this.selectedProduct) this.renderModal(this.selectedProduct, []);
  },

  selectColor(color) {
    this.modalColor = color;
    if (this.selectedProduct) this.renderModal(this.selectedProduct, []);
  },

  changeModalQty(delta) {
    this.modalQty = Math.max(1, this.modalQty + delta);
    if (this.selectedProduct) this.renderModal(this.selectedProduct, []);
  },

  closeModal() {
    document.getElementById('product-modal').classList.remove('show');
    document.body.style.overflow = '';
    this.selectedProduct = null;
  },

  // ─── CART OPERATIONS ──────────────────────────────────────────
  async quickAdd(productId) {
    const product = this.products.find(p => p.id === productId);
    if (!product) return;
    await fetch('/api/cart/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, qty: 1, size: product.sizes[0] || '', color: product.colors[0] || '' })
    });
    await this.loadCart();
    this.showToast(`${product.name} added to cart`);
  },

  async addFromModal() {
    if (!this.selectedProduct) return;
    const productName = this.selectedProduct.name;
    await fetch('/api/cart/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: this.selectedProduct.id, qty: this.modalQty, size: this.modalSize, color: this.modalColor })
    });
    await this.loadCart();
    this.closeModal();
    this.showToast(`${productName} added to cart`);
  },

  async removeCartItem(productId, size, color) {
    await fetch('/api/cart/remove', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, size, color })
    });
    await this.loadCart();
    this.renderCartDrawer();
  },

  async updateCartQty(productId, size, color, qty) {
    await fetch('/api/cart/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, qty, size, color })
    });
    await this.loadCart();
    this.renderCartDrawer();
  },

  async checkout() {
    if (!this.cart.items || this.cart.items.length === 0) return;
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (data.success) {
        await this.loadCart();
        this.closeCartDrawer();
        this.showToast(`Order ${data.order.id} confirmed!`);
      }
    } catch (e) {
      console.error('Checkout failed', e);
    }
  },

  // ─── CART DRAWER ──────────────────────────────────────────────
  openCartDrawer() {
    this.renderCartDrawer();
    document.getElementById('cart-drawer').classList.add('open');
    document.getElementById('drawer-overlay').classList.add('show');
    document.body.style.overflow = 'hidden';
  },

  closeCartDrawer() {
    document.getElementById('cart-drawer').classList.remove('open');
    document.getElementById('drawer-overlay').classList.remove('show');
    document.body.style.overflow = '';
  },

  renderCartDrawer() {
    const container = document.getElementById('cart-items');
    const summaryEl = document.getElementById('cart-summary');

    if (!this.cart.items || this.cart.items.length === 0) {
      container.innerHTML = `
        <div class="cart-empty">
          <svg width="56" height="56" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/></svg>
          <h3 style="font-size:16px;font-weight:600;margin-bottom:4px">Your cart is empty</h3>
          <p style="font-size:13px">Add some gear to get started</p>
        </div>`;
      summaryEl.innerHTML = '';
      return;
    }

    container.innerHTML = this.cart.items.map(item => `
      <div class="cart-item">
        <img src="${item.product.image}" alt="${item.product.name}">
        <div class="cart-item-info">
          <div class="cart-item-name">${item.product.name}</div>
          <div class="cart-item-variant">${[item.size, item.color].filter(Boolean).join(' · ')}</div>
          <div class="cart-item-row">
            <div class="qty-control" style="transform:scale(0.85);transform-origin:left">
              <button class="qty-btn" onclick="App.updateCartQty(${item.productId}, '${item.size}', '${item.color}', ${item.qty - 1})">−</button>
              <input class="qty-value" value="${item.qty}" readonly>
              <button class="qty-btn" onclick="App.updateCartQty(${item.productId}, '${item.size}', '${item.color}', ${item.qty + 1})">+</button>
            </div>
            <span class="cart-item-price">$${(item.product.price * item.qty).toFixed(2)}</span>
          </div>
          <button class="cart-item-remove" onclick="App.removeCartItem(${item.productId}, '${item.size}', '${item.color}')">Remove</button>
        </div>
      </div>
    `).join('');

    summaryEl.innerHTML = `
      <div class="cart-summary-row"><span>Subtotal</span><span>$${this.cart.subtotal.toFixed(2)}</span></div>
      <div class="cart-summary-row"><span>Shipping</span><span>${this.cart.shipping === 0 ? '<span style="color:var(--success)">Free</span>' : '$' + this.cart.shipping.toFixed(2)}</span></div>
      <div class="cart-summary-row"><span>Tax (8%)</span><span>$${this.cart.tax.toFixed(2)}</span></div>
      <div class="cart-summary-total"><span>Total</span><span>$${this.cart.total.toFixed(2)}</span></div>
      ${this.cart.subtotal < 75 ? `<p class="free-shipping-note">Add $${(75 - this.cart.subtotal).toFixed(2)} more for free shipping!</p>` : '<p class="free-shipping-note">🎉 You qualify for free shipping!</p>'}
      <button class="btn btn-primary" style="width:100%" onclick="App.checkout()">
        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
        Checkout
      </button>
    `;
  },

  // ─── WISHLIST ─────────────────────────────────────────────────
  async toggleWishlist(productId) {
    await fetch('/api/user/wishlist/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId })
    });
  },

  // ─── FILTERING & SEARCH ──────────────────────────────────────
  async setCategory(cat) {
    this.activeCategory = cat;
    document.querySelectorAll('.pill').forEach(p => {
      p.classList.toggle('active', p.dataset.cat === cat);
    });
    await this.loadProducts();
    this.renderProducts();
  },

  async setSort(sort) {
    this.sortBy = sort;
    await this.loadProducts();
    this.renderProducts();
  },

  async search(query) {
    this.searchQuery = query;
    await this.loadProducts();
    this.renderProducts();
  },

  clearFilters() {
    this.activeCategory = 'all';
    this.searchQuery = '';
    this.sortBy = 'default';
    const input = document.getElementById('search-input');
    if (input) input.value = '';
    document.querySelectorAll('.pill').forEach(p => p.classList.toggle('active', p.dataset.cat === 'all'));
    const sortEl = document.getElementById('sort-select');
    if (sortEl) sortEl.value = 'default';
    this.loadProducts().then(() => this.renderProducts());
  },

  // ─── SEARCH SUGGESTIONS ──────────────────────────────────────
  async showSuggestions(query) {
    const box = document.getElementById('search-suggestions');
    if (!box) return;
    if (query.length < 2) { box.classList.remove('show'); return; }

    try {
      const res = await fetch('/api/search/suggestions?q=' + encodeURIComponent(query));
      const data = await res.json();
      if (data.suggestions.length === 0) { box.classList.remove('show'); return; }

      box.innerHTML = data.suggestions.map(s => `
        <div class="suggestion-item" onclick="App.openProduct(${s.id}); document.getElementById('search-suggestions').classList.remove('show')">
          <img src="${s.image}" alt="${s.name}">
          <div>
            <div class="s-name">${s.name}</div>
            <div class="s-meta">${s.category} · $${s.price.toFixed(2)}</div>
          </div>
        </div>
      `).join('');
      box.classList.add('show');
    } catch (e) {
      box.classList.remove('show');
    }
  },

  // ─── NEWSLETTER ───────────────────────────────────────────────
  async subscribeNewsletter(e) {
    e.preventDefault();
    const input = document.getElementById('newsletter-email');
    const email = input.value.trim();
    if (!email) return;
    await fetch('/api/newsletter/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    input.value = '';
    this.showToast('Subscribed! Check your inbox for 15% off.');
  },

  // ─── EVENTS ───────────────────────────────────────────────────
  bindGlobalEvents() {
    // Search
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      let debounce;
      searchInput.addEventListener('input', (e) => {
        clearTimeout(debounce);
        this.showSuggestions(e.target.value);
        debounce = setTimeout(() => this.search(e.target.value), 400);
      });
      searchInput.addEventListener('blur', () => {
        setTimeout(() => {
          const box = document.getElementById('search-suggestions');
          if (box) box.classList.remove('show');
        }, 200);
      });
    }

    // Close modal on overlay click
    document.getElementById('product-modal')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.closeModal();
    });

    // Close cart on overlay click
    document.getElementById('drawer-overlay')?.addEventListener('click', () => {
      this.closeCartDrawer();
    });

    // ESC key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeModal();
        this.closeCartDrawer();
      }
    });
  },

  // ─── TOAST ────────────────────────────────────────────────────
  showToast(message) {
    const toast = document.getElementById('toast');
    const msgEl = document.getElementById('toast-message');
    if (!toast || !msgEl) return;
    msgEl.textContent = message;
    toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
