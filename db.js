const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { randomBytes, scryptSync } = require("node:crypto");

const dataDirectory = path.join(__dirname, "data");
fs.mkdirSync(dataDirectory, { recursive: true });

const database = new DatabaseSync(path.join(dataDirectory, "tunctech.sqlite"));
database.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    sku TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    compare_at_price_cents INTEGER CHECK (compare_at_price_cents IS NULL OR compare_at_price_cents >= 0),
    stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    badge TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    admin_id INTEGER REFERENCES admins(id) ON DELETE CASCADE,
    coupon_code TEXT,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (user_id IS NULL OR admin_id IS NULL)
  );

  CREATE TABLE IF NOT EXISTS cart_items (
    id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (session_id, product_id)
  );

  CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (session_id, product_id)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY,
    order_number TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'processing', 'shipped', 'completed', 'cancelled')),
    total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
    discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
    coupon_code TEXT NOT NULL DEFAULT '',
    recipient_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT NOT NULL,
    city TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    product_name TEXT NOT NULL,
    sku TEXT NOT NULL,
    unit_price_cents INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0)
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    author_name TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    body TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS product_images (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    alt TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS coupons (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL COLLATE NOCASE UNIQUE,
    discount_type TEXT NOT NULL DEFAULT 'percent' CHECK (discount_type IN ('percent', 'fixed')),
    value INTEGER NOT NULL CHECK (value > 0),
    min_order_cents INTEGER NOT NULL DEFAULT 0 CHECK (min_order_cents >= 0),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    usage_limit INTEGER NOT NULL DEFAULT 0 CHECK (usage_limit >= 0),
    used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id, active);
  CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id, status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id, sort_order, id);
  CREATE INDEX IF NOT EXISTS idx_cart_session ON cart_items(session_id);
  CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
`);

if (!database.prepare("PRAGMA table_info(users)").all().some((column) => column.name === "deleted_at")) {
  database.exec("ALTER TABLE users ADD COLUMN deleted_at TEXT");
}

if (!database.prepare("PRAGMA table_info(products)").all().some((column) => column.name === "compare_at_price_cents")) {
  database.exec("ALTER TABLE products ADD COLUMN compare_at_price_cents INTEGER");
}

if (!database.prepare("PRAGMA table_info(sessions)").all().some((column) => column.name === "coupon_code")) {
  database.exec("ALTER TABLE sessions ADD COLUMN coupon_code TEXT");
}

const orderColumns = database.prepare("PRAGMA table_info(orders)").all().map((column) => column.name);
if (!orderColumns.includes("discount_cents")) {
  database.exec("ALTER TABLE orders ADD COLUMN discount_cents INTEGER NOT NULL DEFAULT 0");
}
if (!orderColumns.includes("coupon_code")) {
  database.exec("ALTER TABLE orders ADD COLUMN coupon_code TEXT NOT NULL DEFAULT ''");
}

function passwordHash(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

const seed = database.prepare(
  "INSERT OR IGNORE INTO categories (name, slug, description, sort_order) VALUES (?, ?, ?, ?)"
);
[
  ["Arduino & Kartlar", "arduino", "Geliştirme kartları ve proje platformları", 1],
  ["Sensörler & Modüller", "sensor", "Ölçüm, algılama ve kablosuz iletişim modülleri", 2],
  ["Elektronik Komponentler", "components", "Devre elemanları, prototipleme ve entegreler", 3],
  ["Güç & Batarya", "power", "Güç kaynakları, piller ve şarj modülleri", 4],
  ["Kablo & Konnektör", "cables", "Proje bağlantıları ve kablolama çözümleri", 5],
  ["Lehimleme & Atölye", "tools", "Lehimleme ve elektronik atölye ekipmanları", 6]
].forEach((category) => seed.run(...category));

const categoryIds = Object.fromEntries(
  database.prepare("SELECT slug, id FROM categories").all().map(({ slug, id }) => [slug, id])
);
const insertProduct = database.prepare(`
  INSERT OR IGNORE INTO products
    (category_id, sku, name, description, price_cents, stock, badge)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
[
  ["arduino", "TNC-ARD-UNO-R3", "Arduino Uno R3 Geliştirme Kartı", "ATmega328P tabanlı, projeler için başlangıç geliştirme kartı.", 28990, 42, "ÇOK SATAN"],
  ["sensor", "TNC-SEN-HC-SR04", "HC-SR04 Ultrasonik Mesafe Sensörü", "2 cm ile 400 cm arası temassız mesafe ölçümü.", 6950, 85, "YENİ"],
  ["components", "TNC-CMP-BB830", "Breadboard 830 Delik Prototipleme Seti", "Lehim gerektirmeyen devre prototipleme tahtası.", 11900, 31, "ATÖLYE FAVORİSİ"],
  ["sensor", "TNC-SEN-DHT22", "DHT22 Sıcaklık ve Nem Sensörü", "Dijital sıcaklık ve bağıl nem ölçüm modülü.", 8990, 24, "YENİ"],
  ["power", "TNC-PWR-18650", "18650 Li-ion Şarjlı Pil 2600 mAh", "Yüksek kapasiteli, tekrar şarj edilebilir lityum iyon pil.", 12990, 56, "TUNÇ SEÇKİSİ"],
  ["cables", "TNC-CBL-JUMPER40", "40'lı Jumper Kablo Seti", "Breadboard ve geliştirme kartları için erkek-erkek jumper seti.", 4990, 110, "TUNÇ SEÇKİSİ"],
  ["tools", "TNC-TOL-IRON60", "60W Ayarlı Havya Seti", "Ayarlanabilir sıcaklık kontrollü elektronik havyası.", 54990, 12, "ATÖLYE FAVORİSİ"]
].forEach(([slug, sku, name, description, price, stock, badge]) => {
  insertProduct.run(categoryIds[slug], sku, name, description, price, stock, badge);
});

const seedDiscount = database.prepare(
  "UPDATE products SET compare_at_price_cents = ? WHERE sku = ? AND compare_at_price_cents IS NULL"
);
[
  ["TNC-ARD-UNO-R3", 35990],
  ["TNC-CMP-BB830", 14900],
  ["TNC-PWR-18650", 15990],
  ["TNC-TOL-IRON60", 68990]
].forEach(([sku, compareAt]) => seedDiscount.run(compareAt, sku));

const productIds = Object.fromEntries(
  database.prepare("SELECT sku, id FROM products").all().map(({ sku, id }) => [sku, id])
);
const insertReview = database.prepare(`
  INSERT INTO reviews (product_id, author_name, rating, body, status, created_at)
  SELECT ?, ?, ?, ?, 'approved', ?
  WHERE NOT EXISTS (
    SELECT 1 FROM reviews WHERE product_id = ? AND author_name = ?
  )
`);
[
  ["TNC-ARD-UNO-R3", "Barış K.", 5, "Okul projesi için aldım, kutu içeriği eksiksiz geldi ve kısa sürede çalıştırdım.", "2026-10-02 09:14:00"],
  ["TNC-ARD-UNO-R3", "Elif T.", 4, "Fiyat/performans dengesi iyi. Başlangıç kılavuzu biraz kısa kalmış ama kart sorunsuz.", "2026-10-11 18:32:00"],
  ["TNC-SEN-HC-SR04", "Mert A.", 5, "Mesafe ölçümleri stabil; robotik projede sorunsuz kullandım.", "2026-10-05 12:20:00"],
  ["TNC-SEN-DHT22", "Zeynep D.", 4, "Sıcaklık ve nem değerleri tutarlı. Kablo uzunluğu biraz daha olsa iyi olurdu.", "2026-10-14 21:05:00"],
  ["TNC-PWR-18650", "Can Y.", 5, "Kapasitesi belirtildiği gibi, şarj döngüsü iyi.", "2026-10-08 08:47:00"],
  ["TNC-TOL-IRON60", "Hakan Ş.", 4, "Isınması hızlı, uç kalitesi iyi. Set içeriği beklentimi karşıladı.", "2026-10-19 16:10:00"]
].forEach(([sku, author, rating, body, createdAt]) => {
  insertReview.run(productIds[sku], author, rating, body, createdAt, productIds[sku], author);
});

const productImageUrl = (prompt, size = "square") =>
  `https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=${encodeURIComponent(prompt)}&image_size=${size}`;

const insertProductImage = database.prepare(`
  INSERT INTO product_images (product_id, url, alt, sort_order)
  SELECT ?, ?, ?, ?
  WHERE NOT EXISTS (
    SELECT 1 FROM product_images WHERE product_id = ? AND sort_order = ?
  )
`);
const productImageSeed = {
  "TNC-ARD-UNO-R3": [
    "Arduino Uno R3 compatible development board, teal green PCB, top down product photograph, studio lighting, clean light gray seamless background, sharp focus, high detail electronics",
    "Arduino Uno R3 board at three quarter angle showing USB port and DC barrel jack, studio product photo, light gray background",
    "Macro close-up of ATmega328P microcontroller chip and black pin headers on a green Arduino board, shallow depth of field"
  ],
  "TNC-SEN-HC-SR04": [
    "HC-SR04 ultrasonic distance sensor module with two silver cylindrical transducers on a blue PCB, product photograph, clean white background, studio lighting",
    "HC-SR04 sensor at angled view showing four pin header and crystal oscillator, product photo, light background",
    "Macro close-up of the two metallic ultrasonic transducers of an HC-SR04 sensor, shallow depth of field"
  ],
  "TNC-CMP-BB830": [
    "White 830 tie-point solderless breadboard with colorful jumper wires, top view product photograph, clean light background, studio lighting",
    "Breadboard with a simple LED and resistor circuit assembled, angled product photo, light gray background",
    "Macro close-up of breadboard hole grid with electronic component legs inserted, shallow depth of field"
  ],
  "TNC-SEN-DHT22": [
    "DHT22 temperature and humidity sensor module, white plastic housing with front grille, product photograph, clean white background",
    "DHT22 sensor at angled view showing three pin connector and small blue PCB, product photo, light background",
    "Macro close-up of the front grille of a DHT22 temperature humidity sensor, shallow depth of field"
  ],
  "TNC-PWR-18650": [
    "18650 lithium ion rechargeable battery cell with blue wrapper, product photograph, clean white background, studio lighting",
    "Two 18650 battery cells standing and lying next to each other, angled product photo, light background",
    "Macro close-up of an 18650 battery positive terminal and wrapper detail, shallow depth of field"
  ],
  "TNC-CBL-JUMPER40": [
    "Bundle of colorful male to male jumper wires for breadboard, neatly arranged, product photograph, clean white background",
    "Rainbow colored jumper wires fanned out in a spread, top view product photo, light background",
    "Macro close-up of dupont jumper wire connectors, shallow depth of field"
  ],
  "TNC-TOL-IRON60": [
    "Adjustable temperature soldering iron station set with stand and solder wire, product photograph, clean light background, studio lighting",
    "Soldering iron with digital temperature control and extra tips laid out, product photo, light gray background",
    "Macro close-up of a soldering iron tip and handle grip, shallow depth of field"
  ]
};
Object.entries(productImageSeed).forEach(([sku, prompts]) => {
  const productId = productIds[sku];
  if (!productId) return;
  prompts.forEach((prompt, index) => {
    insertProductImage.run(productId, productImageUrl(prompt), `${sku} ürün görseli ${index + 1}`, index, productId, index);
  });
});

const seedCoupon = database.prepare(`
  INSERT INTO coupons (code, discount_type, value, min_order_cents, active, usage_limit, expires_at)
  VALUES (?, ?, ?, ?, 1, ?, ?)
  ON CONFLICT(code) DO NOTHING
`);
[
  ["TUNC10", "percent", 10, 50000, 0, "2027-12-31"],
  ["ATOLYE100", "fixed", 10000, 100000, 0, null]
].forEach((coupon) => seedCoupon.run(...coupon));

const adminUsername = process.env.ADMIN_USERNAME || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || "tunctech2026";
database.prepare("INSERT OR IGNORE INTO admins (username, password_hash) VALUES (?, ?)")
  .run(adminUsername, passwordHash(adminPassword));

database.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('store_name', 'Tunç Elektrik ve Elektronik')").run();

module.exports = database;
