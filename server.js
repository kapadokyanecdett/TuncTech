const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const {
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual
} = require("node:crypto");
const { promisify } = require("node:util");
const database = require("./db");

const root = path.join(__dirname, "public");
const port = Number(process.env.PORT) || 3000;
const sessionLifetime = 1000 * 60 * 60 * 24 * 30;
const scryptAsync = promisify(scrypt);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(data));
}

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((part) => {
    const separator = part.indexOf("=");
    if (separator === -1) return ["", ""];
    return [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())];
  }).filter(([name]) => name));
}

function setSessionCookie(response, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader("Set-Cookie", `tunc_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`);
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function newSession(response, identity = {}) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + sessionLifetime;
  const result = database.prepare(`
    INSERT INTO sessions (token_hash, user_id, admin_id, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(tokenHash(token), identity.userId || null, identity.adminId || null, expiresAt);
  setSessionCookie(response, token);
  return database.prepare("SELECT * FROM sessions WHERE id = ?").get(Number(result.lastInsertRowid));
}

function getSession(request, response) {
  const token = parseCookies(request.headers.cookie).tunc_session;
  if (token && /^[a-f0-9]{64}$/i.test(token)) {
    const existing = database.prepare(`
      SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?
    `).get(tokenHash(token), Date.now());
    if (existing) return existing;
    database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
  }
  return newSession(response);
}

function rotateSession(request, response, oldSession, identity = {}) {
  const oldItems = database.prepare("SELECT product_id, quantity FROM cart_items WHERE session_id = ?")
    .all(oldSession.id);
  const oldFavorites = database.prepare("SELECT product_id FROM favorites WHERE session_id = ?")
    .all(oldSession.id);
  const session = newSession(response, identity);
  const insert = database.prepare(`
    INSERT INTO cart_items (session_id, product_id, quantity)
    VALUES (?, ?, ?)
    ON CONFLICT(session_id, product_id)
    DO UPDATE SET quantity = quantity + excluded.quantity
  `);
  oldItems.forEach((item) => insert.run(session.id, item.product_id, item.quantity));
  const addFavorite = database.prepare("INSERT OR IGNORE INTO favorites (session_id, product_id) VALUES (?, ?)");
  oldFavorites.forEach((favorite) => addFavorite.run(session.id, favorite.product_id));
  database.prepare("DELETE FROM sessions WHERE id = ?").run(oldSession.id);
  return session;
}

async function readBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 1024 * 1024) throw new HttpError(413, "İstek boyutu çok büyük.");
    chunks.push(chunk);
  }
  if (!length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Geçersiz JSON isteği.");
  }
}

function requireUser(session) {
  if (!session.user_id) throw new HttpError(401, "Bu işlem için üye girişi yapmalısınız.");
}

function requireAdmin(session) {
  if (!session.admin_id) throw new HttpError(401, "Yönetici girişi gerekli.");
}

function verifyPassword(password, storedHash) {
  const [saltHex, hashHex] = (storedHash || "").split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = require("node:crypto").scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, 64);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

function validEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 190;
}

function money(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10000000) {
    throw new HttpError(400, "Fiyat geçerli değil.");
  }
  return Math.round(parsed * 100);
}

function productRow(row) {
  const compareAtCents = row.compare_at_price_cents ?? null;
  const price = row.price_cents / 100;
  const compareAtPrice = compareAtCents ? compareAtCents / 100 : null;
  const discountPercent = compareAtCents && compareAtCents > row.price_cents
    ? Math.round(((compareAtCents - row.price_cents) / compareAtCents) * 100)
    : 0;
  const ratingCount = Number(row.rating_count) || 0;
  const ratingAverage = ratingCount ? Math.round((Number(row.rating_average) || 0) * 10) / 10 : 0;
  return {
    ...row,
    price,
    compare_at_price: compareAtPrice,
    discount_percent: discountPercent,
    rating_average: ratingAverage,
    rating_count: ratingCount,
    price_cents: undefined,
    compare_at_price_cents: undefined,
    active: Boolean(row.active)
  };
}

function attachImages(products) {
  if (!products.length) return products;
  const ids = products.map((product) => product.id);
  const placeholders = ids.map(() => "?").join(", ");
  const images = database.prepare(`
    SELECT product_id, url, alt FROM product_images
    WHERE product_id IN (${placeholders})
    ORDER BY sort_order, id
  `).all(...ids);
  const grouped = new Map();
  images.forEach((image) => {
    if (!grouped.has(image.product_id)) grouped.set(image.product_id, []);
    grouped.get(image.product_id).push({ url: image.url, alt: image.alt });
  });
  products.forEach((product) => {
    const list = grouped.get(product.id) || [];
    product.images = list;
    product.image = list.length ? list[0].url : "";
  });
  return products;
}

function applyCoupon(code, subtotalCents) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) throw new HttpError(400, "Lütfen bir kupon kodu gir.");
  const coupon = database.prepare("SELECT * FROM coupons WHERE code = ? COLLATE NOCASE").get(normalized);
  if (!coupon || !coupon.active) throw new HttpError(404, "Bu kupon kodu geçerli değil.");
  if (coupon.expires_at && coupon.expires_at < new Date().toISOString().slice(0, 10)) {
    throw new HttpError(400, "Bu kuponun süresi dolmuş.");
  }
  if (coupon.usage_limit > 0 && coupon.used_count >= coupon.usage_limit) {
    throw new HttpError(400, "Bu kuponun kullanım limiti dolmuş.");
  }
  if (subtotalCents < coupon.min_order_cents) {
    const minimum = (coupon.min_order_cents / 100).toLocaleString("tr-TR");
    throw new HttpError(400, `Bu kupon için sepetin en az ${minimum} TL olmalı.`);
  }
  const discountCents = coupon.discount_type === "percent"
    ? Math.round((subtotalCents * Math.min(coupon.value, 100)) / 100)
    : Math.min(coupon.value, subtotalCents);
  return { coupon, discountCents };
}

function couponSummary(coupon) {
  if (!coupon) return null;
  return {
    code: coupon.code,
    discount_type: coupon.discount_type,
    value: coupon.value,
    min_order_cents: coupon.min_order_cents
  };
}

function getCart(sessionId) {
  const items = database.prepare(`
    SELECT ci.id, ci.quantity, p.id AS product_id, p.name, p.sku, p.price_cents,
      p.stock, p.active, c.name AS category_name, c.slug AS category_slug
    FROM cart_items ci
    JOIN products p ON p.id = ci.product_id
    JOIN categories c ON c.id = p.category_id
    WHERE ci.session_id = ? AND p.active = 1
    ORDER BY ci.id DESC
  `).all(sessionId).map((item) => ({
    ...item,
    price: item.price_cents / 100,
    line_total: (item.price_cents * item.quantity) / 100
  }));
  const subtotalCents = items.reduce((sum, item) => sum + item.price_cents * item.quantity, 0);
  const sessionRow = database.prepare("SELECT coupon_code FROM sessions WHERE id = ?").get(sessionId);
  let coupon = null;
  let discountCents = 0;
  if (sessionRow?.coupon_code && items.length) {
    try {
      const applied = applyCoupon(sessionRow.coupon_code, subtotalCents);
      coupon = couponSummary(applied.coupon);
      discountCents = applied.discountCents;
    } catch {
      database.prepare("UPDATE sessions SET coupon_code = NULL WHERE id = ?").run(sessionId);
    }
  }
  return {
    items,
    count: items.reduce((sum, item) => sum + item.quantity, 0),
    total: subtotalCents / 100,
    discount: discountCents / 100,
    grand_total: (subtotalCents - discountCents) / 100,
    coupon
  };
}

function safeUser(session) {
  if (!session.user_id) return null;
  return database.prepare(`
    SELECT id, name, email, created_at FROM users
    WHERE id = ? AND deleted_at IS NULL
  `).get(session.user_id) || null;
}

function adminUser(session) {
  if (!session.admin_id) return null;
  return database.prepare("SELECT id, username FROM admins WHERE id = ?").get(session.admin_id) || null;
}

const productSorts = {
  newest: "p.created_at DESC, p.id DESC",
  oldest: "p.created_at ASC, p.id ASC",
  "price-asc": "p.price_cents ASC, p.id DESC",
  "price-desc": "p.price_cents DESC, p.id DESC",
  "discount-desc": `(CASE WHEN p.compare_at_price_cents > p.price_cents
    THEN (p.compare_at_price_cents - p.price_cents) * 1.0 / p.compare_at_price_cents ELSE 0 END) DESC, p.price_cents ASC`,
  "name-asc": "p.name ASC",
  "name-desc": "p.name DESC"
};

function productWhere({
  search = "",
  categoryId = null,
  categorySlug = "",
  includeInactive = false,
  minPrice = null,
  maxPrice = null,
  inStock = false,
  onSale = false
} = {}) {
  const clauses = [];
  const params = [];
  if (!includeInactive) clauses.push("p.active = 1 AND c.active = 1");
  if (search) {
    clauses.push("(p.name LIKE ? OR p.sku LIKE ? OR p.description LIKE ? OR c.name LIKE ?)");
    const term = `%${search}%`;
    params.push(term, term, term, term);
  }
  if (categorySlug) {
    clauses.push("c.slug = ?");
    params.push(categorySlug);
  } else if (categoryId) {
    clauses.push("p.category_id = ?");
    params.push(categoryId);
  }
  if (Number.isFinite(minPrice) && minPrice !== null) {
    clauses.push("p.price_cents >= ?");
    params.push(Math.round(minPrice * 100));
  }
  if (Number.isFinite(maxPrice) && maxPrice !== null) {
    clauses.push("p.price_cents <= ?");
    params.push(Math.round(maxPrice * 100));
  }
  if (inStock) clauses.push("p.stock > 0");
  if (onSale) clauses.push("p.compare_at_price_cents IS NOT NULL AND p.compare_at_price_cents > p.price_cents");
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

function getProducts(options = {}) {
  const { where, params } = productWhere(options);
  const orderBy = productSorts[options.sort] || productSorts.newest;
  let sql = `
    SELECT p.*, c.name AS category_name, c.slug AS category_slug,
      (SELECT AVG(r.rating) FROM reviews r WHERE r.product_id = p.id AND r.status = 'approved') AS rating_average,
      (SELECT COUNT(*) FROM reviews r WHERE r.product_id = p.id AND r.status = 'approved') AS rating_count
    FROM products p JOIN categories c ON c.id = p.category_id
    ${where}
    ORDER BY ${orderBy}
  `;
  if (Number.isInteger(options.limit)) {
    sql += " LIMIT ? OFFSET ?";
    params.push(options.limit, Math.max(0, Number(options.offset) || 0));
  }
  return attachImages(database.prepare(sql).all(...params).map(productRow));
}

function countProducts(options = {}) {
  const { where, params } = productWhere(options);
  return database.prepare(`
    SELECT COUNT(*) AS count
    FROM products p JOIN categories c ON c.id = p.category_id
    ${where}
  `).get(...params).count;
}

function activeCategories() {
  return database.prepare(`
    SELECT id, name, slug, description FROM categories
    WHERE active = 1 ORDER BY sort_order, name
  `).all();
}

function productInput(body, current = null) {
  const categoryId = Number(body.categoryId ?? current?.category_id);
  const category = database.prepare("SELECT id FROM categories WHERE id = ? AND active = 1").get(categoryId);
  if (!category) throw new HttpError(400, "Geçerli bir kategori seçin.");
  const name = String(body.name ?? current?.name ?? "").trim();
  const sku = String(body.sku ?? current?.sku ?? "").trim().toUpperCase();
  if (name.length < 2 || name.length > 160) throw new HttpError(400, "Ürün adı 2-160 karakter olmalı.");
  if (!/^[A-Z0-9_-]{3,50}$/.test(sku)) throw new HttpError(400, "Stok kodu 3-50 karakter olmalı (harf, sayı, - ve _).");
  const stock = Number(body.stock ?? current?.stock ?? 0);
  if (!Number.isInteger(stock) || stock < 0 || stock > 1000000) throw new HttpError(400, "Stok miktarı geçerli değil.");
  const priceCents = body.price === undefined && current ? current.price_cents : money(body.price);
  let compareAtCents = null;
  const rawCompare = body.compareAtPrice;
  if (rawCompare === undefined) {
    compareAtCents = current?.compare_at_price_cents ?? null;
  } else if (rawCompare !== null && String(rawCompare).trim() !== "") {
    compareAtCents = money(rawCompare);
  }
  if (compareAtCents !== null && compareAtCents <= priceCents) {
    throw new HttpError(400, "İndirim öncesi fiyat, güncel fiyattan yüksek olmalı.");
  }
  return {
    categoryId,
    sku,
    name,
    description: String(body.description ?? current?.description ?? "").trim().slice(0, 2000),
    priceCents,
    compareAtCents,
    stock,
    active: body.active === undefined ? (current?.active ?? true) : Boolean(body.active),
    badge: String(body.badge ?? current?.badge ?? "").trim().slice(0, 40)
  };
}

function categoryInput(body, current = null) {
  const name = String(body.name ?? current?.name ?? "").trim();
  let slug = String(body.slug ?? current?.slug ?? "").trim().toLowerCase();
  if (!slug && name) {
    slug = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }
  if (name.length < 2 || name.length > 100) throw new HttpError(400, "Kategori adı 2-100 karakter olmalı.");
  if (!/^[a-z0-9-]{2,100}$/.test(slug)) throw new HttpError(400, "Kategori kodu geçerli değil.");
  return {
    name,
    slug,
    description: String(body.description ?? current?.description ?? "").trim().slice(0, 500),
    sortOrder: Number.isInteger(Number(body.sortOrder)) ? Number(body.sortOrder) : (current?.sort_order || 0),
    active: body.active === undefined ? (current?.active ?? true) : Boolean(body.active)
  };
}

function couponInput(body, current = null) {
  const code = String(body.code ?? current?.code ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,24}$/.test(code)) {
    throw new HttpError(400, "Kupon kodu 3-24 karakter olmalı (harf, sayı, - ve _).");
  }
  const discountType = String(body.discountType ?? current?.discount_type ?? "percent");
  if (!["percent", "fixed"].includes(discountType)) throw new HttpError(400, "İndirim türü geçerli değil.");
  const rawValue = body.value ?? (current ? (current.discount_type === "fixed" ? current.value / 100 : current.value) : undefined);
  let value;
  if (discountType === "percent") {
    value = Number(rawValue);
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      throw new HttpError(400, "Yüzde indirim 1 ile 100 arasında olmalı.");
    }
  } else {
    value = money(rawValue);
  }
  const minOrderCents = body.minOrder === undefined || String(body.minOrder).trim() === ""
    ? (current?.min_order_cents ?? 0)
    : money(body.minOrder);
  const usageLimit = Number(body.usageLimit ?? current?.usage_limit ?? 0);
  if (!Number.isInteger(usageLimit) || usageLimit < 0) throw new HttpError(400, "Kullanım limiti geçerli değil.");
  let expiresAt = body.expiresAt === undefined ? (current?.expires_at ?? null) : String(body.expiresAt || "").trim() || null;
  if (expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) {
    throw new HttpError(400, "Bitiş tarihi YYYY-AA-GG biçiminde olmalı.");
  }
  return {
    code,
    discountType,
    value,
    minOrderCents,
    active: body.active === undefined ? (current?.active ?? true) : Boolean(body.active),
    usageLimit,
    expiresAt
  };
}

const databaseEditors = {
  categories: {
    fields: [
      { key: "name", label: "Kategori adı", type: "text", required: true, max: 100 },
      { key: "slug", label: "Kategori kodu", type: "text", required: true, hint: "küçük harf, sayı ve -" },
      { key: "description", label: "Açıklama", type: "text" },
      { key: "sort_order", label: "Sıralama", type: "int", default: 0 },
      { key: "active", label: "Mağazada yayında", type: "bool", default: true }
    ]
  },
  products: {
    fields: [
      { key: "category_id", label: "Kategori", type: "ref", ref: "categories", required: true },
      { key: "sku", label: "Stok kodu", type: "text", required: true },
      { key: "name", label: "Ürün adı", type: "text", required: true },
      { key: "description", label: "Açıklama", type: "text" },
      { key: "price", label: "Fiyat (TL)", type: "money", column: "price_cents", required: true },
      { key: "compareAtPrice", label: "İndirim öncesi fiyat (TL)", type: "money", column: "compare_at_price_cents", hint: "boş bırakılırsa indirim yok" },
      { key: "stock", label: "Stok adedi", type: "int", default: 0 },
      { key: "active", label: "Mağazada yayında", type: "bool", default: true },
      { key: "badge", label: "Ürün etiketi", type: "text", max: 40 }
    ]
  },
  customers: {
    table: "users",
    deleteKind: "anonymize",
    fields: [
      { key: "name", label: "Ad soyad", type: "text", required: true, max: 100 },
      { key: "email", label: "E-posta", type: "email", required: true },
      { key: "password", label: "Şifre", type: "password", column: "password_hash", required: true, hint: "en az 8 karakter" }
    ]
  },
  admins: {
    fields: [
      { key: "username", label: "Kullanıcı adı", type: "text", required: true },
      { key: "password", label: "Şifre", type: "password", column: "password_hash", required: true, hint: "en az 8 karakter" }
    ]
  },
  sessions: {
    fields: [
      { key: "token_hash", label: "Token (hash)", type: "text", required: true },
      { key: "user_id", label: "Müşteri", type: "ref", ref: "users" },
      { key: "admin_id", label: "Yönetici", type: "ref", ref: "admins" },
      { key: "expires_at", label: "Bitiş (epoch ms)", type: "int", required: true, hint: "ör. 1790000000000" }
    ]
  },
  cart_items: {
    fields: [
      { key: "session_id", label: "Oturum", type: "ref", ref: "sessions", required: true },
      { key: "product_id", label: "Ürün", type: "ref", ref: "products", required: true },
      { key: "quantity", label: "Adet", type: "int", required: true, default: 1 }
    ]
  },
  favorites: {
    fields: [
      { key: "session_id", label: "Oturum", type: "ref", ref: "sessions", required: true },
      { key: "product_id", label: "Ürün", type: "ref", ref: "products", required: true }
    ]
  },
  orders: {
    fields: [
      { key: "order_number", label: "Sipariş no", type: "text", required: true },
      { key: "user_id", label: "Müşteri", type: "ref", ref: "users", required: true },
      { key: "status", label: "Durum", type: "select", options: ["new", "processing", "shipped", "completed", "cancelled"], default: "new" },
      { key: "total", label: "Tutar (TL)", type: "money", column: "total_cents", required: true },
      { key: "recipient_name", label: "Alıcı", type: "text", required: true },
      { key: "phone", label: "Telefon", type: "text", required: true },
      { key: "address", label: "Adres", type: "text", required: true },
      { key: "city", label: "İl", type: "text", required: true }
    ]
  },
  order_items: {
    fields: [
      { key: "order_id", label: "Sipariş", type: "ref", ref: "orders", required: true },
      { key: "product_id", label: "Ürün", type: "ref", ref: "products" },
      { key: "product_name", label: "Ürün adı", type: "text", required: true },
      { key: "sku", label: "Stok kodu", type: "text", required: true },
      { key: "unit_price", label: "Birim fiyat (TL)", type: "money", column: "unit_price_cents", required: true },
      { key: "quantity", label: "Adet", type: "int", required: true, default: 1 }
    ]
  },
  messages: {
    fields: [
      { key: "name", label: "Ad", type: "text", required: true },
      { key: "email", label: "E-posta", type: "email", required: true },
      { key: "body", label: "Mesaj", type: "text", required: true }
    ]
  },
  reviews: {
    fields: [
      { key: "product_id", label: "Ürün", type: "ref", ref: "products", required: true },
      { key: "author_name", label: "Yazar", type: "text", required: true, max: 100 },
      { key: "rating", label: "Puan (1-5)", type: "int", required: true },
      { key: "body", label: "Yorum", type: "text" },
      { key: "status", label: "Durum", type: "select", options: ["pending", "approved", "rejected"], default: "pending" }
    ]
  },
  product_images: {
    fields: [
      { key: "product_id", label: "Ürün", type: "ref", ref: "products", required: true },
      { key: "url", label: "Görsel adresi (URL)", type: "text", required: true },
      { key: "alt", label: "Alternatif metin", type: "text" },
      { key: "sort_order", label: "Sıra", type: "int", default: 0 }
    ]
  },
  settings: {
    primaryKey: "key",
    fields: [
      { key: "key", label: "Anahtar", type: "text", required: true },
      { key: "value", label: "Değer", type: "text", required: true }
    ]
  }
};

function referenceOptions(ref) {
  if (ref === "categories") {
    return database.prepare("SELECT id AS value, name AS label FROM categories ORDER BY name").all();
  }
  if (ref === "users") {
    return database.prepare(`
      SELECT u.id AS value,
        CASE WHEN u.deleted_at IS NULL THEN u.name || ' · ' || u.email ELSE 'Silinmiş hesap #' || u.id END AS label
      FROM users u ORDER BY u.id
    `).all();
  }
  if (ref === "admins") {
    return database.prepare("SELECT id AS value, username AS label FROM admins ORDER BY id").all();
  }
  if (ref === "products") {
    return database.prepare("SELECT id AS value, sku || ' — ' || name AS label FROM products ORDER BY id").all();
  }
  if (ref === "orders") {
    return database.prepare("SELECT id AS value, order_number AS label FROM orders ORDER BY id").all();
  }
  if (ref === "sessions") {
    return database.prepare("SELECT id AS value, '#' || id AS label FROM sessions ORDER BY id DESC LIMIT 200").all();
  }
  return [];
}

function constraintError(error) {
  if (error instanceof HttpError) return error;
  const text = `${error?.code || ""} ${error?.message || ""}`.toUpperCase();
  if (text.includes("UNIQUE")) return new HttpError(409, "Bu kayıt zaten mevcut; benzersiz bir alan çakıştı.");
  if (text.includes("NOT NULL") || text.includes("NOTNULL")) return new HttpError(400, "Zorunlu bir alan boş bırakılamaz.");
  if (text.includes("FOREIGN KEY") || text.includes("FOREIGNKEY")) return new HttpError(409, "İlişkili kayıt bulunamadı veya bu kayıt başka kayıtlarca kullanılıyor.");
  if (text.includes("CHECK")) return new HttpError(400, "Girilen değerler doğrulama kuralını ihlal etti.");
  return error;
}

async function insertDatabaseRow(tableKey, body) {
  const spec = databaseEditors[tableKey];
  if (!spec) throw new HttpError(404, "Tablo bulunamadı.");
  const columns = [];
  const values = [];
  for (const field of spec.fields) {
    const column = field.column || field.key;
    const raw = body[field.key];
    const empty = raw === undefined || raw === null || String(raw).trim() === "";
    if (field.type === "bool") {
      const value = empty ? Boolean(field.default) : Boolean(raw);
      columns.push(column);
      values.push(value ? 1 : 0);
      continue;
    }
    if (empty) {
      if (field.required) throw new HttpError(400, `${field.label} alanı zorunlu.`);
      if (field.type === "ref") { columns.push(column); values.push(null); continue; }
      if (field.type === "int" || field.type === "money") {
        columns.push(column);
        values.push(field.default === undefined ? null : Number(field.default));
        continue;
      }
      columns.push(column);
      values.push(field.default === undefined ? "" : field.default);
      continue;
    }
    if (field.type === "int") {
      const value = Number(raw);
      if (!Number.isInteger(value)) throw new HttpError(400, `${field.label} tam sayı olmalı.`);
      columns.push(column); values.push(value); continue;
    }
    if (field.type === "money") {
      columns.push(column); values.push(money(raw)); continue;
    }
    if (field.type === "ref") {
      const value = Number(raw);
      if (!Number.isInteger(value)) throw new HttpError(400, `${field.label} seçimi geçersiz.`);
      columns.push(column); values.push(value); continue;
    }
    if (field.type === "email") {
      const value = String(raw).trim().toLowerCase();
      if (!validEmail(value)) throw new HttpError(400, `${field.label} geçerli bir e-posta olmalı.`);
      columns.push(column); values.push(value); continue;
    }
    if (field.type === "password") {
      const value = String(raw);
      if (value.length < 8 || value.length > 128) throw new HttpError(400, `${field.label} en az 8 karakter olmalı.`);
      columns.push(column); values.push(await hashPassword(value)); continue;
    }
    if (field.type === "select") {
      const value = String(raw);
      if (field.options && !field.options.includes(value)) throw new HttpError(400, `${field.label} geçersiz.`);
      columns.push(column); values.push(value); continue;
    }
    let value = String(raw).trim();
    const max = field.max || 2000;
    if (value.length > max) value = value.slice(0, max);
    columns.push(column); values.push(value);
  }
  if (!columns.length) throw new HttpError(400, "Eklenecek alan bulunamadı.");
  return database.prepare(
    `INSERT INTO ${spec.table || tableKey} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
  ).run(...values);
}

async function anonymizeCustomer(customerId) {
  const current = database.prepare("SELECT id FROM users WHERE id = ? AND deleted_at IS NULL").get(customerId);
  if (!current) throw new HttpError(404, "Müşteri hesabı bulunamadı.");
  const erasedPasswordHash = await hashPassword(randomBytes(48).toString("hex"));
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("DELETE FROM sessions WHERE user_id = ?").run(customerId);
    database.prepare(`
      UPDATE users
      SET name = 'Silinmiş hesap', email = ?, password_hash = ?, deleted_at = CURRENT_TIMESTAMP
      WHERE id = ? AND deleted_at IS NULL
    `).run(`silinmis-hesap-${customerId}@deleted.invalid`, erasedPasswordHash, customerId);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

async function deleteDatabaseRow(tableKey, primaryValue) {
  const spec = databaseEditors[tableKey];
  if (!spec) throw new HttpError(404, "Tablo bulunamadı.");
  if (spec.deleteKind === "anonymize") {
    const customerId = Number(primaryValue);
    if (!Number.isInteger(customerId)) throw new HttpError(400, "Kayıt kimliği geçersiz.");
    await anonymizeCustomer(customerId);
    return;
  }
  const primaryKey = spec.primaryKey || "id";
  const key = primaryKey === "id" ? Number(primaryValue) : primaryValue;
  const result = database.prepare(`DELETE FROM ${spec.table || tableKey} WHERE ${primaryKey} = ?`).run(key);
  if (!result.changes) throw new HttpError(404, "Kayıt bulunamadı.");
}

async function api(request, response, url) {
  const method = request.method || "GET";
  const pathname = url.pathname;
  const session = getSession(request, response);
  const body = ["POST", "PUT", "PATCH", "DELETE"].includes(method) ? await readBody(request) : {};

  if (method === "GET" && pathname === "/api/session") {
    return sendJson(response, 200, {
      user: safeUser(session),
      admin: adminUser(session),
      cart: getCart(session.id),
      favorites: database.prepare("SELECT product_id FROM favorites WHERE session_id = ?")
        .all(session.id).map((favorite) => favorite.product_id)
    });
  }

  if (method === "GET" && pathname === "/api/catalog") {
    const products = getProducts({ search: url.searchParams.get("q") || "" });
    return sendJson(response, 200, { categories: activeCategories(), products });
  }

  if (method === "GET" && pathname === "/api/products") {
    const query = url.searchParams;
    const number = (key) => {
      const raw = query.get(key);
      if (raw === null || raw.trim() === "") return null;
      const value = Number(raw);
      return Number.isFinite(value) && value >= 0 ? value : null;
    };
    const page = Math.max(1, Math.floor(Number(query.get("sayfa")) || 1));
    const pageSize = Math.min(48, Math.max(6, Math.floor(Number(query.get("limit")) || 12)));
    const filters = {
      search: (query.get("q") || "").trim(),
      categorySlug: (query.get("kategori") || "").trim(),
      minPrice: number("minFiyat"),
      maxPrice: number("maxFiyat"),
      inStock: query.get("stokta") === "1",
      onSale: query.get("indirim") === "1",
      sort: query.get("siralama") || "newest"
    };
    const total = countProducts(filters);
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, pages);
    const products = getProducts({ ...filters, limit: pageSize, offset: (safePage - 1) * pageSize });
    return sendJson(response, 200, {
      products,
      categories: activeCategories(),
      total,
      page: safePage,
      pageSize,
      pages
    });
  }

  const reviewMatch = pathname.match(/^\/api\/products\/(\d+)\/reviews$/);
  if (reviewMatch && method === "GET") {
    const productId = Number(reviewMatch[1]);
    const product = database.prepare("SELECT id FROM products WHERE id = ? AND active = 1").get(productId);
    if (!product) throw new HttpError(404, "Ürün bulunamadı.");
    const viewerId = session.user_id || -1;
    const reviews = database.prepare(`
      SELECT id, author_name, rating, body, status, created_at,
        CASE WHEN user_id = ? THEN 1 ELSE 0 END AS is_mine
      FROM reviews
      WHERE product_id = ? AND (status = 'approved' OR user_id = ?)
      ORDER BY created_at DESC LIMIT 50
    `).all(viewerId, productId, viewerId).map((review) => ({ ...review, is_mine: Boolean(review.is_mine) }));
    const summary = database.prepare(`
      SELECT COUNT(*) AS count, COALESCE(AVG(rating), 0) AS average
      FROM reviews WHERE product_id = ? AND status = 'approved'
    `).get(productId);
    const mine = session.user_id
      ? database.prepare("SELECT id, rating, body, status FROM reviews WHERE product_id = ? AND user_id = ?")
        .get(productId, session.user_id) || null
      : null;
    return sendJson(response, 200, {
      reviews,
      average: summary.count ? Math.round(summary.average * 10) / 10 : 0,
      count: summary.count,
      canReview: Boolean(session.user_id),
      mine
    });
  }

  if (reviewMatch && method === "POST") {
    requireUser(session);
    const productId = Number(reviewMatch[1]);
    const product = database.prepare("SELECT id, name FROM products WHERE id = ? AND active = 1").get(productId);
    if (!product) throw new HttpError(404, "Ürün bulunamadı.");
    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new HttpError(400, "Puan 1 ile 5 yıldız arasında olmalı.");
    }
    const text = String(body.body || "").trim().slice(0, 1000);
    const user = safeUser(session);
    const existing = database.prepare("SELECT id FROM reviews WHERE product_id = ? AND user_id = ?")
      .get(productId, session.user_id);
    if (existing) {
      database.prepare(`
        UPDATE reviews SET rating = ?, body = ?, status = 'pending', created_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(rating, text, existing.id);
    } else {
      database.prepare(`
        INSERT INTO reviews (product_id, user_id, author_name, rating, body)
        VALUES (?, ?, ?, ?, ?)
      `).run(productId, session.user_id, user?.name || "Müşteri", rating, text);
    }
    return sendJson(response, 201, { ok: true, pending: true });
  }

  if (method === "POST" && pathname === "/api/auth/register") {
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (name.length < 2 || name.length > 100) throw new HttpError(400, "Ad soyad 2-100 karakter olmalı.");
    if (!validEmail(email)) throw new HttpError(400, "Geçerli bir e-posta adresi girin.");
    if (password.length < 8 || password.length > 128) throw new HttpError(400, "Şifre en az 8 karakter olmalı.");
    if (database.prepare("SELECT id FROM users WHERE email = ? AND deleted_at IS NULL").get(email)) {
      throw new HttpError(409, "Bu e-posta adresi zaten kayıtlı.");
    }
    const result = database.prepare("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)")
      .run(name, email, await hashPassword(password));
    const rotated = rotateSession(request, response, session, { userId: Number(result.lastInsertRowid) });
    return sendJson(response, 201, { user: safeUser(rotated), cart: getCart(rotated.id) });
  }

  if (method === "POST" && pathname === "/api/auth/login") {
    const email = String(body.email || "").trim().toLowerCase();
    const user = database.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user || user.deleted_at || !verifyPassword(String(body.password || ""), user.password_hash)) {
      throw new HttpError(401, "E-posta veya şifre hatalı.");
    }
    const rotated = rotateSession(request, response, session, { userId: user.id });
    return sendJson(response, 200, { user: safeUser(rotated), cart: getCart(rotated.id) });
  }

  if (method === "POST" && pathname === "/api/admin/login") {
    const username = String(body.username || "").trim();
    const admin = database.prepare("SELECT * FROM admins WHERE username = ? COLLATE NOCASE").get(username);
    if (!admin || !verifyPassword(String(body.password || ""), admin.password_hash)) {
      throw new HttpError(401, "Yönetici adı veya şifre hatalı.");
    }
    const rotated = rotateSession(request, response, session, { adminId: admin.id });
    return sendJson(response, 200, { admin: adminUser(rotated) });
  }

  if (method === "POST" && pathname === "/api/auth/logout") {
    const rotated = rotateSession(request, response, session);
    return sendJson(response, 200, { ok: true, user: safeUser(rotated), admin: adminUser(rotated) });
  }

  if (method === "GET" && pathname === "/api/cart") {
    return sendJson(response, 200, getCart(session.id));
  }

  if (method === "POST" && pathname === "/api/cart/coupon") {
    const cart = getCart(session.id);
    if (!cart.items.length) throw new HttpError(400, "Kupon uygulamak için sepetinde ürün olmalı.");
    const { coupon } = applyCoupon(body.code, Math.round(cart.total * 100));
    database.prepare("UPDATE sessions SET coupon_code = ? WHERE id = ?").run(coupon.code, session.id);
    return sendJson(response, 200, getCart(session.id));
  }

  if (method === "DELETE" && pathname === "/api/cart/coupon") {
    database.prepare("UPDATE sessions SET coupon_code = NULL WHERE id = ?").run(session.id);
    return sendJson(response, 200, getCart(session.id));
  }

  if (method === "POST" && pathname === "/api/favorites") {
    const productId = Number(body.productId);
    if (!Number.isInteger(productId)) throw new HttpError(400, "Ürün seçimi geçerli değil.");
    const product = database.prepare("SELECT id FROM products WHERE id = ? AND active = 1").get(productId);
    if (!product) throw new HttpError(404, "Ürün bulunamadı.");
    const existing = database.prepare("SELECT id FROM favorites WHERE session_id = ? AND product_id = ?")
      .get(session.id, productId);
    if (existing) {
      database.prepare("DELETE FROM favorites WHERE id = ?").run(existing.id);
      return sendJson(response, 200, { active: false });
    }
    database.prepare("INSERT INTO favorites (session_id, product_id) VALUES (?, ?)")
      .run(session.id, productId);
    return sendJson(response, 200, { active: true });
  }

  if (method === "POST" && pathname === "/api/cart/items") {
    const productId = Number(body.productId);
    const quantity = Number(body.quantity ?? 1);
    if (!Number.isInteger(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new HttpError(400, "Ürün veya adet geçerli değil.");
    }
    const product = database.prepare("SELECT id, stock FROM products WHERE id = ? AND active = 1")
      .get(productId);
    if (!product) throw new HttpError(404, "Ürün bulunamadı.");
    const existing = database.prepare("SELECT quantity FROM cart_items WHERE session_id = ? AND product_id = ?")
      .get(session.id, productId);
    if (existing && existing.quantity + quantity > product.stock) throw new HttpError(409, "Stokta istenen miktar yok.");
    if (!existing && quantity > product.stock) throw new HttpError(409, "Stokta istenen miktar yok.");
    database.prepare(`
      INSERT INTO cart_items (session_id, product_id, quantity) VALUES (?, ?, ?)
      ON CONFLICT(session_id, product_id) DO UPDATE SET quantity = quantity + excluded.quantity
    `).run(session.id, productId, quantity);
    return sendJson(response, 200, getCart(session.id));
  }

  const cartItemMatch = pathname.match(/^\/api\/cart\/items\/(\d+)$/);
  if (cartItemMatch && method === "PATCH") {
    const quantity = Number(body.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new HttpError(400, "Adet 1-99 arasında olmalı.");
    const item = database.prepare(`
      SELECT ci.id, p.stock FROM cart_items ci JOIN products p ON p.id = ci.product_id
      WHERE ci.id = ? AND ci.session_id = ?
    `).get(Number(cartItemMatch[1]), session.id);
    if (!item) throw new HttpError(404, "Sepet ürünü bulunamadı.");
    if (quantity > item.stock) throw new HttpError(409, "Stokta istenen miktar yok.");
    database.prepare("UPDATE cart_items SET quantity = ? WHERE id = ? AND session_id = ?")
      .run(quantity, item.id, session.id);
    return sendJson(response, 200, getCart(session.id));
  }

  if (cartItemMatch && method === "DELETE") {
    database.prepare("DELETE FROM cart_items WHERE id = ? AND session_id = ?")
      .run(Number(cartItemMatch[1]), session.id);
    return sendJson(response, 200, getCart(session.id));
  }

  if (method === "POST" && pathname === "/api/orders") {
    requireUser(session);
    const recipientName = String(body.recipientName || "").trim();
    const phone = String(body.phone || "").trim();
    const address = String(body.address || "").trim();
    const city = String(body.city || "").trim();
    if (recipientName.length < 2 || phone.length < 7 || address.length < 8 || city.length < 2) {
      throw new HttpError(400, "Teslimat bilgilerini eksiksiz doldurun.");
    }
    const cart = getCart(session.id);
    if (!cart.items.length) throw new HttpError(400, "Sepetiniz boş.");
    const discountCents = Math.round((cart.discount || 0) * 100);
    const couponCode = cart.coupon?.code || "";
    const orderNumber = `TN-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString("hex").toUpperCase()}`;
    database.exec("BEGIN IMMEDIATE");
    try {
      for (const item of cart.items) {
        const current = database.prepare("SELECT stock, active FROM products WHERE id = ?").get(item.product_id);
        if (!current?.active || current.stock < item.quantity) {
          throw new HttpError(409, `${item.name} için stok yeterli değil.`);
        }
      }
      const order = database.prepare(`
        INSERT INTO orders (order_number, user_id, total_cents, discount_cents, coupon_code, recipient_name, phone, address, city)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(orderNumber, session.user_id, Math.round(cart.grand_total * 100), discountCents, couponCode, recipientName, phone, address, city);
      const orderId = Number(order.lastInsertRowid);
      const addItem = database.prepare(`
        INSERT INTO order_items (order_id, product_id, product_name, sku, unit_price_cents, quantity)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const reduceStock = database.prepare("UPDATE products SET stock = stock - ? WHERE id = ?");
      cart.items.forEach((item) => {
        addItem.run(orderId, item.product_id, item.name, item.sku, item.price_cents, item.quantity);
        reduceStock.run(item.quantity, item.product_id);
      });
      if (couponCode) {
        database.prepare("UPDATE coupons SET used_count = used_count + 1 WHERE code = ? COLLATE NOCASE").run(couponCode);
      }
      database.prepare("DELETE FROM cart_items WHERE session_id = ?").run(session.id);
      database.prepare("UPDATE sessions SET coupon_code = NULL WHERE id = ?").run(session.id);
      database.exec("COMMIT");
      return sendJson(response, 201, { orderNumber, total: cart.grand_total, discount: cart.discount, coupon: couponCode });
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  if (method === "GET" && pathname === "/api/orders") {
    requireUser(session);
    const orders = database.prepare(`
      SELECT o.*, (
        SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id
      ) AS item_count
      FROM orders o WHERE o.user_id = ? ORDER BY o.created_at DESC
    `).all(session.user_id).map((order) => ({
      ...order,
      total: order.total_cents / 100,
      discount: (order.discount_cents || 0) / 100
    }));
    return sendJson(response, 200, { orders });
  }

  if (method === "POST" && pathname === "/api/messages") {
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const message = String(body.body || "").trim();
    if (name.length < 2 || name.length > 100) throw new HttpError(400, "Ad soyad 2-100 karakter olmalı.");
    if (!validEmail(email)) throw new HttpError(400, "Geçerli bir e-posta adresi girin.");
    if (message.length < 10 || message.length > 2000) throw new HttpError(400, "Mesajınız 10-2000 karakter olmalı.");
    database.prepare("INSERT INTO messages (name, email, body) VALUES (?, ?, ?)").run(name, email, message);
    return sendJson(response, 201, { ok: true });
  }

  if (pathname.startsWith("/api/admin/")) requireAdmin(session);

  if (method === "GET" && pathname === "/api/admin/summary") {
    const stats = {
      products: database.prepare("SELECT COUNT(*) AS count FROM products WHERE active = 1").get().count,
      categories: database.prepare("SELECT COUNT(*) AS count FROM categories WHERE active = 1").get().count,
      customers: database.prepare("SELECT COUNT(*) AS count FROM users WHERE deleted_at IS NULL").get().count,
      orders: database.prepare("SELECT COUNT(*) AS count FROM orders").get().count,
      pendingReviews: database.prepare("SELECT COUNT(*) AS count FROM reviews WHERE status = 'pending'").get().count,
      revenue: database.prepare("SELECT COALESCE(SUM(total_cents), 0) AS cents FROM orders WHERE status != 'cancelled'").get().cents / 100
    };
    return sendJson(response, 200, { stats });
  }

  if (method === "GET" && pathname === "/api/admin/reviews") {
    const reviews = database.prepare(`
      SELECT r.id, r.rating, r.body, r.status, r.created_at, r.author_name,
        p.id AS product_id, p.name AS product_name, p.sku
      FROM reviews r JOIN products p ON p.id = r.product_id
      ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC
    `).all();
    const pending = reviews.filter((review) => review.status === "pending").length;
    return sendJson(response, 200, { reviews, pending });
  }

  const adminReviewMatch = pathname.match(/^\/api\/admin\/reviews\/(\d+)$/);
  if (adminReviewMatch && method === "PATCH") {
    const allowed = ["pending", "approved", "rejected"];
    if (!allowed.includes(body.status)) throw new HttpError(400, "Yorum durumu geçerli değil.");
    const result = database.prepare("UPDATE reviews SET status = ? WHERE id = ?")
      .run(body.status, Number(adminReviewMatch[1]));
    if (!result.changes) throw new HttpError(404, "Yorum bulunamadı.");
    return sendJson(response, 200, { ok: true });
  }
  if (adminReviewMatch && method === "DELETE") {
    const result = database.prepare("DELETE FROM reviews WHERE id = ?").run(Number(adminReviewMatch[1]));
    if (!result.changes) throw new HttpError(404, "Yorum bulunamadı.");
    return sendJson(response, 200, { ok: true });
  }

  if (method === "GET" && pathname === "/api/admin/coupons") {
    const coupons = database.prepare(`
      SELECT id, code, discount_type, value, min_order_cents, active, usage_limit, used_count, expires_at, created_at
      FROM coupons ORDER BY active DESC, created_at DESC
    `).all().map((coupon) => ({
      ...coupon,
      active: Boolean(coupon.active),
      display_value: coupon.discount_type === "percent" ? coupon.value : coupon.value / 100,
      min_order: coupon.min_order_cents / 100
    }));
    return sendJson(response, 200, { coupons });
  }

  if (method === "POST" && pathname === "/api/admin/coupons") {
    const input = couponInput(body);
    try {
      const result = database.prepare(`
        INSERT INTO coupons (code, discount_type, value, min_order_cents, active, usage_limit, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(input.code, input.discountType, input.value, input.minOrderCents, Number(input.active), input.usageLimit, input.expiresAt);
      return sendJson(response, 201, { id: Number(result.lastInsertRowid) });
    } catch (error) {
      if (error.code === "ERR_SQLITE_CONSTRAINT_UNIQUE") throw new HttpError(409, "Bu kupon kodu zaten kayıtlı.");
      throw error;
    }
  }

  const couponMatch = pathname.match(/^\/api\/admin\/coupons\/(\d+)$/);
  if (couponMatch && method === "PATCH") {
    const current = database.prepare("SELECT * FROM coupons WHERE id = ?").get(Number(couponMatch[1]));
    if (!current) throw new HttpError(404, "Kupon bulunamadı.");
    const input = couponInput(body, current);
    try {
      database.prepare(`
        UPDATE coupons SET code = ?, discount_type = ?, value = ?, min_order_cents = ?,
          active = ?, usage_limit = ?, expires_at = ? WHERE id = ?
      `).run(input.code, input.discountType, input.value, input.minOrderCents, Number(input.active), input.usageLimit, input.expiresAt, current.id);
    } catch (error) {
      if (error.code === "ERR_SQLITE_CONSTRAINT_UNIQUE") throw new HttpError(409, "Bu kupon kodu zaten kayıtlı.");
      throw error;
    }
    return sendJson(response, 200, { ok: true });
  }
  if (couponMatch && method === "DELETE") {
    const result = database.prepare("DELETE FROM coupons WHERE id = ?").run(Number(couponMatch[1]));
    if (!result.changes) throw new HttpError(404, "Kupon bulunamadı.");
    return sendJson(response, 200, { ok: true });
  }

  if (method === "GET" && pathname === "/api/admin/products") {
    return sendJson(response, 200, { products: getProducts({ includeInactive: true }) });
  }

  if (method === "POST" && pathname === "/api/admin/products") {
    const input = productInput(body);
    try {
      const result = database.prepare(`
        INSERT INTO products (category_id, sku, name, description, price_cents, compare_at_price_cents, stock, active, badge)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(input.categoryId, input.sku, input.name, input.description, input.priceCents, input.compareAtCents, input.stock, Number(input.active), input.badge);
      return sendJson(response, 201, { id: Number(result.lastInsertRowid) });
    } catch (error) {
      if (error.code === "ERR_SQLITE_CONSTRAINT_UNIQUE") throw new HttpError(409, "Bu stok kodu zaten kayıtlı.");
      throw error;
    }
  }

  const productMatch = pathname.match(/^\/api\/admin\/products\/(\d+)$/);
  if (productMatch && method === "PATCH") {
    const current = database.prepare("SELECT * FROM products WHERE id = ?").get(Number(productMatch[1]));
    if (!current) throw new HttpError(404, "Ürün bulunamadı.");
    const input = productInput(body, current);
    try {
      database.prepare(`
        UPDATE products SET category_id = ?, sku = ?, name = ?, description = ?, price_cents = ?,
          compare_at_price_cents = ?, stock = ?, active = ?, badge = ? WHERE id = ?
      `).run(input.categoryId, input.sku, input.name, input.description, input.priceCents, input.compareAtCents, input.stock, Number(input.active), input.badge, current.id);
    } catch (error) {
      if (error.code === "ERR_SQLITE_CONSTRAINT_UNIQUE") throw new HttpError(409, "Bu stok kodu zaten kayıtlı.");
      throw error;
    }
    return sendJson(response, 200, { ok: true });
  }
  if (productMatch && method === "DELETE") {
    const result = database.prepare("DELETE FROM products WHERE id = ?").run(Number(productMatch[1]));
    if (!result.changes) throw new HttpError(404, "Ürün bulunamadı.");
    return sendJson(response, 200, { ok: true });
  }

  if (method === "GET" && pathname === "/api/admin/categories") {
    const categories = database.prepare(`
      SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
      FROM categories c ORDER BY c.sort_order, c.name
    `).all().map((category) => ({ ...category, active: Boolean(category.active) }));
    return sendJson(response, 200, { categories });
  }

  if (method === "POST" && pathname === "/api/admin/categories") {
    const input = categoryInput(body);
    try {
      const result = database.prepare(`
        INSERT INTO categories (name, slug, description, sort_order, active)
        VALUES (?, ?, ?, ?, ?)
      `).run(input.name, input.slug, input.description, input.sortOrder, Number(input.active));
      return sendJson(response, 201, { id: Number(result.lastInsertRowid) });
    } catch (error) {
      if (error.code === "ERR_SQLITE_CONSTRAINT_UNIQUE") throw new HttpError(409, "Bu kategori kodu kullanılıyor.");
      throw error;
    }
  }

  const categoryMatch = pathname.match(/^\/api\/admin\/categories\/(\d+)$/);
  if (categoryMatch && method === "PATCH") {
    const current = database.prepare("SELECT * FROM categories WHERE id = ?").get(Number(categoryMatch[1]));
    if (!current) throw new HttpError(404, "Kategori bulunamadı.");
    const input = categoryInput(body, current);
    try {
      database.prepare(`
        UPDATE categories SET name = ?, slug = ?, description = ?, sort_order = ?, active = ?
        WHERE id = ?
      `).run(input.name, input.slug, input.description, input.sortOrder, Number(input.active), current.id);
    } catch (error) {
      if (error.code === "ERR_SQLITE_CONSTRAINT_UNIQUE") throw new HttpError(409, "Bu kategori kodu kullanılıyor.");
      throw error;
    }
    return sendJson(response, 200, { ok: true });
  }
  if (categoryMatch && method === "DELETE") {
    try {
      const result = database.prepare("DELETE FROM categories WHERE id = ?").run(Number(categoryMatch[1]));
      if (!result.changes) throw new HttpError(404, "Kategori bulunamadı.");
      return sendJson(response, 200, { ok: true });
    } catch (error) {
      if (error.code === "ERR_SQLITE_CONSTRAINT_FOREIGNKEY") {
        throw new HttpError(409, "Bu kategoride ürün var. Önce ürünleri başka kategoriye taşıyın.");
      }
      throw error;
    }
  }

  if (method === "GET" && pathname === "/api/admin/orders") {
    const orders = database.prepare(`
      SELECT o.*,
        CASE WHEN u.deleted_at IS NULL THEN u.name ELSE 'Silinmiş hesap' END AS customer_name,
        CASE WHEN u.deleted_at IS NULL THEN u.email ELSE '' END AS customer_email,
        (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
      FROM orders o JOIN users u ON u.id = o.user_id
      ORDER BY o.created_at DESC LIMIT 200
    `).all().map((order) => ({ ...order, total: order.total_cents / 100 }));
    return sendJson(response, 200, { orders });
  }

  const orderMatch = pathname.match(/^\/api\/admin\/orders\/(\d+)$/);
  if (orderMatch && method === "PATCH") {
    const allowed = ["new", "processing", "shipped", "completed", "cancelled"];
    if (!allowed.includes(body.status)) throw new HttpError(400, "Sipariş durumu geçerli değil.");
    const orderId = Number(orderMatch[1]);
    const current = database.prepare("SELECT id, status FROM orders WHERE id = ?").get(orderId);
    if (!current) throw new HttpError(404, "Sipariş bulunamadı.");
    if (current.status !== body.status) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const items = database.prepare("SELECT product_id, quantity FROM order_items WHERE order_id = ?")
          .all(orderId).filter((item) => item.product_id);
        if (body.status === "cancelled" && current.status !== "cancelled") {
          const restore = database.prepare("UPDATE products SET stock = stock + ? WHERE id = ?");
          items.forEach((item) => restore.run(item.quantity, item.product_id));
        } else if (current.status === "cancelled" && body.status !== "cancelled") {
          for (const item of items) {
            const product = database.prepare("SELECT stock FROM products WHERE id = ?").get(item.product_id);
            if (!product || product.stock < item.quantity) {
              throw new HttpError(409, "Sipariş yeniden açılırken ürün stoğu yetersiz.");
            }
          }
          const reserve = database.prepare("UPDATE products SET stock = stock - ? WHERE id = ?");
          items.forEach((item) => reserve.run(item.quantity, item.product_id));
        }
        database.prepare("UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .run(body.status, orderId);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    }
    return sendJson(response, 200, { ok: true });
  }

  if (method === "GET" && pathname === "/api/admin/customers") {
    const customers = database.prepare(`
      SELECT u.id, u.name, u.email, u.created_at, COUNT(o.id) AS order_count,
        COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.total_cents ELSE 0 END), 0) AS total_cents
      FROM users u LEFT JOIN orders o ON o.user_id = u.id
      WHERE u.deleted_at IS NULL
      GROUP BY u.id ORDER BY u.created_at DESC
    `).all().map((customer) => ({ ...customer, total: customer.total_cents / 100 }));
    return sendJson(response, 200, { customers });
  }

  const customerMatch = pathname.match(/^\/api\/admin\/customers\/(\d+)$/);
  if (customerMatch && method === "PATCH") {
    const customerId = Number(customerMatch[1]);
    const current = database.prepare("SELECT id FROM users WHERE id = ? AND deleted_at IS NULL").get(customerId);
    if (!current) throw new HttpError(404, "Müşteri hesabı bulunamadı.");
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (name.length < 2 || name.length > 100) throw new HttpError(400, "Ad soyad 2-100 karakter olmalı.");
    if (!validEmail(email)) throw new HttpError(400, "Geçerli bir e-posta adresi girin.");
    if (password && (password.length < 8 || password.length > 128)) {
      throw new HttpError(400, "Yeni şifre en az 8 karakter olmalı.");
    }
    try {
      if (password) {
        database.prepare(`
          UPDATE users SET name = ?, email = ?, password_hash = ?
          WHERE id = ? AND deleted_at IS NULL
        `).run(name, email, await hashPassword(password), customerId);
      } else {
        database.prepare(`
          UPDATE users SET name = ?, email = ?
          WHERE id = ? AND deleted_at IS NULL
        `).run(name, email, customerId);
      }
    } catch (error) {
      if (error.code === "ERR_SQLITE_CONSTRAINT_UNIQUE") {
        throw new HttpError(409, "Bu e-posta adresi başka bir hesapta kullanılıyor.");
      }
      throw error;
    }
    return sendJson(response, 200, { ok: true });
  }

  if (customerMatch && method === "DELETE") {
    await anonymizeCustomer(Number(customerMatch[1]));
    return sendJson(response, 200, { ok: true, ordersPreserved: true });
  }

  if (method === "GET" && pathname === "/api/admin/database") {
    const tables = {
      categories: {
        label: "Kategoriler",
        rows: database.prepare("SELECT id, name, slug, description, active, sort_order, created_at FROM categories ORDER BY id").all()
      },
      products: {
        label: "Ürünler",
        rows: database.prepare(`
          SELECT p.id, p.sku, p.name, c.name AS category, p.price_cents / 100.0 AS price,
            p.compare_at_price_cents / 100.0 AS compare_at_price,
            p.stock, p.active, p.badge, p.description, p.created_at
          FROM products p JOIN categories c ON c.id = p.category_id
          ORDER BY p.id
        `).all()
      },
      customers: {
        label: "Üye hesapları",
        rows: database.prepare(`
          SELECT u.id,
            CASE WHEN u.deleted_at IS NULL THEN u.name ELSE 'Silinmiş hesap' END AS name,
            CASE WHEN u.deleted_at IS NULL THEN u.email ELSE '' END AS email,
            u.created_at, u.deleted_at,
            COUNT(o.id) AS order_count
          FROM users u LEFT JOIN orders o ON o.user_id = u.id
          GROUP BY u.id ORDER BY u.created_at DESC
        `).all()
      },
      admins: {
        label: "Yönetici hesapları",
        rows: database.prepare("SELECT id, username, created_at FROM admins ORDER BY id").all()
      },
      sessions: {
        label: "Oturumlar",
        rows: database.prepare(`
          SELECT s.id,
            CASE WHEN s.admin_id IS NOT NULL THEN 'Yönetici'
              WHEN s.user_id IS NOT NULL THEN 'Müşteri' ELSE 'Misafir' END AS type,
            CASE WHEN s.admin_id IS NOT NULL THEN a.username
              WHEN u.deleted_at IS NOT NULL THEN 'Silinmiş hesap'
              WHEN s.user_id IS NOT NULL THEN u.email ELSE 'Misafir' END AS owner,
            s.created_at, s.expires_at
          FROM sessions s
          LEFT JOIN users u ON u.id = s.user_id
          LEFT JOIN admins a ON a.id = s.admin_id
          ORDER BY s.created_at DESC
        `).all()
      },
      cart_items: {
        label: "Sepet kalemleri",
        rows: database.prepare(`
          SELECT ci.id,
            CASE WHEN s.admin_id IS NOT NULL THEN a.username
              WHEN u.deleted_at IS NOT NULL THEN 'Silinmiş hesap'
              WHEN s.user_id IS NOT NULL THEN u.email ELSE 'Misafir' END AS owner,
            p.sku, p.name AS product, ci.quantity, ci.created_at
          FROM cart_items ci
          JOIN sessions s ON s.id = ci.session_id
          JOIN products p ON p.id = ci.product_id
          LEFT JOIN users u ON u.id = s.user_id
          LEFT JOIN admins a ON a.id = s.admin_id
          ORDER BY ci.created_at DESC
        `).all()
      },
      favorites: {
        label: "Favoriler",
        rows: database.prepare(`
          SELECT f.id,
            CASE WHEN s.admin_id IS NOT NULL THEN a.username
              WHEN u.deleted_at IS NOT NULL THEN 'Silinmiş hesap'
              WHEN s.user_id IS NOT NULL THEN u.email ELSE 'Misafir' END AS owner,
            p.sku, p.name AS product, f.created_at
          FROM favorites f
          JOIN sessions s ON s.id = f.session_id
          JOIN products p ON p.id = f.product_id
          LEFT JOIN users u ON u.id = s.user_id
          LEFT JOIN admins a ON a.id = s.admin_id
          ORDER BY f.created_at DESC
        `).all()
      },
      orders: {
        label: "Siparişler",
        rows: database.prepare(`
          SELECT o.id, o.order_number,
            CASE WHEN u.deleted_at IS NULL THEN u.name ELSE 'Silinmiş hesap' END AS customer,
            o.status, o.total_cents / 100.0 AS total, o.recipient_name, o.phone, o.city,
            o.address, o.created_at, o.updated_at
          FROM orders o JOIN users u ON u.id = o.user_id
          ORDER BY o.created_at DESC
        `).all()
      },
      order_items: {
        label: "Sipariş kalemleri",
        rows: database.prepare(`
          SELECT oi.id, o.order_number, oi.sku, oi.product_name,
            oi.unit_price_cents / 100.0 AS unit_price, oi.quantity,
            oi.unit_price_cents * oi.quantity / 100.0 AS line_total
          FROM order_items oi JOIN orders o ON o.id = oi.order_id
          ORDER BY oi.id
        `).all()
      },
      messages: {
        label: "İletişim mesajları",
        rows: database.prepare("SELECT id, name, email, body, created_at FROM messages ORDER BY created_at DESC").all()
      },
      reviews: {
        label: "Ürün yorumları",
        rows: database.prepare(`
          SELECT r.id, p.sku, p.name AS product, r.author_name, r.rating, r.body, r.status, r.created_at
          FROM reviews r JOIN products p ON p.id = r.product_id
          ORDER BY r.created_at DESC
        `).all()
      },
      product_images: {
        label: "Ürün görselleri",
        rows: database.prepare(`
          SELECT pi.id, p.sku, p.name AS product, pi.url, pi.alt, pi.sort_order, pi.created_at
          FROM product_images pi JOIN products p ON p.id = pi.product_id
          ORDER BY p.id, pi.sort_order, pi.id
        `).all()
      },
      coupons: {
        label: "Kuponlar",
        rows: database.prepare(`
          SELECT id, code, discount_type, value, min_order_cents / 100.0 AS min_order,
            active, usage_limit, used_count, expires_at, created_at
          FROM coupons ORDER BY id
        `).all()
      },
      settings: {
        label: "Mağaza ayarları",
        rows: database.prepare("SELECT key, value FROM settings ORDER BY key").all()
          .map((setting) => ({
            ...setting,
            value: /password|secret|token|private|api[_-]?key/i.test(setting.key) ? "[gizli]" : setting.value
          }))
      }
    };
    const references = {};
    Object.entries(tables).forEach(([key, table]) => {
      table.count = table.rows.length;
      const spec = databaseEditors[key];
      if (!spec) { table.editor = null; return; }
      table.editor = {
        primaryKey: spec.primaryKey || "id",
        deleteKind: spec.deleteKind || "row",
        fields: spec.fields.map((field) => ({
          key: field.key,
          label: field.label,
          type: field.type,
          required: Boolean(field.required),
          hint: field.hint || "",
          default: field.default === undefined ? null : field.default,
          options: field.options || null,
          ref: field.ref || null
        }))
      };
      table.editor.fields.forEach((field) => {
        if (field.ref && !references[field.ref]) references[field.ref] = referenceOptions(field.ref);
      });
    });
    return sendJson(response, 200, { tables, references });
  }

  const databaseTableMatch = pathname.match(/^\/api\/admin\/database\/([a-z_]+)$/);
  if (databaseTableMatch && method === "POST") {
    try {
      const result = await insertDatabaseRow(databaseTableMatch[1], body);
      return sendJson(response, 201, { ok: true, id: Number(result.lastInsertRowid) });
    } catch (error) {
      throw constraintError(error);
    }
  }

  const databaseRowMatch = pathname.match(/^\/api\/admin\/database\/([a-z_]+)\/(.+)$/);
  if (databaseRowMatch && method === "DELETE") {
    try {
      await deleteDatabaseRow(databaseRowMatch[1], decodeURIComponent(databaseRowMatch[2]));
      return sendJson(response, 200, { ok: true });
    } catch (error) {
      throw constraintError(error);
    }
  }

  throw new HttpError(404, "API adresi bulunamadı.");
}

async function serveStatic(request, response, pathname) {
  let requestedFile;
  if (pathname === "/") {
    requestedFile = "index.html";
  } else {
    const clean = pathname.replace(/^\/+/, "").replace(/\/+$/, "");
    requestedFile = path.extname(clean) ? clean : `${clean}.html`;
  }
  let filePath;
  try {
    filePath = path.resolve(root, requestedFile);
  } catch {
    response.writeHead(400);
    response.end("Geçersiz istek.");
    return;
  }
  if (!filePath.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403);
    response.end("Erişim reddedildi.");
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Sayfa bulunamadı.");
      return;
    }
    response.writeHead(200, {
      "Content-Type": types[path.extname(filePath)] || "application/octet-stream",
      "Content-Length": Buffer.byteLength(content),
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin"
    });
    response.end(content);
  });
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await api(request, response, url);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      throw new HttpError(405, "Bu istek yöntemi desteklenmiyor.");
    }
    await serveStatic(request, response, decodeURIComponent(url.pathname));
  } catch (error) {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error(error);
    sendJson(response, status, { error: status === 500 ? "Sunucu hatası oluştu." : error.message });
  }
});

server.listen(port, () => {
  console.log(`Tunç Elektrik ve Elektronik hazır: http://localhost:${port}`);
});
