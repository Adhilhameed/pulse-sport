console.log('TP secret present:', !!process.env.TRUEPRIVACY_IDENTITY_SECRET, '| env keys:', Object.keys(process.env).filter(k => k.includes('TRUEPRIVACY')));
const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── TruePrivacy config (set these as environment variables on Render) ─
// TP_API_KEY         : API key from TruePrivacy > Settings > API keys
// TP_WEBHOOK_SECRET  : signing secret shown when the webhook was created
// TP_API_BASE        : TruePrivacy API base URL (check your API docs / API keys page)
// TP_ENFORCE_SIG     : set to "true" to reject webhooks with a bad signature
const TP_API_KEY = process.env.TP_API_KEY || '';
const TP_WEBHOOK_SECRET = process.env.TP_WEBHOOK_SECRET || '';
const TP_API_BASE = (process.env.TP_API_BASE || 'https://api.trueprivacy.io').replace(/\/$/, '');
const TP_ENFORCE_SIG = process.env.TP_ENFORCE_SIG === 'true';

// Identity verification secret (TruePrivacy > Identity verification > Reveal secret).
// Server-side only. Never expose it to the page.
const TP_IDENTITY_SECRET = process.env.TRUEPRIVACY_IDENTITY_SECRET || '';
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'change-me-in-production';
if (!TP_IDENTITY_SECRET) console.warn('[TruePrivacy] TRUEPRIVACY_IDENTITY_SECRET is not set: identity tokens will not be issued');

// Token = HMAC-SHA256(secret, value passed to identify()), trimmed + lowercased.
function identityToken(value) {
  if (!TP_IDENTITY_SECRET) return null;
  return crypto.createHmac('sha256', TP_IDENTITY_SECRET)
    .update(String(value).trim().toLowerCase())
    .digest('hex');
}

// Stable internal user id derived from the email (same email -> same id).
// Must NOT look like an email.
function makeUserId(email) {
  let h = 2166136261;
  const str = email.trim().toLowerCase();
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return 'usr_' + (h >>> 0).toString(36);
}

// Verify the webhook signature. Header format (from your logs):
//   x-trueprivacy-signature-v2: t=<timestamp>,v1=<hex>
// Assumed scheme: HMAC-SHA256(secret, `${t}.${rawBody}`). Falls back to the
// legacy header: HMAC-SHA256(secret, rawBody). The result is logged so you can
// confirm which one matches before turning on TP_ENFORCE_SIG.
function verifyTruePrivacySignature(rawBody, headers) {
  if (!TP_WEBHOOK_SECRET) return { ok: false, reason: 'TP_WEBHOOK_SECRET not set' };

  const safeEqual = (a, b) => {
    const ba = Buffer.from(a || '', 'utf8');
    const bb = Buffer.from(b || '', 'utf8');
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  };

  const v2 = headers['x-trueprivacy-signature-v2'];
  if (v2) {
    const parts = Object.fromEntries(v2.split(',').map(p => p.trim().split('=')));
    if (parts.t && parts.v1) {
      const expected = crypto.createHmac('sha256', TP_WEBHOOK_SECRET)
        .update(`${parts.t}.${rawBody}`).digest('hex');
      if (safeEqual(expected, parts.v1)) return { ok: true, reason: 'v2 matched' };
    }
  }

  const legacy = headers['x-trueprivacy-signature'];
  if (legacy) {
    const expected = crypto.createHmac('sha256', TP_WEBHOOK_SECRET)
      .update(rawBody).digest('hex');
    if (safeEqual(expected, legacy)) return { ok: true, reason: 'legacy matched' };
  }

  return { ok: false, reason: 'no signature matched (scheme may differ from assumption)' };
}

// Your own check that this guardian email belongs to a known adult user.
// Test site: every guardian email is treated as an adult. Replace with a real
// lookup (e.g. your users table) in production.
async function isKnownAdult(email) {
  return true;
}

// Tell TruePrivacy that this guardian is a known adult.
// NOTE: the request body and auth header below are best guesses. If the call
// fails, the logged response will say what it expects.
async function markGuardianAdult(parentalConsentId, email) {
  const url = `${TP_API_BASE}/v1/parental-consents/${parentalConsentId}/adult-account`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TP_API_KEY}`,
        'x-api-key': TP_API_KEY
      },
      body: JSON.stringify({ email })
    });
    const text = await resp.text();
    console.log(`[TruePrivacy] adult-account -> ${resp.status} ${text}`);
  } catch (err) {
    console.error('[TruePrivacy] adult-account call failed:', err);
  }
}

// ─── TruePrivacy webhook (must come BEFORE express.json()) ────────────
app.post('/webhooks/trueprivacy', express.raw({ type: '*/*' }), async (req, res) => {
  const rawBody = req.body.toString('utf8');

  const sig = verifyTruePrivacySignature(rawBody, req.headers);
  console.log('--- TRUEPRIVACY WEBHOOK ---');
  console.log('Event:', req.headers['x-trueprivacy-event'], '| Signature:', sig.ok, '-', sig.reason);
  console.log('BODY:', rawBody);

  if (TP_ENFORCE_SIG && !sig.ok) return res.sendStatus(401);

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (e) {
    return res.sendStatus(400);
  }

  // Acknowledge quickly so TruePrivacy does not retry
  res.sendStatus(200);

  if (event.event !== 'parental_consent.requested') return;

  const parentalConsentId = event.data && event.data.parentalConsentId;
  const guardianEmail = event.data && event.data.guardianEmail;
  if (!parentalConsentId || !guardianEmail) {
    console.log('[TruePrivacy] Missing parentalConsentId or guardianEmail, skipping');
    return;
  }

  if (await isKnownAdult(guardianEmail)) {
    await markGuardianAdult(parentalConsentId, guardianEmail);
  } else {
    console.log('[TruePrivacy] Guardian is not a known adult, not confirming:', guardianEmail);
  }
});

console.log('Serving from:', path.join(__dirname, 'public'));
app.use(express.json());
app.use(cookieParser(COOKIE_SECRET));
app.use(express.static(path.join(__dirname, 'public')));

// ─── In-Memory Database ───────────────────────────────────────────────
const db = {
  products: [
    {
      id: 1,
      name: 'Velocity Pro Running Shoes',
      slug: 'velocity-pro-running-shoes',
      category: 'Footwear',
      subcategory: 'Running',
      price: 179.99,
      originalPrice: 219.99,
      rating: 4.9,
      reviews: 342,
      badge: 'Best Seller',
      sizes: ['US 7', 'US 8', 'US 9', 'US 10', 'US 11', 'US 12'],
      colors: ['Midnight Black', 'Storm Grey', 'Electric Blue'],
      image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600&auto=format&fit=crop&q=80',
      gallery: [
        'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1606107557195-0e29a4b5b4aa?w=800&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1608231387042-66d1773070a5?w=800&auto=format&fit=crop&q=80'
      ],
      description: 'Engineered with carbon-fiber plate technology for explosive energy return. Ultra-lightweight mesh upper with adaptive lacing delivers a locked-in, breathable fit from the starting line to the finish.',
      features: ['Carbon Fiber Plate', 'React Foam Midsole', 'Breathable Flyknit Upper', 'Reflective Details'],
      inStock: true,
      stockCount: 24
    },
    {
      id: 2,
      name: 'AeroFlex Training Tee',
      slug: 'aeroflex-training-tee',
      category: 'Apparel',
      subcategory: 'Tops',
      price: 44.99,
      originalPrice: null,
      rating: 4.7,
      reviews: 189,
      badge: 'New Arrival',
      sizes: ['S', 'M', 'L', 'XL', 'XXL'],
      colors: ['Black', 'Navy', 'White', 'Crimson'],
      image: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=600&auto=format&fit=crop&q=80',
      gallery: [
        'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=800&auto=format&fit=crop&q=80'
      ],
      description: 'Sweat-wicking Dri-Motion micro-mesh fabric keeps you cool and dry during the most intense HIIT sessions. Raglan sleeves allow full range of motion.',
      features: ['Dri-Motion Fabric', '4-Way Stretch', 'Anti-Odor Treatment', 'Flatlock Seams'],
      inStock: true,
      stockCount: 86
    },
    {
      id: 3,
      name: 'TitanGrip Hex Dumbbells 25kg',
      slug: 'titangrip-hex-dumbbells-25kg',
      category: 'Equipment',
      subcategory: 'Weights',
      price: 89.99,
      originalPrice: 109.99,
      rating: 4.8,
      reviews: 127,
      badge: 'Popular',
      sizes: ['10kg', '15kg', '20kg', '25kg', '30kg'],
      colors: ['Matte Black'],
      image: 'https://images.unsplash.com/photo-1584735935682-2f2b69dff9d2?w=600&auto=format&fit=crop&q=80',
      gallery: [
        'https://images.unsplash.com/photo-1584735935682-2f2b69dff9d2?w=800&auto=format&fit=crop&q=80'
      ],
      description: 'Heavy-duty rubber-encased hexagonal iron dumbbells with knurled chrome handles. Anti-roll hex design keeps your gym floor safe and your workout uninterrupted.',
      features: ['Rubber Encased', 'Chrome Knurled Grip', 'Anti-Roll Hex Shape', 'Sold in Pairs'],
      inStock: true,
      stockCount: 42
    },
    {
      id: 4,
      name: 'Apex Pulse 5 Smartwatch',
      slug: 'apex-pulse-5-smartwatch',
      category: 'Electronics',
      subcategory: 'Wearables',
      price: 249.99,
      originalPrice: 299.99,
      rating: 4.6,
      reviews: 528,
      badge: 'Top Rated',
      sizes: ['40mm', '44mm'],
      colors: ['Graphite', 'Silver', 'Rose Gold'],
      image: 'https://images.unsplash.com/photo-1575311373937-040b8e1fd5b6?w=600&auto=format&fit=crop&q=80',
      gallery: [
        'https://images.unsplash.com/photo-1575311373937-040b8e1fd5b6?w=800&auto=format&fit=crop&q=80'
      ],
      description: 'Advanced multi-sport GPS smartwatch with real-time heart rate, VO2 max estimation, blood oxygen monitoring, sleep coaching, and 14-day battery life. Water resistant to 50m.',
      features: ['GPS + GLONASS', 'Heart Rate & SpO2', '14-Day Battery', '5 ATM Water Resistance'],
      inStock: true,
      stockCount: 15
    },
    {
      id: 5,
      name: 'TrailMaster Hydration Vest 12L',
      slug: 'trailmaster-hydration-vest-12l',
      category: 'Accessories',
      subcategory: 'Bags',
      price: 69.99,
      originalPrice: null,
      rating: 4.8,
      reviews: 94,
      badge: null,
      sizes: ['S/M', 'M/L', 'L/XL'],
      colors: ['Black/Neon', 'Slate Grey'],
      image: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=600&auto=format&fit=crop&q=80',
      gallery: [
        'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=800&auto=format&fit=crop&q=80'
      ],
      description: 'Ultralight ergonomic running vest with 2L BPA-free hydration bladder, secure phone pocket, and adjustable sternum straps. Built for long trail runs and ultra marathons.',
      features: ['2L Hydration Bladder', 'Reflective Strips', 'Whistle Buckle', 'Multiple Pockets'],
      inStock: true,
      stockCount: 31
    },
    {
      id: 6,
      name: 'ThermaPulse Massage Gun Pro',
      slug: 'thermapulse-massage-gun-pro',
      category: 'Recovery',
      subcategory: 'Massage',
      price: 149.99,
      originalPrice: 189.99,
      rating: 4.9,
      reviews: 412,
      badge: 'Editor\'s Pick',
      sizes: [],
      colors: ['Matte Black', 'Arctic White'],
      image: 'https://images.unsplash.com/photo-1518611012118-696072aa579a?w=600&auto=format&fit=crop&q=80',
      gallery: [
        'https://images.unsplash.com/photo-1518611012118-696072aa579a?w=800&auto=format&fit=crop&q=80'
      ],
      description: 'Professional-grade percussion therapy device with heated titanium head, 5 speed settings, and whisper-quiet brushless motor. Includes 6 interchangeable attachment heads and carrying case.',
      features: ['Heated Head', '5 Speed Levels', '6 Attachments', '3-Hour Battery'],
      inStock: true,
      stockCount: 58
    },
    {
      id: 7,
      name: 'FlexCore Compression Tights',
      slug: 'flexcore-compression-tights',
      category: 'Apparel',
      subcategory: 'Bottoms',
      price: 64.99,
      originalPrice: null,
      rating: 4.5,
      reviews: 76,
      badge: null,
      sizes: ['S', 'M', 'L', 'XL'],
      colors: ['Black', 'Dark Navy'],
      image: 'https://images.unsplash.com/photo-1506152983158-b4a74a01c721?w=600&auto=format&fit=crop&q=80',
      gallery: [
        'https://images.unsplash.com/photo-1506152983158-b4a74a01c721?w=800&auto=format&fit=crop&q=80'
      ],
      description: 'Graduated compression technology enhances blood circulation and reduces muscle fatigue. High-rise waistband with internal drawcord for a secure, comfortable fit during any workout.',
      features: ['Graduated Compression', 'High-Rise Waistband', 'Moisture Wicking', 'UPF 50+'],
      inStock: true,
      stockCount: 44
    },
    {
      id: 8,
      name: 'CourtStrike Pro Tennis Shoes',
      slug: 'courtstrike-pro-tennis-shoes',
      category: 'Footwear',
      subcategory: 'Court',
      price: 139.99,
      originalPrice: null,
      rating: 4.7,
      reviews: 163,
      badge: null,
      sizes: ['US 7', 'US 8', 'US 9', 'US 10', 'US 11'],
      colors: ['White/Blue', 'Black/Red'],
      image: 'https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?w=600&auto=format&fit=crop&q=80',
      gallery: [
        'https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?w=800&auto=format&fit=crop&q=80'
      ],
      description: 'Reinforced lateral stability cage and non-marking Herringbone rubber outsole for superior multi-directional traction. Perfect for tennis, badminton, and squash.',
      features: ['Lateral Stability Cage', 'Herringbone Outsole', 'Ortholite Insole', 'Reinforced Toe'],
      inStock: true,
      stockCount: 37
    },
    {
      id: 9,
      name: 'PowerBand Resistance Set',
      slug: 'powerband-resistance-set',
      category: 'Equipment',
      subcategory: 'Bands',
      price: 34.99,
      originalPrice: 44.99,
      rating: 4.4,
      reviews: 256,
      badge: 'Value Pack',
      sizes: [],
      colors: ['Multi-Color Set'],
      image: 'https://images.unsplash.com/photo-1598289431512-b97b0917affc?w=600&auto=format&fit=crop&q=80',
      gallery: [
        'https://images.unsplash.com/photo-1598289431512-b97b0917affc?w=800&auto=format&fit=crop&q=80'
      ],
      description: 'Complete 5-band resistance training set with door anchor, ankle straps, and foam handles. Stackable bands provide up to 150 lbs of combined resistance for home or gym workouts.',
      features: ['5 Resistance Levels', 'Door Anchor', 'Ankle Straps', 'Carry Bag'],
      inStock: true,
      stockCount: 112
    },
    {
      id: 10,
      name: 'ArcticBreeze Windbreaker',
      slug: 'arcticbreeze-windbreaker',
      category: 'Apparel',
      subcategory: 'Outerwear',
      price: 89.99,
      originalPrice: null,
      rating: 4.6,
      reviews: 68,
      badge: 'Seasonal',
      sizes: ['S', 'M', 'L', 'XL', 'XXL'],
      colors: ['Black', 'Olive', 'Navy'],
      image: 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=600&auto=format&fit=crop&q=80',
      gallery: [
        'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=800&auto=format&fit=crop&q=80'
      ],
      description: 'Lightweight, packable windbreaker with DWR coating for light rain resistance. Mesh-lined for breathability on cool morning runs. Packs into its own chest pocket.',
      features: ['DWR Coating', 'Packable Design', 'Mesh Lined', 'Adjustable Hood'],
      inStock: true,
      stockCount: 29
    },
    {
      id: 11,
      name: 'ProGrip Yoga Mat 6mm',
      slug: 'progrip-yoga-mat-6mm',
      category: 'Equipment',
      subcategory: 'Yoga',
      price: 49.99,
      originalPrice: null,
      rating: 4.7,
      reviews: 203,
      badge: null,
      sizes: ['Standard (68")', 'Long (72")'],
      colors: ['Sage Green', 'Midnight Blue', 'Dusty Rose'],
      image: 'https://images.unsplash.com/photo-1601925260368-ae2f83cf8b7f?w=600&auto=format&fit=crop&q=80',
      gallery: [
        'https://images.unsplash.com/photo-1601925260368-ae2f83cf8b7f?w=800&auto=format&fit=crop&q=80'
      ],
      description: 'Premium TPE eco-friendly yoga mat with dual-texture surface for superior grip. 6mm cushioning protects joints during floor work. Includes carrying strap.',
      features: ['Eco-Friendly TPE', 'Non-Slip Surface', '6mm Cushion', 'Carrying Strap'],
      inStock: true,
      stockCount: 67
    },
    {
      id: 12,
      name: 'EliteShield Shin Guards',
      slug: 'eliteshield-shin-guards',
      category: 'Accessories',
      subcategory: 'Protection',
      price: 29.99,
      originalPrice: null,
      rating: 4.3,
      reviews: 91,
      badge: null,
      sizes: ['Youth', 'Adult S', 'Adult M', 'Adult L'],
      colors: ['Black', 'White'],
      image: 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=600&auto=format&fit=crop&q=80',
      gallery: [
        'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=800&auto=format&fit=crop&q=80'
      ],
      description: 'Lightweight EVA foam-backed polypropylene shell shin guards with compression sleeve. Anatomically contoured for natural movement during football and hockey.',
      features: ['PP Shell', 'EVA Foam Backing', 'Compression Sleeve', 'Anatomical Shape'],
      inStock: true,
      stockCount: 55
    }
  ],

  users: {
    'user1': {
      id: 'user1',
      name: 'Alex Johnson',
      email: 'alex@example.com',
      phone: '+1 (555) 234-5678',
      avatar: null,
      addresses: [
        { id: 'addr1', label: 'Home', line1: '742 Evergreen Terrace', city: 'Springfield', state: 'OR', zip: '97403', country: 'US', isDefault: true },
        { id: 'addr2', label: 'Office', line1: '200 Innovation Way, Suite 400', city: 'Portland', state: 'OR', zip: '97201', country: 'US', isDefault: false }
      ],
      wishlist: [2, 6, 10],
      createdAt: '2024-03-15T10:30:00Z'
    }
  },

  orders: [
    { id: 'ORD-20241012-8821', userId: 'user1', date: '2024-10-12', status: 'Delivered', items: [{ productId: 1, name: 'Velocity Pro Running Shoes', size: 'US 10', color: 'Midnight Black', qty: 1, price: 179.99 }], subtotal: 179.99, shipping: 0, tax: 14.40, total: 194.39, trackingNumber: '1Z9999W99999999999' },
    { id: 'ORD-20241102-9104', userId: 'user1', date: '2024-11-02', status: 'Shipped', items: [{ productId: 2, name: 'AeroFlex Training Tee', size: 'L', color: 'Black', qty: 2, price: 44.99 }, { productId: 6, name: 'ThermaPulse Massage Gun Pro', size: '', color: 'Matte Black', qty: 1, price: 149.99 }], subtotal: 239.97, shipping: 0, tax: 19.20, total: 259.17, trackingNumber: '1Z9999W99999999998' }
  ],

  carts: {},
  reviews: []
};

// ─── Session Middleware ──────────────────────────────────────────────
app.use((req, res, next) => {
  if (!req.cookies.session_id) {
    const sid = 'sess_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
    res.cookie('session_id', sid, { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' });
    req.sessionId = sid;
  } else {
    req.sessionId = req.cookies.session_id;
  }
  // Simple auth: use cookie or default to user1
  req.userId = req.cookies.user_id || 'user1';
  next();
});

// ─── AUTH + TRUEPRIVACY IDENTITY TOKEN ───────────────────────────────
// Demo login: any valid email + 6+ char password. The server remembers the
// email in a signed, httpOnly cookie, so the token is only ever issued for the
// email of the signed-in session (never for an email sent by the client later).
const AUTH_COOKIE = 'ps_auth';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sessionPayload(email) {
  const id = makeUserId(email);
  return {
    email,
    id,
    identityToken: identityToken(email),      // pass to identify(email, 'email', {identityToken})
    userIdToken: identityToken(id)            // optional: for identify(id, <type>, {identityToken})
  };
}

app.post('/api/login', (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase(); // same value is signed and passed to identify()
  const password = String((req.body && req.body.password) || '');
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address.', field: 'email' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.', field: 'password' });

  res.cookie(AUTH_COOKIE, email, {
    signed: true, httpOnly: true, sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
  res.json(sessionPayload(email));
});

app.get('/api/me', (req, res) => {
  const email = req.signedCookies && req.signedCookies[AUTH_COOKIE];
  if (!email) return res.status(401).json({ error: 'Not signed in' });
  res.set('Cache-Control', 'no-store');   // never cache a per-user token
  res.json(sessionPayload(email));
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(AUTH_COOKIE);
  res.json({ success: true });
});

// ─── PRODUCTS ────────────────────────────────────────────────────────
app.get('/api/products', (req, res) => {
  let results = [...db.products];
  const { category, search, sort, minPrice, maxPrice } = req.query;

  if (category && category !== 'all') {
    results = results.filter(p => p.category.toLowerCase() === category.toLowerCase());
  }
  if (search) {
    const q = search.toLowerCase();
    results = results.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      (p.subcategory && p.subcategory.toLowerCase().includes(q))
    );
  }
  if (minPrice) results = results.filter(p => p.price >= parseFloat(minPrice));
  if (maxPrice) results = results.filter(p => p.price <= parseFloat(maxPrice));

  if (sort === 'price-asc') results.sort((a, b) => a.price - b.price);
  else if (sort === 'price-desc') results.sort((a, b) => b.price - a.price);
  else if (sort === 'rating') results.sort((a, b) => b.rating - a.rating);
  else if (sort === 'newest') results.sort((a, b) => b.id - a.id);

  res.json({ products: results, total: results.length });
});

app.get('/api/products/:id', (req, res) => {
  const product = db.products.find(p => p.id === parseInt(req.params.id));
  if (!product) return res.status(404).json({ error: 'Product not found' });

  // Related products from same category
  const related = db.products.filter(p => p.category === product.category && p.id !== product.id).slice(0, 4);
  res.json({ product, related });
});

app.get('/api/categories', (req, res) => {
  const cats = {};
  db.products.forEach(p => {
    if (!cats[p.category]) cats[p.category] = { name: p.category, count: 0, subcategories: new Set() };
    cats[p.category].count++;
    if (p.subcategory) cats[p.category].subcategories.add(p.subcategory);
  });
  const categories = Object.values(cats).map(c => ({
    ...c,
    subcategories: [...c.subcategories]
  }));
  res.json({ categories });
});

// ─── CART ─────────────────────────────────────────────────────────────
app.get('/api/cart', (req, res) => {
  const cart = db.carts[req.sessionId] || [];
  const enriched = cart.map(item => {
    const product = db.products.find(p => p.id === item.productId);
    return { ...item, product };
  }).filter(item => item.product);

  const subtotal = enriched.reduce((s, i) => s + i.product.price * i.qty, 0);
  const shipping = subtotal >= 75 ? 0 : 9.99;
  const tax = +(subtotal * 0.08).toFixed(2);
  const total = +(subtotal + shipping + tax).toFixed(2);

  res.json({ items: enriched, subtotal: +subtotal.toFixed(2), shipping, tax, total, itemCount: enriched.reduce((s, i) => s + i.qty, 0) });
});

app.post('/api/cart/add', (req, res) => {
  const { productId, qty = 1, size, color } = req.body;
  const product = db.products.find(p => p.id === productId);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  if (!db.carts[req.sessionId]) db.carts[req.sessionId] = [];
  const cart = db.carts[req.sessionId];
  const existing = cart.find(i => i.productId === productId && i.size === size && i.color === color);

  if (existing) {
    existing.qty += qty;
  } else {
    cart.push({ productId, qty, size: size || product.sizes[0] || '', color: color || product.colors[0] || '' });
  }

  res.json({ success: true, message: `${product.name} added to cart` });
});

app.put('/api/cart/update', (req, res) => {
  const { productId, qty, size, color } = req.body;
  const cart = db.carts[req.sessionId] || [];
  const item = cart.find(i => i.productId === productId && i.size === size && i.color === color);

  if (item) {
    if (qty <= 0) {
      db.carts[req.sessionId] = cart.filter(i => !(i.productId === productId && i.size === size && i.color === color));
    } else {
      item.qty = qty;
    }
  }
  res.json({ success: true });
});

app.delete('/api/cart/remove', (req, res) => {
  const { productId, size, color } = req.body;
  const cart = db.carts[req.sessionId] || [];
  db.carts[req.sessionId] = cart.filter(i => !(i.productId === productId && i.size === (size || '') && i.color === (color || '')));
  res.json({ success: true });
});

app.delete('/api/cart/clear', (req, res) => {
  db.carts[req.sessionId] = [];
  res.json({ success: true });
});

// ─── CHECKOUT & ORDERS ───────────────────────────────────────────────
app.post('/api/checkout', (req, res) => {
  const cart = db.carts[req.sessionId] || [];
  if (cart.length === 0) return res.status(400).json({ error: 'Cart is empty' });

  const { shippingAddress, paymentMethod } = req.body;
  const items = cart.map(item => {
    const product = db.products.find(p => p.id === item.productId);
    return { productId: item.productId, name: product.name, size: item.size, color: item.color, qty: item.qty, price: product.price };
  });

  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const shipping = subtotal >= 75 ? 0 : 9.99;
  const tax = +(subtotal * 0.08).toFixed(2);
  const total = +(subtotal + shipping + tax).toFixed(2);

  const order = {
    id: 'ORD-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + Math.floor(1000 + Math.random() * 9000),
    userId: req.userId,
    date: new Date().toISOString().slice(0, 10),
    status: 'Confirmed',
    items,
    subtotal: +subtotal.toFixed(2),
    shipping,
    tax,
    total,
    shippingAddress: shippingAddress || db.users[req.userId]?.addresses?.[0] || {},
    paymentMethod: paymentMethod || 'Card ending in 4242',
    trackingNumber: null
  };

  db.orders.push(order);
  db.carts[req.sessionId] = [];

  res.json({ success: true, order });
});

app.get('/api/orders', (req, res) => {
  const orders = db.orders.filter(o => o.userId === req.userId);
  res.json({ orders: orders.reverse() });
});

app.get('/api/orders/:orderId', (req, res) => {
  const order = db.orders.find(o => o.id === req.params.orderId && o.userId === req.userId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json({ order });
});

// ─── USER / ACCOUNT ──────────────────────────────────────────────────
app.get('/api/user/profile', (req, res) => {
  const user = db.users[req.userId];
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

app.put('/api/user/profile', (req, res) => {
  const user = db.users[req.userId];
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { name, email, phone } = req.body;
  if (name) user.name = name;
  if (email) user.email = email;
  if (phone) user.phone = phone;
  res.json({ success: true, user });
});

app.get('/api/user/wishlist', (req, res) => {
  const user = db.users[req.userId];
  if (!user) return res.json({ wishlist: [] });
  const items = user.wishlist.map(id => db.products.find(p => p.id === id)).filter(Boolean);
  res.json({ wishlist: items });
});

app.post('/api/user/wishlist/toggle', (req, res) => {
  const user = db.users[req.userId];
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { productId } = req.body;
  const idx = user.wishlist.indexOf(productId);
  if (idx > -1) {
    user.wishlist.splice(idx, 1);
    res.json({ added: false, message: 'Removed from wishlist' });
  } else {
    user.wishlist.push(productId);
    res.json({ added: true, message: 'Added to wishlist' });
  }
});

// ─── REVIEWS ──────────────────────────────────────────────────────────
app.get('/api/products/:id/reviews', (req, res) => {
  const productReviews = db.reviews.filter(r => r.productId === parseInt(req.params.id));
  res.json({ reviews: productReviews });
});

app.post('/api/products/:id/reviews', (req, res) => {
  const { rating, title, body, author } = req.body;
  const review = {
    id: 'rev_' + Date.now(),
    productId: parseInt(req.params.id),
    userId: req.userId,
    author: author || db.users[req.userId]?.name || 'Anonymous',
    rating,
    title,
    body,
    date: new Date().toISOString(),
    verified: true
  };
  db.reviews.push(review);
  res.json({ success: true, review });
});

// ─── NEWSLETTER ──────────────────────────────────────────────────────
app.post('/api/newsletter/subscribe', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  res.json({ success: true, message: `${email} subscribed to newsletter` });
});

// ─── SEARCH SUGGESTIONS ──────────────────────────────────────────────
app.get('/api/search/suggestions', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  if (!q || q.length < 2) return res.json({ suggestions: [] });

  const matches = db.products
    .filter(p => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q))
    .slice(0, 5)
    .map(p => ({ id: p.id, name: p.name, category: p.category, price: p.price, image: p.image }));

  res.json({ suggestions: matches });
});

// ─── CATCH ALL → index.html ──────────────────────────────────────────
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  🏃 PulseSport E-Commerce Server`);
  console.log(`  ➜ Local: http://localhost:${PORT}\n`);
});