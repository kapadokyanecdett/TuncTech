const loginScreen = document.querySelector("#admin-login");
const appScreen = document.querySelector("#admin-app");
const loginForm = document.querySelector("#admin-login-form");
const loginMessage = document.querySelector("#login-message");
const adminToast = document.querySelector("#admin-toast");
const productDialog = document.querySelector("#product-dialog");
const categoryDialog = document.querySelector("#category-dialog");
const customerDialog = document.querySelector("#customer-dialog");
const couponDialog = document.querySelector("#coupon-dialog");
const productForm = document.querySelector("#product-form");
const categoryForm = document.querySelector("#category-form");
const customerForm = document.querySelector("#customer-form");
const couponForm = document.querySelector("#coupon-form");
const databaseDialog = document.querySelector("#database-dialog");
const databaseForm = document.querySelector("#database-form");
let adminCategories = [];
let adminProducts = [];
let adminCoupons = [];
let databaseTables = {};
let databaseReferences = {};
let toastTimer;

const viewTitles = {
  dashboard: "Genel Bakış",
  products: "Ürünler",
  categories: "Kategoriler",
  orders: "Siparişler",
  customers: "Müşteriler",
  reviews: "Yorumlar",
  coupons: "Kuponlar",
  database: "Veritabanı"
};
const statusLabels = {
  new: "Yeni",
  processing: "Hazırlanıyor",
  shipped: "Kargoda",
  completed: "Tamamlandı",
  cancelled: "İptal"
};
const reviewStatusLabels = {
  pending: "Onay bekliyor",
  approved: "Yayında",
  rejected: "Reddedildi"
};

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "İstek tamamlanamadı.");
  return result;
}

function money(value) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(value);
}

function moneyOrDash(value) {
  return value === null || value === undefined || value === "" ? "—" : money(value);
}

function date(value) {
  return new Date(`${String(value).replace(" ", "T")}Z`).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function toast(message) {
  adminToast.textContent = message;
  adminToast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => adminToast.classList.remove("visible"), 2800);
}

function cell(row, value, className = "") {
  const td = document.createElement("td");
  if (className) td.className = className;
  td.textContent = value ?? "—";
  row.append(td);
  return td;
}

function statusPill(status) {
  const pill = document.createElement("span");
  pill.className = `status-pill status-${status}`;
  pill.textContent = statusLabels[status] || status;
  return pill;
}

function setView(view) {
  document.querySelectorAll(".admin-view").forEach((section) => {
    section.classList.toggle("active", section.id === `view-${view}`);
  });
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  document.querySelector("#page-title").textContent = viewTitles[view];
  loadView(view).catch((error) => toast(error.message));
}

async function loadCategories() {
  const { categories } = await api("/api/admin/categories");
  adminCategories = categories;
  return categories;
}

async function loadProducts() {
  const { products } = await api("/api/admin/products");
  adminProducts = products;
  return products;
}

function renderStats(stats) {
  const items = [
    ["Aktif ürün", stats.products, "CATALOG"],
    ["Kategoriler", stats.categories, "STRUCTURE"],
    ["Müşteriler", stats.customers, "MEMBERS"],
    ["Siparişler", stats.orders, "ORDERS"],
    ["Onay bekleyen yorum", stats.pendingReviews, "REVIEWS"],
    ["Toplam satış", money(stats.revenue), "REVENUE"]
  ];
  const grid = document.querySelector("#stats-grid");
  grid.replaceChildren();
  items.forEach(([label, value, tag]) => {
    const card = document.createElement("article");
    card.className = "stat-card";
    const title = document.createElement("span");
    title.textContent = label;
    const marker = document.createElement("small");
    marker.textContent = tag;
    const amount = document.createElement("strong");
    amount.textContent = value;
    card.append(title, marker, amount);
    grid.append(card);
  });
}

function renderOrderRows(orders, target, recent = false) {
  target.replaceChildren();
  const empty = document.querySelector(recent ? "#recent-orders-empty" : "#orders-empty");
  empty.hidden = orders.length > 0;
  orders.forEach((order) => {
    const row = document.createElement("tr");
    cell(row, order.order_number);
    cell(row, `${order.customer_name}\n${order.customer_email || ""}`);
    if (!recent) cell(row, `${order.item_count} ürün`);
    if (!recent) {
      const delivery = cell(row, "");
      delivery.className = "delivery-cell";
      const recipient = document.createElement("strong");
      recipient.textContent = order.recipient_name;
      const address = document.createElement("small");
      address.textContent = `${order.phone} · ${order.city} · ${order.address}`;
      delivery.append(recipient, address);
    }
    cell(row, date(order.created_at));
    if (recent) {
      const status = document.createElement("td");
      status.append(statusPill(order.status));
      row.append(status);
    }
    cell(row, money(order.total));
    if (!recent) {
      const statusCell = document.createElement("td");
      const select = document.createElement("select");
      select.className = "status-select";
      select.dataset.orderId = order.id;
      Object.entries(statusLabels).forEach(([value, label]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        option.selected = value === order.status;
        select.append(option);
      });
      statusCell.append(select);
      row.append(statusCell);
    }
    target.append(row);
  });
}

async function loadDashboard() {
  const [{ stats }, { orders }] = await Promise.all([
    api("/api/admin/summary"),
    api("/api/admin/orders")
  ]);
  renderStats(stats);
  renderOrderRows(orders.slice(0, 6), document.querySelector("#recent-orders"), true);
}

function renderProducts() {
  const target = document.querySelector("#products-table");
  target.replaceChildren();
  document.querySelector("#products-empty").hidden = adminProducts.length > 0;
  adminProducts.forEach((product) => {
    const row = document.createElement("tr");
    cell(row, product.sku, "table-muted");
    const name = cell(row, "");
    const title = document.createElement("strong");
    title.textContent = product.name;
    name.append(title);
    cell(row, product.category_name);
    cell(row, money(product.price));
    cell(row, product.stock);
    const active = document.createElement("td");
    active.append(statusPill(product.active ? "completed" : "cancelled"));
    active.lastChild.textContent = product.active ? "Yayında" : "Pasif";
    row.append(active);
    const actions = document.createElement("td");
    actions.className = "table-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.dataset.editProduct = product.id;
    edit.textContent = "Düzenle";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.dataset.deleteProduct = product.id;
    remove.className = "delete-button";
    remove.textContent = "Sil";
    actions.append(edit, remove);
    row.append(actions);
    target.append(row);
  });
}

function renderCategories() {
  const target = document.querySelector("#categories-table");
  target.replaceChildren();
  document.querySelector("#categories-empty").hidden = adminCategories.length > 0;
  adminCategories.forEach((category) => {
    const row = document.createElement("tr");
    const name = cell(row, "");
    const title = document.createElement("strong");
    title.textContent = category.name;
    name.append(title);
    cell(row, category.slug, "table-muted");
    cell(row, category.description);
    cell(row, category.product_count);
    const active = document.createElement("td");
    active.append(statusPill(category.active ? "completed" : "cancelled"));
    active.lastChild.textContent = category.active ? "Yayında" : "Pasif";
    row.append(active);
    const actions = document.createElement("td");
    actions.className = "table-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.dataset.editCategory = category.id;
    edit.textContent = "Düzenle";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.dataset.deleteCategory = category.id;
    remove.className = "delete-button";
    remove.textContent = "Sil";
    actions.append(edit, remove);
    row.append(actions);
    target.append(row);
  });
}

function renderCustomers(customers) {
  const target = document.querySelector("#customers-table");
  target.replaceChildren();
  document.querySelector("#customers-empty").hidden = customers.length > 0;
  customers.forEach((customer) => {
    const row = document.createElement("tr");
    const name = cell(row, "");
    const title = document.createElement("strong");
    title.textContent = customer.name;
    name.append(title);
    cell(row, customer.email);
    cell(row, date(customer.created_at));
    cell(row, customer.order_count);
    cell(row, money(customer.total));
    const actions = document.createElement("td");
    actions.className = "table-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.dataset.editCustomer = customer.id;
    edit.textContent = "Düzenle";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.dataset.deleteCustomer = customer.id;
    remove.className = "delete-button";
    remove.textContent = "Sil";
    actions.append(edit, remove);
    row.append(actions);
    target.append(row);
  });
}

function renderReviews(reviews, pending) {
  const target = document.querySelector("#reviews-table");
  target.replaceChildren();
  document.querySelector("#reviews-empty").hidden = reviews.length > 0;
  const pendingNote = document.querySelector("#reviews-pending");
  if (pendingNote) {
    pendingNote.textContent = pending ? `${pending} yorum onay bekliyor` : "Onay bekleyen yorum yok";
    pendingNote.classList.toggle("is-alert", pending > 0);
  }
  reviews.forEach((review) => {
    const row = document.createElement("tr");
    const product = cell(row, "");
    const productName = document.createElement("strong");
    productName.textContent = review.product_name;
    const sku = document.createElement("small");
    sku.className = "review-sku";
    sku.textContent = review.sku;
    product.append(productName, sku);
    cell(row, review.author_name);
    cell(row, "★".repeat(review.rating) + "☆".repeat(5 - review.rating), "review-stars-cell");
    cell(row, review.body || "—", "review-body-cell");
    cell(row, date(review.created_at));
    const status = document.createElement("td");
    const pill = document.createElement("span");
    pill.className = `status-pill status-${review.status}`;
    pill.textContent = reviewStatusLabels[review.status] || review.status;
    status.append(pill);
    row.append(status);
    const actions = document.createElement("td");
    actions.className = "table-actions";
    if (review.status !== "approved") {
      const approve = document.createElement("button");
      approve.type = "button";
      approve.dataset.approveReview = review.id;
      approve.textContent = "Onayla";
      actions.append(approve);
    }
    if (review.status !== "rejected") {
      const reject = document.createElement("button");
      reject.type = "button";
      reject.dataset.rejectReview = review.id;
      reject.textContent = "Reddet";
      actions.append(reject);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete-button";
    remove.dataset.deleteReview = review.id;
    remove.textContent = "Sil";
    actions.append(remove);
    row.append(actions);
    target.append(row);
  });
}

function couponDiscountLabel(coupon) {
  return coupon.discount_type === "percent"
    ? `%${coupon.value}`
    : money(coupon.value / 100);
}

function renderCoupons() {
  const target = document.querySelector("#coupons-table");
  target.replaceChildren();
  document.querySelector("#coupons-empty").hidden = adminCoupons.length > 0;
  adminCoupons.forEach((coupon) => {
    const row = document.createElement("tr");
    const code = document.createElement("td");
    const tag = document.createElement("span");
    tag.className = "coupon-code";
    tag.textContent = coupon.code;
    code.append(tag);
    row.append(code);
    cell(row, couponDiscountLabel(coupon));
    cell(row, coupon.min_order > 0 ? money(coupon.min_order) : "—");
    cell(row, coupon.usage_limit > 0 ? `${coupon.used_count} / ${coupon.usage_limit}` : `${coupon.used_count} / ∞`);
    cell(row, coupon.expires_at || "—");
    const status = document.createElement("td");
    const pill = document.createElement("span");
    pill.className = `status-pill status-${coupon.active ? "completed" : "cancelled"}`;
    pill.textContent = coupon.active ? "Aktif" : "Pasif";
    status.append(pill);
    row.append(status);
    const actions = document.createElement("td");
    actions.className = "table-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.dataset.editCoupon = coupon.id;
    edit.textContent = "Düzenle";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete-button";
    remove.dataset.deleteCoupon = coupon.id;
    remove.textContent = "Sil";
    actions.append(edit, remove);
    row.append(actions);
    target.append(row);
  });
}

async function loadCoupons() {
  const { coupons } = await api("/api/admin/coupons");
  adminCoupons = coupons;
  return coupons;
}

function openCouponEditor(coupon = null) {
  couponForm.reset();
  couponForm.elements.id.value = coupon?.id || "";
  couponForm.elements.code.value = coupon?.code || "";
  couponForm.elements.discountType.value = coupon?.discount_type || "percent";
  couponForm.elements.value.value = coupon ? coupon.display_value : "";
  couponForm.elements.minOrder.value = coupon ? coupon.min_order : 0;
  couponForm.elements.usageLimit.value = coupon ? coupon.usage_limit : 0;
  couponForm.elements.expiresAt.value = coupon?.expires_at || "";
  couponForm.elements.active.checked = coupon ? coupon.active : true;
  document.querySelector("#coupon-dialog-title").textContent = coupon ? "Kuponu düzenle" : "Yeni kupon";
  couponDialog.showModal();
}

const databaseColumns = {
  categories: [
    ["ID", "id"], ["Ad", "name"], ["Kod", "slug"], ["Açıklama", "description", null, "database-long"],
    ["Sıra", "sort_order"], ["Durum", "active", (value) => value ? "Aktif" : "Pasif"], ["Oluşturulma", "created_at", date]
  ],
  products: [
    ["ID", "id"], ["SKU", "sku"], ["Ürün", "name"], ["Kategori", "category"], ["Fiyat", "price", money],
    ["İndirim öncesi", "compare_at_price", moneyOrDash],
    ["Stok", "stock"], ["Durum", "active", (value) => value ? "Aktif" : "Pasif"], ["Etiket", "badge"],
    ["Açıklama", "description", null, "database-long"], ["Oluşturulma", "created_at", date]
  ],
  customers: [
    ["ID", "id"], ["Ad", "name"], ["E-posta", "email"], ["Kayıt", "created_at", date],
    ["Sipariş", "order_count"], ["Durum", "deleted_at", (value) => value ? "Anonimleştirildi" : "Aktif"]
  ],
  admins: [["ID", "id"], ["Kullanıcı adı", "username"], ["Oluşturulma", "created_at", date]],
  sessions: [
    ["ID", "id"], ["Tür", "type"], ["Hesap", "owner"], ["Oluşturulma", "created_at", date],
    ["Bitiş", "expires_at", (value) => new Date(value).toLocaleString("tr-TR")]
  ],
  cart_items: [
    ["ID", "id"], ["Hesap", "owner"], ["SKU", "sku"], ["Ürün", "product"], ["Adet", "quantity"], ["Eklenme", "created_at", date]
  ],
  favorites: [
    ["ID", "id"], ["Hesap", "owner"], ["SKU", "sku"], ["Ürün", "product"], ["Eklenme", "created_at", date]
  ],
  orders: [
    ["ID", "id"], ["Sipariş no", "order_number"], ["Müşteri", "customer"], ["Durum", "status"],
    ["Tutar", "total", money], ["Alıcı", "recipient_name"], ["Telefon", "phone"], ["İl", "city"],
    ["Adres", "address", null, "database-long"], ["Tarih", "created_at", date]
  ],
  order_items: [
    ["ID", "id"], ["Sipariş no", "order_number"], ["SKU", "sku"], ["Ürün", "product_name"],
    ["Birim fiyat", "unit_price", money], ["Adet", "quantity"], ["Satır toplamı", "line_total", money]
  ],
  messages: [
    ["ID", "id"], ["Ad", "name"], ["E-posta", "email"], ["Mesaj", "body", null, "database-long"], ["Tarih", "created_at", date]
  ],
  reviews: [
    ["ID", "id"], ["SKU", "sku"], ["Ürün", "product"], ["Yazar", "author_name"], ["Puan", "rating"],
    ["Yorum", "body", null, "database-long"], ["Durum", "status", (value) => reviewStatusLabels[value] || value],
    ["Tarih", "created_at", date]
  ],
  product_images: [
    ["ID", "id"], ["SKU", "sku"], ["Ürün", "product"], ["Alt metin", "alt"],
    ["Görsel adresi", "url", null, "database-long"], ["Sıra", "sort_order"], ["Eklenme", "created_at", date]
  ],
  coupons: [
    ["ID", "id"], ["Kod", "code"], ["Tür", "discount_type", (value) => value === "percent" ? "Yüzde" : "Sabit"],
    ["Değer", "value"], ["Min. sepet", "min_order", money], ["Limit", "usage_limit"], ["Kullanım", "used_count"],
    ["Bitiş", "expires_at"], ["Durum", "active", (value) => value ? "Aktif" : "Pasif"], ["Oluşturulma", "created_at", date]
  ],
  settings: [["Anahtar", "key"], ["Değer", "value", null, "database-long"]]
};

function renderDatabaseTable(tableKey) {
  const table = databaseTables[tableKey];
  const head = document.querySelector("#database-head");
  const target = document.querySelector("#database-rows");
  const empty = document.querySelector("#database-empty");
  const addButton = document.querySelector("#database-add");
  head.replaceChildren();
  target.replaceChildren();
  if (!table) return;
  const editor = table.editor;
  document.querySelector("#database-table-title").textContent = `${table.label} · ${table.count}`;
  const header = document.createElement("tr");
  databaseColumns[tableKey].forEach(([label]) => {
    const th = document.createElement("th");
    th.textContent = label;
    header.append(th);
  });
  if (editor) header.append(document.createElement("th"));
  head.append(header);
  empty.hidden = table.rows.length > 0;
  addButton.hidden = !editor;
  const primaryKey = editor?.primaryKey || "id";
  table.rows.forEach((record) => {
    const row = document.createElement("tr");
    databaseColumns[tableKey].forEach(([, key, format, className]) => {
      const rawValue = record[key];
      const value = format ? format(rawValue, record) : rawValue;
      cell(row, value, className || "");
    });
    if (editor) {
      const actions = document.createElement("td");
      actions.className = "table-actions";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "delete-button";
      remove.dataset.databaseDelete = tableKey;
      remove.dataset.databaseKey = record[primaryKey];
      remove.textContent = "Sil";
      actions.append(remove);
      row.append(actions);
    }
    target.append(row);
  });
}

function renderDatabaseSummary(tables) {
  const target = document.querySelector("#database-summary");
  target.replaceChildren();
  Object.entries(tables).forEach(([key, table]) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "database-count-card";
    card.dataset.databaseTable = key;
    const label = document.createElement("span");
    label.textContent = table.label;
    const count = document.createElement("strong");
    count.textContent = table.count;
    card.append(label, count);
    target.append(card);
  });
}

function renderDatabase(tables, references = {}) {
  databaseTables = tables;
  databaseReferences = references;
  renderDatabaseSummary(tables);
  const select = document.querySelector("#database-table-select");
  renderDatabaseTable(select.value);
}

function buildDatabaseField(field) {
  const wrapper = document.createElement("label");
  const caption = document.createElement("span");
  caption.className = "database-field-label";
  caption.textContent = field.label;
  let input;
  if (field.type === "select" || field.type === "ref") {
    input = document.createElement("select");
    if (!field.required) {
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = "— yok —";
      input.append(blank);
    }
    const options = field.type === "ref"
      ? (databaseReferences[field.ref] || [])
      : (field.options || []).map((value) => ({ value, label: statusLabels[value] || reviewStatusLabels[value] || value }));
    options.forEach((option) => {
      const el = document.createElement("option");
      el.value = option.value;
      el.textContent = option.label;
      input.append(el);
    });
    if (field.default !== null && field.default !== undefined) input.value = String(field.default);
    input.required = field.type === "ref" && field.required;
  } else if (field.type === "bool") {
    input = document.createElement("input");
    input.type = "checkbox";
    input.checked = field.default !== false;
  } else {
    input = document.createElement("input");
    const numberType = field.type === "int" || field.type === "money";
    input.type = field.type === "password" ? "password" : (field.type === "email" ? "email" : (numberType ? "number" : "text"));
    if (field.type === "money") { input.step = "0.01"; input.min = "0"; }
    if (field.type === "int") { input.step = "1"; }
    if (field.type === "text" && field.label.includes("Açıklama")) input.maxLength = 2000;
    if (field.default !== null && field.default !== undefined) input.value = field.default;
    input.required = Boolean(field.required);
  }
  input.name = field.key;
  if (field.type === "bool") {
    wrapper.classList.add("check-label");
    wrapper.append(input, caption);
  } else {
    wrapper.append(caption, input);
  }
  if (field.hint && field.type !== "bool") {
    const hint = document.createElement("small");
    hint.className = "database-field-hint";
    hint.textContent = field.hint;
    wrapper.append(hint);
  }
  return wrapper;
}

function openDatabaseEditor(tableKey) {
  const table = databaseTables[tableKey];
  if (!table?.editor) return;
  databaseForm.reset();
  const fields = document.querySelector("#database-form-fields");
  fields.replaceChildren();
  table.editor.fields.forEach((field) => fields.append(buildDatabaseField(field)));
  document.querySelector("#database-dialog-title").textContent = `Yeni kayıt · ${table.label}`;
  document.querySelector("#database-dialog-note").textContent = tableKey === "customers"
    ? "Eklenen kişi mağaza üyesi olur ve belirtilen şifreyle giriş yapabilir."
    : "Kayıt doğrudan veritabanına eklenir.";
  databaseDialog.dataset.table = tableKey;
  databaseDialog.showModal();
}

async function loadView(view) {
  if (view === "dashboard") return loadDashboard();
  if (view === "products") {
    await Promise.all([loadProducts(), loadCategories()]);
    renderProducts();
  }
  if (view === "categories") {
    await loadCategories();
    renderCategories();
  }
  if (view === "orders") {
    const { orders } = await api("/api/admin/orders");
    renderOrderRows(orders, document.querySelector("#orders-table"));
  }
  if (view === "customers") {
    const { customers } = await api("/api/admin/customers");
    renderCustomers(customers);
  }
  if (view === "reviews") {
    const { reviews, pending } = await api("/api/admin/reviews");
    renderReviews(reviews, pending);
  }
  if (view === "coupons") {
    await loadCoupons();
    renderCoupons();
  }
  if (view === "database") {
    const { tables, references } = await api("/api/admin/database");
    renderDatabase(tables, references);
  }
}

function updateProductCategoryOptions(selectedId) {
  const select = productForm.elements.categoryId;
  select.replaceChildren();
  adminCategories.filter((category) => category.active).forEach((category) => {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.name;
    option.selected = Number(selectedId) === category.id;
    select.append(option);
  });
}

function openProductEditor(product = null) {
  productForm.reset();
  productForm.elements.id.value = product?.id || "";
  productForm.elements.name.value = product?.name || "";
  productForm.elements.sku.value = product?.sku || "";
  productForm.elements.price.value = product?.price ?? "";
  productForm.elements.compareAtPrice.value = product?.compare_at_price ?? "";
  productForm.elements.stock.value = product?.stock ?? 0;
  productForm.elements.badge.value = product?.badge || "";
  productForm.elements.description.value = product?.description || "";
  productForm.elements.active.checked = product ? product.active : true;
  document.querySelector("#product-dialog-title").textContent = product ? "Ürünü düzenle" : "Yeni ürün";
  updateProductCategoryOptions(product?.category_id);
  productDialog.showModal();
}

function openCategoryEditor(category = null) {
  categoryForm.reset();
  delete categoryForm.elements.slug.dataset.manual;
  categoryForm.elements.id.value = category?.id || "";
  categoryForm.elements.name.value = category?.name || "";
  categoryForm.elements.slug.value = category?.slug || "";
  categoryForm.elements.description.value = category?.description || "";
  categoryForm.elements.sortOrder.value = category?.sort_order ?? adminCategories.length + 1;
  categoryForm.elements.active.checked = category ? category.active : true;
  document.querySelector("#category-dialog-title").textContent = category ? "Kategoriyi düzenle" : "Yeni kategori";
  categoryDialog.showModal();
}

function openCustomerEditor(customer) {
  customerForm.reset();
  customerForm.elements.id.value = customer.id;
  customerForm.elements.name.value = customer.name;
  customerForm.elements.email.value = customer.email;
  customerForm.elements.password.value = "";
  document.querySelector("#customer-dialog-title").textContent = `Hesabı düzenle · ${customer.name}`;
  customerDialog.showModal();
}

async function enterAdmin(admin) {
  loginScreen.hidden = true;
  appScreen.hidden = false;
  document.querySelector("#admin-name").textContent = admin.username;
  await loadDashboard();
}

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});
document.querySelectorAll("[data-open-view]").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.openView));
});
document.querySelector("#database-table-select").addEventListener("change", (event) => {
  renderDatabaseTable(event.currentTarget.value);
});
document.querySelector("#database-summary").addEventListener("click", (event) => {
  const card = event.target.closest("[data-database-table]");
  if (!card || !databaseTables[card.dataset.databaseTable]) return;
  const select = document.querySelector("#database-table-select");
  select.value = card.dataset.databaseTable;
  renderDatabaseTable(select.value);
});
document.querySelector("#database-add").addEventListener("click", () => {
  openDatabaseEditor(document.querySelector("#database-table-select").value);
});
document.querySelector("#database-rows").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-database-delete]");
  if (!button) return;
  const tableKey = button.dataset.databaseDelete;
  const isPerson = databaseTables[tableKey]?.editor?.deleteKind === "anonymize";
  const message = isPerson
    ? "Bu kişinin kişisel bilgileri anonimleştirilecek; oturum, sepet ve favorileri kaldırılacak. Sipariş geçmişi korunur. Devam edilsin mi?"
    : "Bu kayıt kalıcı olarak silinsin mi? Bu işlem geri alınamaz.";
  if (!window.confirm(message)) return;
  try {
    await api(`/api/admin/database/${tableKey}/${encodeURIComponent(button.dataset.databaseKey)}`, { method: "DELETE" });
    await loadView("database");
    toast(isPerson ? "Kişi anonimleştirildi." : "Kayıt silindi.");
  } catch (error) {
    toast(error.message);
  }
});
databaseForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = databaseForm.querySelector('button[type="submit"]');
  button.disabled = true;
  const tableKey = databaseDialog.dataset.table;
  const table = databaseTables[tableKey];
  const body = {};
  new FormData(databaseForm).forEach((value, key) => { body[key] = value; });
  table.editor.fields.forEach((field) => {
    if (field.type === "bool") body[field.key] = databaseForm.elements[field.key].checked;
  });
  try {
    await api(`/api/admin/database/${tableKey}`, { method: "POST", body });
    databaseDialog.close();
    await loadView("database");
    toast("Kayıt eklendi.");
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginMessage.textContent = "";
  const button = loginForm.querySelector("button[type=submit]");
  button.disabled = true;
  const values = new FormData(loginForm);
  try {
    const { admin } = await api("/api/admin/login", {
      method: "POST",
      body: { username: values.get("username"), password: values.get("password") }
    });
    loginForm.reset();
    await enterAdmin(admin);
  } catch (error) {
    loginMessage.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#admin-logout").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST", body: {} });
    appScreen.hidden = true;
    loginScreen.hidden = false;
  } catch (error) {
    toast(error.message);
  }
});

document.querySelector("#add-product").addEventListener("click", async () => {
  try {
    await loadCategories();
    openProductEditor();
  } catch (error) {
    toast(error.message);
  }
});
document.querySelector("#add-category").addEventListener("click", () => openCategoryEditor());

document.querySelector("#products-table").addEventListener("click", async (event) => {
  const editId = event.target.dataset.editProduct;
  const deleteId = event.target.dataset.deleteProduct;
  if (editId) {
    const product = adminProducts.find((item) => item.id === Number(editId));
    openProductEditor(product);
  }
  if (deleteId && window.confirm("Bu ürün kalıcı olarak silinsin mi?")) {
    try {
      await api(`/api/admin/products/${deleteId}`, { method: "DELETE" });
      await loadProducts();
      renderProducts();
      toast("Ürün silindi.");
    } catch (error) {
      toast(error.message);
    }
  }
});

document.querySelector("#categories-table").addEventListener("click", async (event) => {
  const editId = event.target.dataset.editCategory;
  const deleteId = event.target.dataset.deleteCategory;
  if (editId) {
    const category = adminCategories.find((item) => item.id === Number(editId));
    openCategoryEditor(category);
  }
  if (deleteId && window.confirm("Bu kategori kalıcı olarak silinsin mi?")) {
    try {
      await api(`/api/admin/categories/${deleteId}`, { method: "DELETE" });
      await loadCategories();
      renderCategories();
      toast("Kategori silindi.");
    } catch (error) {
      toast(error.message);
    }
  }
});

document.querySelector("#customers-table").addEventListener("click", async (event) => {
  const editId = event.target.dataset.editCustomer;
  const deleteId = event.target.dataset.deleteCustomer;
  if (editId) {
    try {
      const { customers } = await api("/api/admin/customers");
      const customer = customers.find((item) => item.id === Number(editId));
      if (customer) openCustomerEditor(customer);
    } catch (error) {
      toast(error.message);
    }
  }
  if (deleteId && window.confirm(
    "Hesabın kişisel bilgileri anonimleştirilecek; oturum, sepet ve favoriler kaldırılacak. Sipariş geçmişi raporlama için korunacak. Devam edilsin mi?"
  )) {
    try {
      await api(`/api/admin/customers/${deleteId}`, { method: "DELETE" });
      const { customers } = await api("/api/admin/customers");
      renderCustomers(customers);
      toast("Hesap anonimleştirildi; sipariş geçmişi korundu.");
    } catch (error) {
      toast(error.message);
    }
  }
});

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = productForm.querySelector('button[type="submit"]');
  button.disabled = true;
  const values = new FormData(productForm);
  const id = values.get("id");
  const body = {
    name: values.get("name"),
    sku: values.get("sku"),
    categoryId: Number(values.get("categoryId")),
    price: Number(values.get("price")),
    compareAtPrice: values.get("compareAtPrice"),
    stock: Number(values.get("stock")),
    badge: values.get("badge"),
    description: values.get("description"),
    active: values.has("active")
  };
  try {
    await api(id ? `/api/admin/products/${id}` : "/api/admin/products", {
      method: id ? "PATCH" : "POST",
      body
    });
    productDialog.close();
    await loadProducts();
    renderProducts();
    toast(id ? "Ürün güncellendi." : "Ürün eklendi.");
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});

customerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = customerForm.querySelector('button[type="submit"]');
  button.disabled = true;
  const values = new FormData(customerForm);
  const id = values.get("id");
  try {
    await api(`/api/admin/customers/${id}`, {
      method: "PATCH",
      body: {
        name: values.get("name"),
        email: values.get("email"),
        password: values.get("password")
      }
    });
    customerDialog.close();
    const { customers } = await api("/api/admin/customers");
    renderCustomers(customers);
    toast("Müşteri hesabı güncellendi.");
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});

categoryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = categoryForm.querySelector('button[type="submit"]');
  button.disabled = true;
  const values = new FormData(categoryForm);
  const id = values.get("id");
  const body = {
    name: values.get("name"),
    slug: values.get("slug"),
    description: values.get("description"),
    sortOrder: Number(values.get("sortOrder")),
    active: values.has("active")
  };
  try {
    await api(id ? `/api/admin/categories/${id}` : "/api/admin/categories", {
      method: id ? "PATCH" : "POST",
      body
    });
    categoryDialog.close();
    await loadCategories();
    renderCategories();
    toast(id ? "Kategori güncellendi." : "Kategori eklendi.");
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#reviews-table").addEventListener("click", async (event) => {
  const approveId = event.target.dataset.approveReview;
  const rejectId = event.target.dataset.rejectReview;
  const deleteId = event.target.dataset.deleteReview;
  try {
    if (approveId) {
      await api(`/api/admin/reviews/${approveId}`, { method: "PATCH", body: { status: "approved" } });
      await loadView("reviews");
      toast("Yorum yayına alındı.");
    } else if (rejectId) {
      await api(`/api/admin/reviews/${rejectId}`, { method: "PATCH", body: { status: "rejected" } });
      await loadView("reviews");
      toast("Yorum reddedildi.");
    } else if (deleteId && window.confirm("Bu yorum kalıcı olarak silinsin mi?")) {
      await api(`/api/admin/reviews/${deleteId}`, { method: "DELETE" });
      await loadView("reviews");
      toast("Yorum silindi.");
    }
  } catch (error) {
    toast(error.message);
  }
});

document.querySelector("#add-coupon").addEventListener("click", () => openCouponEditor());

document.querySelector("#coupons-table").addEventListener("click", async (event) => {
  const editId = event.target.dataset.editCoupon;
  const deleteId = event.target.dataset.deleteCoupon;
  try {
    if (editId) {
      const coupon = adminCoupons.find((item) => String(item.id) === String(editId));
      if (coupon) openCouponEditor(coupon);
    } else if (deleteId && window.confirm("Bu kupon kalıcı olarak silinsin mi?")) {
      await api(`/api/admin/coupons/${deleteId}`, { method: "DELETE" });
      await loadView("coupons");
      toast("Kupon silindi.");
    }
  } catch (error) {
    toast(error.message);
  }
});

couponForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = couponForm.querySelector('button[type="submit"]');
  button.disabled = true;
  const values = new FormData(couponForm);
  const id = values.get("id");
  const body = {
    code: values.get("code"),
    discountType: values.get("discountType"),
    value: Number(values.get("value")),
    minOrder: values.get("minOrder"),
    usageLimit: Number(values.get("usageLimit")),
    expiresAt: values.get("expiresAt"),
    active: values.has("active")
  };
  try {
    await api(id ? `/api/admin/coupons/${id}` : "/api/admin/coupons", {
      method: id ? "PATCH" : "POST",
      body
    });
    couponDialog.close();
    await loadView("coupons");
    toast(id ? "Kupon güncellendi." : "Kupon eklendi.");
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#orders-table").addEventListener("change", async (event) => {
  const select = event.target.closest("[data-order-id]");
  if (!select) return;
  try {
    await api(`/api/admin/orders/${select.dataset.orderId}`, {
      method: "PATCH",
      body: { status: select.value }
    });
    toast("Sipariş durumu güncellendi.");
  } catch (error) {
    toast(error.message);
  }
});

document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog").close());
});
document.querySelectorAll(".editor-dialog").forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
});

categoryForm.elements.name.addEventListener("input", () => {
  if (categoryForm.elements.id.value || categoryForm.elements.slug.dataset.manual) return;
  categoryForm.elements.slug.value = categoryForm.elements.name.value
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
});
categoryForm.elements.slug.addEventListener("input", () => {
  categoryForm.elements.slug.dataset.manual = "true";
});

async function initialize() {
  try {
    const { admin } = await api("/api/session");
    if (admin) {
      await enterAdmin(admin);
      return;
    }
  } catch {
    loginMessage.textContent = "Sunucuya bağlanılamadı.";
  }
  loginScreen.hidden = false;
  appScreen.hidden = true;
}

initialize();
