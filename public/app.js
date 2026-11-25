const slides = [...document.querySelectorAll(".hero-slide")];
const dots = [...document.querySelectorAll(".hero-dot")];
const toast = document.querySelector("#toast");
const searchInput = document.querySelector("#search-input");
const navWrap = document.querySelector(".nav-wrap");
const categoryMenu = document.querySelector(".category-menu-wrap");
const accountDialog = document.querySelector("#account-dialog");
const cartDialog = document.querySelector("#cart-dialog");
const productDialog = document.querySelector("#product-dialog");
const authForm = document.querySelector("#auth-form");
const authView = document.querySelector("#auth-view");
const accountView = document.querySelector("#account-view");
const checkoutForm = document.querySelector("#checkout-form");
const categoryGrid = document.querySelector("#category-grid");
const productGrid = document.querySelector("#product-grid");
const dealsGrid = document.querySelector("#deals-grid");
const contactForm = document.querySelector("#contact-form");
const storefront = Boolean(productGrid);
const listingGrid = document.querySelector("#listing-grid");
const listingMode = Boolean(listingGrid);
const filterForm = document.querySelector("#filter-form");
const filterCategories = document.querySelector("#filter-categories");
const listingSort = document.querySelector("#listing-sort");
const listingPagination = document.querySelector("#listing-pagination");
const listingCount = document.querySelector("#listing-count");
const listingState = {
  q: "",
  kategori: "",
  minFiyat: "",
  maxFiyat: "",
  stokta: false,
  indirim: false,
  siralama: "newest",
  sayfa: 1
};
let categories = [];
let products = [];
const productIndex = new Map();
let activeSlide = 0;
let toastTimer;
let sliderTimer;
let authMode = "login";
let currentUser = null;
let currentAdmin = null;
let cart = { items: [], count: 0, total: 0 };
let favoriteProductIds = new Set();
let pendingCartAfterLogin = false;
let currentReviewProductId = null;
const freeShippingThreshold = 1500;

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

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2800);
}

function money(value) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(value);
}

function dateLabel(value) {
  if (!value) return "";
  return new Date(`${String(value).replace(" ", "T")}Z`).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  });
}

function starText(rating) {
  const filled = Math.max(0, Math.min(5, Math.round(rating)));
  return "★".repeat(filled) + "☆".repeat(5 - filled);
}

function showSlide(index) {
  if (!slides.length) return;
  activeSlide = (index + slides.length) % slides.length;
  slides.forEach((slide, slideIndex) => slide.classList.toggle("active", slideIndex === activeSlide));
  dots.forEach((dot, dotIndex) => {
    const selected = dotIndex === activeSlide;
    dot.classList.toggle("active", selected);
    dot.setAttribute("aria-selected", String(selected));
  });
}

function restartSlider() {
  clearInterval(sliderTimer);
  if (!slides.length) return;
  sliderTimer = setInterval(() => showSlide(activeSlide + 1), 6500);
}

const heroPrev = document.querySelector(".hero-prev");
const heroNext = document.querySelector(".hero-next");
if (heroPrev) heroPrev.addEventListener("click", () => {
  showSlide(activeSlide - 1);
  restartSlider();
});
if (heroNext) heroNext.addEventListener("click", () => {
  showSlide(activeSlide + 1);
  restartSlider();
});
dots.forEach((dot, index) => dot.addEventListener("click", () => {
  showSlide(index);
  restartSlider();
}));
restartSlider();

function categoryArt(slug) {
  const art = document.createElement("span");
  const contents = {
    arduino: ['<span class="arduino-board"><i></i><b>UNO</b><em>R3</em><u></u></span>', '<span class="mini-board"><i></i><b>UNO</b><em>R3</em></span>'],
    sensor: ['<span class="sensor-object"><i></i><b></b><em>HC-SR04</em></span>', '<span class="mini-sensor"><i></i><b></b></span>'],
    components: ['<span class="component-object"><i></i><b></b><em></em><u></u></span>', '<span class="mini-breadboard"><i></i><b></b></span>'],
    power: ['<span class="power-object"><i>+</i><b>18650</b><em>Li-ion</em></span>', '<span class="power-object"><i>+</i><b>18650</b><em>Li-ion</em></span>'],
    cables: ['<span class="cable-object"><i></i><b></b><em></em></span>', '<span class="cable-object"><i></i><b></b><em></em></span>'],
    tools: ['<span class="tool-object"><i></i><b></b><em>TS-100</em></span>', '<span class="tool-object"><i></i><b></b><em>TS-100</em></span>']
  };
  art.innerHTML = contents[slug]?.[0] || contents.components[0];
  return art;
}

function renderCategories(list = categories) {
  if (!categoryGrid) return;
  categoryGrid.replaceChildren();
  if (!list.length) {
    const empty = document.createElement("p");
    empty.className = "category-empty";
    empty.textContent = "Henüz görüntülenecek kategori yok.";
    categoryGrid.append(empty);
    return;
  }

  list.forEach((category, index) => {
    const card = document.createElement("a");
    card.className = `category-card category-${category.slug}`;
    card.href = `/urunler?kategori=${category.slug}`;
    card.dataset.categorySlug = category.slug;
    const number = document.createElement("span");
    number.className = "category-number";
    number.textContent = `${String(index + 1).padStart(2, "0")} / ${category.slug.toUpperCase()}`;
    const image = document.createElement("span");
    image.className = "category-image";
    image.append(categoryArt(category.slug));
    const name = document.createElement("span");
    name.className = "category-name";
    name.textContent = category.name;
    const meta = document.createElement("span");
    meta.className = "category-meta";
    meta.append(document.createTextNode(category.description || "Ürünleri keşfet"));
    const arrow = document.createElement("b");
    arrow.textContent = "↗";
    meta.append(arrow);
    card.append(number, image, name, meta);
    categoryGrid.append(card);
  });
}

function renderCategoryDropdown(list = categories) {
  const dropdown = document.querySelector("#category-dropdown");
  if (!dropdown) return;
  const symbols = ["⌁", "◉", "▤", "ϟ", "⌇", "⌘"];
  dropdown.replaceChildren();
  list.forEach((category, index) => {
    const link = document.createElement("a");
    link.href = `/urunler?kategori=${category.slug}`;
    const symbol = document.createElement("span");
    symbol.textContent = symbols[index % symbols.length];
    link.append(symbol, document.createTextNode(category.name));
    dropdown.append(link);
  });
}

function productArt(product) {
  const wrapper = document.createElement("div");
  wrapper.className = "product-visual";
  if (product.image) {
    const photo = document.createElement("img");
    photo.className = "product-photo";
    photo.src = product.image;
    photo.alt = product.name || "";
    photo.loading = "lazy";
    photo.decoding = "async";
    wrapper.append(photo);
    return wrapper;
  }
  const slug = product.category_slug;
  const sku = product.sku.toLowerCase();
  const shape = document.createElement("span");
  if (slug === "arduino" || sku.includes("uno")) {
    shape.className = "mini-board";
    shape.innerHTML = "<i></i><b>UNO</b><em>R3</em>";
  } else if (slug === "sensor" && sku.includes("dht")) {
    shape.className = "mini-dht";
    shape.innerHTML = "<i></i><b>DHT22</b>";
  } else if (slug === "sensor") {
    shape.className = "mini-sensor";
    shape.innerHTML = "<i></i><b></b>";
  } else if (slug === "components") {
    shape.className = "mini-breadboard";
    shape.innerHTML = "<i></i><b></b>";
  } else if (slug === "power") {
    shape.className = "power-object";
    shape.innerHTML = "<i>+</i><b>18650</b><em>Li-ion</em>";
  } else if (slug === "cables") {
    shape.className = "cable-object";
    shape.innerHTML = "<i></i><b></b><em></em>";
  } else {
    shape.className = "tool-object";
    shape.innerHTML = "<i></i><b></b><em>TS-100</em>";
  }
  wrapper.append(shape);
  return wrapper;
}

function createProductCard(product) {
  const card = document.createElement("article");
  card.className = "product-card";
  card.dataset.productId = product.id;
  const discounted = product.discount_percent > 0 && product.compare_at_price > 0;
  const badge = document.createElement("span");
  if (discounted) {
    badge.className = "product-badge badge-discount";
    badge.textContent = `%${product.discount_percent} İNDİRİM`;
  } else {
    badge.className = `product-badge${product.badge === "YENİ" ? " badge-new" : product.badge.includes("FAVORİ") ? " badge-neutral" : ""}`;
    badge.textContent = product.badge || "TUNÇ SEÇKİSİ";
  }
  const favorite = document.createElement("button");
  favorite.className = "favorite-button";
  favorite.type = "button";
  favorite.setAttribute("aria-label", "Favorilere ekle");
  const isFavorite = favoriteProductIds.has(product.id);
  favorite.classList.toggle("is-favorite", isFavorite);
  favorite.setAttribute("aria-pressed", String(isFavorite));
  favorite.textContent = isFavorite ? "♥" : "♡";
  const brand = document.createElement("span");
  brand.className = "product-brand";
  brand.textContent = product.sku;
  const title = document.createElement("h3");
  const detailLink = document.createElement("button");
  detailLink.className = "product-detail-trigger";
  detailLink.type = "button";
  detailLink.dataset.viewProductId = product.id;
  detailLink.textContent = product.name;
  title.append(detailLink);
  const rating = document.createElement("span");
  rating.className = "product-rating";
  if (product.rating_count > 0) {
    rating.append(document.createTextNode(starText(product.rating_average)));
    const count = document.createElement("small");
    count.textContent = ` ${product.rating_average.toFixed(1)} (${product.rating_count})`;
    rating.append(count);
  } else {
    rating.textContent = "Değerlendirme yok";
    rating.classList.add("is-empty");
  }
  const stock = document.createElement("small");
  stock.className = "product-stock";
  stock.textContent = product.stock > 0 ? `Stokta ${product.stock} adet` : "Stokta yok";
  const bottom = document.createElement("div");
  bottom.className = "product-bottom";
  const priceWrap = document.createElement("div");
  priceWrap.className = "product-price";
  const price = document.createElement("strong");
  price.textContent = money(product.price);
  priceWrap.append(price);
  if (discounted) {
    const compare = document.createElement("s");
    compare.className = "product-compare";
    compare.textContent = money(product.compare_at_price);
    priceWrap.append(compare);
  }
  const add = document.createElement("button");
  add.className = "add-cart";
  add.type = "button";
  add.dataset.addProductId = product.id;
  add.setAttribute("aria-label", `${product.name} sepete ekle`);
  add.textContent = "+";
  add.disabled = product.stock < 1;
  bottom.append(priceWrap, add);
  card.append(badge, favorite, productArt(product), brand, title, rating, stock, bottom);
  return card;
}

function renderProductGrid(list, grid, emptyText) {
  if (!grid) return;
  grid.replaceChildren();
  if (!list.length) {
    const empty = document.createElement("p");
    empty.className = "product-empty";
    empty.textContent = emptyText;
    grid.append(empty);
    return;
  }
  list.forEach((product) => grid.append(createProductCard(product)));
}

function renderProducts(list = products) {
  renderProductGrid(list, productGrid, "Aramana uygun ürün bulunamadı.");
}

function renderDeals() {
  const discounted = products.filter((product) => product.discount_percent > 0 && product.compare_at_price > 0);
  renderProductGrid(discounted, dealsGrid, "Şu an indirimli ürün bulunmuyor. Yeni fırsatlar için takipte kal.");
}

function indexProducts(list) {
  list.forEach((product) => productIndex.set(product.id, product));
}

function findProduct(id) {
  return productIndex.get(id) || products.find((product) => product.id === id);
}

function listingQuery() {
  const params = new URLSearchParams();
  if (listingState.q) params.set("q", listingState.q);
  if (listingState.kategori) params.set("kategori", listingState.kategori);
  if (listingState.minFiyat !== "") params.set("minFiyat", listingState.minFiyat);
  if (listingState.maxFiyat !== "") params.set("maxFiyat", listingState.maxFiyat);
  if (listingState.stokta) params.set("stokta", "1");
  if (listingState.indirim) params.set("indirim", "1");
  if (listingState.siralama !== "newest") params.set("siralama", listingState.siralama);
  if (listingState.sayfa > 1) params.set("sayfa", String(listingState.sayfa));
  return params;
}

function syncListingUrl() {
  const query = listingQuery().toString();
  window.history.replaceState(null, "", query ? `/urunler?${query}` : "/urunler");
}

function syncFilterInputs() {
  const min = document.querySelector("#filter-min-price");
  const max = document.querySelector("#filter-max-price");
  const inStock = document.querySelector("#filter-in-stock");
  const onSale = document.querySelector("#filter-on-sale");
  if (min) min.value = listingState.minFiyat;
  if (max) max.value = listingState.maxFiyat;
  if (inStock) inStock.checked = listingState.stokta;
  if (onSale) onSale.checked = listingState.indirim;
  if (listingSort) listingSort.value = listingState.siralama;
  if (searchInput) searchInput.value = listingState.q;
}

function renderListingCategories() {
  if (!filterCategories) return;
  filterCategories.replaceChildren();
  const options = [{ slug: "", name: "Tüm kategoriler" }, ...categories];
  options.forEach((option) => {
    const label = document.createElement("label");
    label.className = "filter-option";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "kategori";
    input.value = option.slug;
    input.checked = option.slug === listingState.kategori;
    label.append(input, document.createTextNode(option.name));
    filterCategories.append(label);
  });
}

function pageWindow(page, pages) {
  const marks = [];
  for (let index = 1; index <= pages; index += 1) {
    if (index === 1 || index === pages || Math.abs(index - page) <= 1) marks.push(index);
  }
  const output = [];
  let previous = 0;
  marks.forEach((value) => {
    if (previous && value - previous > 1) output.push("...");
    output.push(value);
    previous = value;
  });
  return output;
}

function renderPagination(result) {
  if (!listingPagination) return;
  listingPagination.replaceChildren();
  if (result.pages <= 1) return;
  const makeButton = (label, page, { current = false, disabled = false } = {}) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "page-button";
    button.textContent = label;
    if (current) {
      button.classList.add("is-current");
      button.setAttribute("aria-current", "page");
    }
    if (disabled) button.disabled = true;
    else if (!current) button.addEventListener("click", () => goToPage(page));
    return button;
  };
  listingPagination.append(makeButton("‹ Önceki", result.page - 1, { disabled: result.page <= 1 }));
  pageWindow(result.page, result.pages).forEach((entry) => {
    if (entry === "...") {
      const gap = document.createElement("span");
      gap.className = "page-gap";
      gap.textContent = "…";
      listingPagination.append(gap);
    } else {
      listingPagination.append(makeButton(String(entry), entry, { current: entry === result.page }));
    }
  });
  listingPagination.append(makeButton("Sonraki ›", result.page + 1, { disabled: result.page >= result.pages }));
}

function renderListingHeader(result) {
  const category = categories.find((item) => item.slug === listingState.kategori);
  const title = document.querySelector("#listing-title");
  if (title) {
    const heading = listingState.q
      ? `"${listingState.q}" araması`
      : category ? category.name : "Tüm ürünler";
    const dot = document.createElement("span");
    dot.textContent = ".";
    title.replaceChildren(document.createTextNode(heading), dot);
  }
  const subtitle = document.querySelector("#listing-subtitle");
  if (subtitle) {
    subtitle.textContent = category?.description
      || (listingState.q
        ? "Arama sonuçlarını aşağıdaki filtrelerle daraltabilirsin."
        : "Aradığın komponenti kategori, fiyat ve stok durumuna göre filtrele.");
  }
  if (listingCount) {
    listingCount.textContent = result.total === 0
      ? "Kriterlere uygun ürün yok"
      : `${result.total} ürün · Sayfa ${result.page}/${result.pages}`;
  }
}

function applyFilters() {
  listingState.kategori = filterForm?.elements.kategori?.value || "";
  listingState.minFiyat = document.querySelector("#filter-min-price")?.value.trim() ?? "";
  listingState.maxFiyat = document.querySelector("#filter-max-price")?.value.trim() ?? "";
  listingState.stokta = Boolean(document.querySelector("#filter-in-stock")?.checked);
  listingState.indirim = Boolean(document.querySelector("#filter-on-sale")?.checked);
  listingState.sayfa = 1;
  loadListing();
}

async function loadListing() {
  const params = listingQuery();
  params.set("limit", "12");
  let result;
  try {
    result = await api(`/api/products?${params.toString()}`);
  } catch (error) {
    showToast(error.message);
    return;
  }
  listingState.sayfa = result.page;
  categories = result.categories;
  products = result.products;
  indexProducts(result.products);
  renderCategoryDropdown();
  renderListingCategories();
  renderProductGrid(result.products, listingGrid, "Aradığın kriterlere uygun ürün bulunamadı.");
  renderListingHeader(result);
  renderPagination(result);
  syncListingUrl();
}

function goToPage(page) {
  listingState.sayfa = page;
  loadListing().then(() => {
    document.querySelector("#listing-page")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function renderProductGallery(product) {
  const container = document.querySelector("#product-detail-art");
  const images = Array.isArray(product.images) ? product.images : [];
  if (!images.length) {
    container.replaceChildren(productArt(product));
    return;
  }
  container.replaceChildren();
  const gallery = document.createElement("div");
  gallery.className = "product-gallery";
  const frame = document.createElement("div");
  frame.className = "gallery-frame";
  const main = document.createElement("img");
  main.className = "gallery-main";
  main.src = images[0].url;
  main.alt = images[0].alt || product.name || "";
  const counter = document.createElement("span");
  counter.className = "gallery-counter";
  counter.textContent = `1 / ${images.length}`;
  frame.append(main, counter);
  const thumbs = document.createElement("div");
  thumbs.className = "gallery-thumbs";
  images.forEach((image, index) => {
    const thumb = document.createElement("button");
    thumb.type = "button";
    thumb.className = "gallery-thumb";
    thumb.classList.toggle("is-active", index === 0);
    thumb.dataset.galleryIndex = index;
    thumb.setAttribute("aria-label", `${product.name || "Ürün"} görsel ${index + 1}`);
    const img = document.createElement("img");
    img.src = image.url;
    img.alt = image.alt || "";
    img.loading = "lazy";
    img.decoding = "async";
    thumb.append(img);
    thumbs.append(thumb);
  });
  thumbs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-gallery-index]");
    if (!button) return;
    const index = Number(button.dataset.galleryIndex);
    if (!images[index]) return;
    main.src = images[index].url;
    main.alt = images[index].alt || product.name || "";
    counter.textContent = `${index + 1} / ${images.length}`;
    thumbs.querySelectorAll(".gallery-thumb").forEach((item) => item.classList.toggle("is-active", item === button));
  });
  gallery.append(frame, thumbs);
  container.append(gallery);
}

function openProductDetails(product) {
  renderProductGallery(product);
  document.querySelector("#product-detail-sku").textContent = product.sku;
  document.querySelector("#product-detail-title").textContent = product.name;
  document.querySelector("#product-detail-category").textContent = product.category_name;
  document.querySelector("#product-detail-description").textContent =
    product.description || "Bu ürün için açıklama henüz eklenmemiş.";
  const priceEl = document.querySelector("#product-detail-price");
  priceEl.replaceChildren(document.createTextNode(money(product.price)));
  if (product.discount_percent > 0 && product.compare_at_price > 0) {
    const compare = document.createElement("s");
    compare.className = "product-compare";
    compare.textContent = money(product.compare_at_price);
    priceEl.append(" ", compare);
  }
  document.querySelector("#product-detail-stock").textContent =
    product.stock > 0 ? `Stokta ${product.stock} adet` : "Şu an stokta yok";
  const ratingEl = document.querySelector("#product-detail-rating");
  if (ratingEl) {
    ratingEl.textContent = product.rating_count > 0
      ? `${starText(product.rating_average)} ${product.rating_average.toFixed(1)} · ${product.rating_count} değerlendirme`
      : "Henüz değerlendirme yok";
  }
  const addButton = document.querySelector("#product-detail-add");
  addButton.dataset.addProductId = product.id;
  addButton.disabled = product.stock < 1;
  currentReviewProductId = product.id;
  resetReviewForm();
  productDialog.showModal();
  loadProductReviews(product.id);
}

function resetReviewForm() {
  const form = document.querySelector("#review-form");
  if (!form) return;
  form.reset();
  form.elements.rating.value = "5";
  updateRatingStars(5);
  form.hidden = true;
  const note = document.querySelector("#review-note");
  if (note) note.textContent = "";
  const list = document.querySelector("#review-list");
  if (list) list.replaceChildren();
  const summary = document.querySelector("#reviews-summary");
  if (summary) summary.textContent = "Yükleniyor…";
}

function updateRatingStars(value) {
  const container = document.querySelector("#rating-input");
  if (!container) return;
  container.querySelectorAll(".rating-star").forEach((star) => {
    star.classList.toggle("is-active", Number(star.dataset.value) <= Number(value));
  });
}

function renderReviewList(data) {
  const list = document.querySelector("#review-list");
  if (!list) return;
  list.replaceChildren();
  const summary = document.querySelector("#reviews-summary");
  if (summary) {
    summary.textContent = data.count
      ? `${data.average.toFixed(1)} / 5 · ${data.count} değerlendirme`
      : "Henüz değerlendirme yok";
  }
  if (!data.reviews.length) {
    const empty = document.createElement("p");
    empty.className = "review-empty";
    empty.textContent = "İlk değerlendirmeyi sen yap.";
    list.append(empty);
    return;
  }
  data.reviews.forEach((review) => {
    const item = document.createElement("article");
    item.className = "review-item";
    const head = document.createElement("div");
    head.className = "review-item-head";
    const name = document.createElement("strong");
    name.textContent = review.author_name;
    const stars = document.createElement("span");
    stars.className = "review-stars";
    stars.textContent = starText(review.rating);
    head.append(name, stars);
    item.append(head);
    if (review.body) {
      const body = document.createElement("p");
      body.textContent = review.body;
      item.append(body);
    }
    const meta = document.createElement("small");
    meta.className = "review-meta";
    meta.textContent = dateLabel(review.created_at);
    if (review.status === "pending") {
      const pending = document.createElement("b");
      pending.className = "review-pending";
      pending.textContent = "Onay bekliyor";
      meta.append(" · ", pending);
    }
    item.append(meta);
    list.append(item);
  });
}

async function loadProductReviews(productId) {
  const form = document.querySelector("#review-form");
  const note = document.querySelector("#review-note");
  let data;
  try {
    data = await api(`/api/products/${productId}/reviews`);
  } catch (error) {
    showToast(error.message);
    return;
  }
  renderReviewList(data);
  if (!form) return;
  if (data.canReview) {
    form.hidden = false;
    if (data.mine) {
      form.elements.rating.value = String(data.mine.rating);
      form.elements.body.value = data.mine.body || "";
      updateRatingStars(data.mine.rating);
    }
    if (note) {
      note.textContent = data.mine
        ? "Değerlendirmen alındı. Metni güncelleyip yeniden gönderebilirsin."
        : "Yorumun onaylandıktan sonra yayınlanır.";
    }
  } else {
    form.hidden = true;
    if (note) note.textContent = "Değerlendirme yapmak için üye girişi yapmalısın.";
  }
}

function updateCartCount() {
  document.querySelector("#cart-count").textContent = cart.count;
}

function renderCart() {
  const container = document.querySelector("#cart-items");
  container.replaceChildren();
  if (!cart.items.length) {
    const empty = document.createElement("p");
    empty.className = "cart-empty";
    empty.textContent = "Sepetinde henüz ürün yok. Birkaç parçaya göz atalım mı?";
    container.append(empty);
  }
  cart.items.forEach((item) => {
    const row = document.createElement("article");
    row.className = "cart-item";
    row.dataset.cartItemId = item.id;
    const name = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = item.name;
    const sku = document.createElement("small");
    sku.textContent = `${item.sku} · ${money(item.price)} / adet`;
    name.append(title, sku);
    const subtotal = document.createElement("strong");
    subtotal.textContent = money(item.line_total);
    const controls = document.createElement("div");
    controls.className = "cart-item-controls";
    const minus = document.createElement("button");
    minus.type = "button";
    minus.dataset.quantity = Math.max(1, item.quantity - 1);
    minus.setAttribute("aria-label", "Adedi azalt");
    minus.textContent = "−";
    const quantity = document.createElement("span");
    quantity.textContent = item.quantity;
    const plus = document.createElement("button");
    plus.type = "button";
    plus.dataset.quantity = item.quantity + 1;
    plus.setAttribute("aria-label", "Adedi artır");
    plus.textContent = "+";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-cart-item";
    remove.dataset.removeCartItem = item.id;
    remove.textContent = "Kaldır";
    controls.append(minus, quantity, plus, remove);
    row.append(name, subtotal, controls);
    container.append(row);
  });
  document.querySelector("#cart-total").textContent = money(cart.total);
  updateCartCount();
  const hasItems = cart.items.length > 0;
  const discount = cart.discount || 0;
  const couponBox = document.querySelector("#cart-coupon");
  if (couponBox) couponBox.hidden = !hasItems;
  const discountRow = document.querySelector("#cart-discount");
  if (discountRow) {
    discountRow.hidden = discount <= 0;
    const discountValue = document.querySelector("#cart-discount-value");
    if (discountValue) discountValue.textContent = `−${money(discount)}`;
  }
  const grandRow = document.querySelector("#cart-grand");
  if (grandRow) {
    grandRow.hidden = discount <= 0;
    const grandValue = document.querySelector("#cart-grand-value");
    if (grandValue) grandValue.textContent = money(cart.grand_total ?? cart.total);
  }
  const couponForm = document.querySelector("#coupon-form");
  const couponApplied = document.querySelector("#coupon-applied");
  const couponMessage = document.querySelector("#coupon-message");
  if (couponForm) couponForm.hidden = !hasItems || Boolean(cart.coupon);
  if (couponApplied) {
    couponApplied.hidden = !cart.coupon;
    if (cart.coupon) document.querySelector("#coupon-applied-code").textContent = cart.coupon.code;
  }
  if (!cart.coupon && couponMessage) couponMessage.textContent = "";
  const shippingMeter = document.querySelector("#shipping-meter");
  const shippingMessage = document.querySelector("#shipping-message");
  const shippingTrack = document.querySelector("#shipping-track");
  const shippingProgress = document.querySelector("#shipping-progress");
  const shippingProgressLabel = document.querySelector("#shipping-progress-label");
  const progressAmount = Math.min(freeShippingThreshold, cart.total);
  const progressPercent = Math.round((progressAmount / freeShippingThreshold) * 100);
  const remainingForFreeShipping = Math.max(0, freeShippingThreshold - cart.total);
  shippingMeter.hidden = !hasItems;
  shippingMessage.textContent = remainingForFreeShipping
    ? `Ücretsiz kargo için ${money(remainingForFreeShipping)} daha ekle.`
    : "Harika, siparişin ücretsiz kargo kazandı.";
  shippingProgressLabel.textContent = `${progressPercent}%`;
  shippingTrack.setAttribute("aria-valuenow", String(Math.round(progressAmount)));
  shippingTrack.setAttribute("aria-valuetext", remainingForFreeShipping
    ? `${money(remainingForFreeShipping)} daha eklenirse ücretsiz kargo`
    : "Ücretsiz kargo kazanıldı");
  shippingProgress.style.width = `${progressPercent}%`;
  document.querySelector("#cart-login-note").hidden = !hasItems || Boolean(currentUser);
  document.querySelector("#cart-login").hidden = !hasItems || Boolean(currentUser);
  checkoutForm.hidden = !hasItems || !currentUser;
  if (currentUser) checkoutForm.elements.recipientName.value ||= currentUser.name;
}

function setUser(user) {
  currentUser = user;
  const label = document.querySelector("#account-button span:nth-of-type(1)");
  label.textContent = user ? user.name.split(/\s+/)[0] : "Giriş Yap";
  label.title = user?.name || "";
  renderCart();
}

function setAuthMode(mode) {
  authMode = mode;
  const registering = mode === "register";
  document.querySelector("#auth-name-wrap").hidden = !registering;
  authForm.elements.name.required = registering;
  authForm.elements.password.autocomplete = registering ? "new-password" : "current-password";
  document.querySelector("#auth-title").textContent = registering ? "Aramıza katıl." : "Tekrar hoş geldin.";
  document.querySelector("#auth-description").textContent = registering
    ? "Üyeliğini oluştur, siparişlerini kolayca takip et."
    : "Siparişlerini takip etmek için hesabına giriş yap.";
  document.querySelector("#auth-submit").innerHTML = registering ? "Kayıt Ol <span>→</span>" : "Giriş Yap <span>→</span>";
  document.querySelector("#switch-auth").innerHTML = registering
    ? "Zaten üye misin? <b>Giriş yap</b>"
    : "Hesabın yok mu? <b>Kayıt ol</b>";
}

function openAccountDialog() {
  authView.hidden = Boolean(currentUser);
  accountView.hidden = !currentUser;
  if (currentUser) loadOrders();
  else setAuthMode("login");
  accountDialog.showModal();
}

async function loadOrders() {
  const list = document.querySelector("#account-orders");
  document.querySelector("#account-heading").textContent = `Merhaba, ${currentUser.name.split(/\s+/)[0]}.`;
  document.querySelector("#account-email").textContent = currentUser.email;
  list.replaceChildren();
  try {
    const { orders } = await api("/api/orders");
    if (!orders.length) {
      const empty = document.createElement("div");
      empty.className = "account-empty";
      empty.textContent = "Henüz siparişin yok.";
      list.append(empty);
    }
    orders.forEach((order) => {
      const item = document.createElement("div");
      item.className = "account-order";
      const number = document.createElement("strong");
      number.textContent = order.order_number;
      const detail = document.createElement("span");
      detail.textContent = `${order.item_count} ürün · ${money(order.total)} · ${order.status}`;
      item.append(number, detail);
      list.append(item);
    });
  } catch (error) {
    showToast(error.message);
  }
}

async function refreshCart() {
  const result = await api("/api/cart");
  cart = result;
  renderCart();
}

async function addProductToCart(productId, button) {
  button.disabled = true;
  try {
    cart = await api("/api/cart/items", {
      method: "POST",
      body: { productId, quantity: 1 }
    });
    renderCart();
    const product = findProduct(productId);
    showToast(`${product?.name || "Ürün"} sepete eklendi.`);
    return true;
  } catch (error) {
    showToast(error.message);
    return false;
  } finally {
    button.disabled = false;
  }
}

function openCart() {
  refreshCart().then(() => cartDialog.showModal()).catch((error) => showToast(error.message));
}

async function loadCatalog() {
  const result = await api("/api/catalog");
  categories = result.categories;
  products = result.products;
  indexProducts(result.products);
  renderCategories();
  renderProducts();
  renderDeals();
}

function handleGridClick(event) {
  const detailButton = event.target.closest("[data-view-product-id]");
  if (detailButton) {
    const product = findProduct(Number(detailButton.dataset.viewProductId));
    if (product) openProductDetails(product);
    return;
  }
  const addButton = event.target.closest("[data-add-product-id]");
  if (addButton) {
    addProductToCart(Number(addButton.dataset.addProductId), addButton);
    return;
  }
  const favoriteButton = event.target.closest(".favorite-button");
  if (favoriteButton) toggleFavorite(favoriteButton);
}

async function toggleFavorite(button) {
  const productId = Number(button.closest("[data-product-id]").dataset.productId);
  try {
    const result = await api("/api/favorites", { method: "POST", body: { productId } });
    if (result.active) favoriteProductIds.add(productId);
    else favoriteProductIds.delete(productId);
    button.classList.toggle("is-favorite", result.active);
    button.textContent = result.active ? "♥" : "♡";
    button.setAttribute("aria-pressed", String(result.active));
    showToast(result.active ? "Ürün favorilerine eklendi." : "Ürün favorilerinden çıkarıldı.");
  } catch (error) {
    showToast(error.message);
  }
}

const searchForm = document.querySelector("#search-form");
if (searchForm) searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = searchInput.value.trim();
  if (listingMode) {
    listingState.q = query;
    listingState.sayfa = 1;
    await loadListing();
    return;
  }
  if (!storefront) {
    window.location.href = query ? `/urunler?q=${encodeURIComponent(query)}` : "/urunler";
    return;
  }
  if (!query) {
    renderProducts();
    searchInput.focus();
    return;
  }
  try {
    const result = await api(`/api/catalog?q=${encodeURIComponent(query)}`);
    renderProducts(result.products);
    document.querySelector("#yeni-urunler").scrollIntoView({ behavior: "smooth" });
    showToast(result.products.length ? `${result.products.length} ürün listelendi.` : "Aramana uygun ürün bulunamadı.");
  } catch (error) {
    showToast(error.message);
  }
});

[productGrid, dealsGrid, listingGrid].forEach((grid) => {
  if (grid) grid.addEventListener("click", handleGridClick);
});

const productDetailAdd = document.querySelector("#product-detail-add");
if (productDetailAdd) productDetailAdd.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const added = await addProductToCart(Number(button.dataset.addProductId), button);
  if (added) productDialog.close();
});

const reviewForm = document.querySelector("#review-form");
const ratingInput = document.querySelector("#rating-input");
if (ratingInput) ratingInput.addEventListener("click", (event) => {
  const star = event.target.closest(".rating-star");
  if (!star) return;
  reviewForm.elements.rating.value = star.dataset.value;
  updateRatingStars(star.dataset.value);
});

if (reviewForm) reviewForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentReviewProductId) return;
  const rating = Number(reviewForm.elements.rating.value) || 0;
  if (rating < 1) {
    showToast("Lütfen bir puan seç.");
    return;
  }
  const button = reviewForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api(`/api/products/${currentReviewProductId}/reviews`, {
      method: "POST",
      body: { rating, body: reviewForm.elements.body.value }
    });
    showToast("Değerlendirmen alındı, onaydan sonra yayınlanacak.");
    await loadProductReviews(currentReviewProductId);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#cart-items").addEventListener("click", async (event) => {
  const row = event.target.closest("[data-cart-item-id]");
  if (!row) return;
  try {
    if (event.target.matches("[data-remove-cart-item]")) {
      cart = await api(`/api/cart/items/${event.target.dataset.removeCartItem}`, { method: "DELETE" });
    } else if (event.target.dataset.quantity) {
      cart = await api(`/api/cart/items/${row.dataset.cartItemId}`, {
        method: "PATCH",
        body: { quantity: Number(event.target.dataset.quantity) }
      });
    } else {
      return;
    }
    renderCart();
  } catch (error) {
    showToast(error.message);
  }
});

const couponForm = document.querySelector("#coupon-form");
if (couponForm) {
  couponForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = document.querySelector("#coupon-message");
    const input = couponForm.querySelector("input[name=code]");
    const code = input.value.trim();
    if (!code) return;
    const button = couponForm.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      cart = await api("/api/cart/coupon", { method: "POST", body: { code } });
      renderCart();
      couponForm.reset();
      showToast("Kupon uygulandı.");
    } catch (error) {
      if (message) message.textContent = error.message;
      else showToast(error.message);
    } finally {
      button.disabled = false;
    }
  });
}

const couponRemove = document.querySelector("#coupon-remove");
if (couponRemove) {
  couponRemove.addEventListener("click", async () => {
    try {
      cart = await api("/api/cart/coupon", { method: "DELETE" });
      renderCart();
      showToast("Kupon kaldırıldı.");
    } catch (error) {
      showToast(error.message);
    }
  });
}

document.querySelector("#cart-button").addEventListener("click", openCart);
document.querySelector("#account-button").addEventListener("click", openAccountDialog);
document.querySelector("#switch-auth").addEventListener("click", () => {
  setAuthMode(authMode === "login" ? "register" : "login");
});
document.querySelector("#cart-login").addEventListener("click", () => {
  pendingCartAfterLogin = true;
  cartDialog.close();
  setAuthMode("login");
  authView.hidden = false;
  accountView.hidden = true;
  accountDialog.showModal();
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(authForm);
  const button = document.querySelector("#auth-submit");
  button.disabled = true;
  try {
    const endpoint = authMode === "register" ? "/api/auth/register" : "/api/auth/login";
    const result = await api(endpoint, {
      method: "POST",
      body: {
        name: form.get("name"),
        email: form.get("email"),
        password: form.get("password")
      }
    });
    setUser(result.user);
    await refreshCart();
    accountDialog.close();
    showToast(authMode === "register" ? "Hesabın oluşturuldu." : "Giriş başarılı.");
    if (pendingCartAfterLogin) {
      pendingCartAfterLogin = false;
      cartDialog.showModal();
    }
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST", body: {} });
    setUser(null);
    currentAdmin = null;
    await refreshCart();
    accountDialog.close();
    showToast("Oturum kapatıldı.");
  } catch (error) {
    showToast(error.message);
  }
});

checkoutForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = checkoutForm.querySelector("button[type=submit]");
  button.disabled = true;
  const form = new FormData(checkoutForm);
  try {
    const result = await api("/api/orders", {
      method: "POST",
      body: {
        recipientName: form.get("recipientName"),
        phone: form.get("phone"),
        city: form.get("city"),
        address: form.get("address")
      }
    });
    cart = await api("/api/cart");
    renderCart();
    await loadCatalog();
    cartDialog.close();
    checkoutForm.reset();
    showToast(`Siparişin alındı. Sipariş no: ${result.orderNumber}`);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
});

const categoryToggle = document.querySelector("#category-toggle");
categoryToggle.addEventListener("click", () => {
  const isOpen = categoryMenu.classList.toggle("is-open");
  categoryToggle.setAttribute("aria-expanded", String(isOpen));
});
document.addEventListener("click", (event) => {
  if (!categoryMenu.classList.contains("is-open") || categoryMenu.contains(event.target)) return;
  categoryMenu.classList.remove("is-open");
  categoryToggle.setAttribute("aria-expanded", "false");
});
document.querySelector("#mobile-menu-toggle").addEventListener("click", (event) => {
  const isOpen = navWrap.classList.toggle("is-open");
  event.currentTarget.setAttribute("aria-expanded", String(isOpen));
});
document.querySelector("#nav-account").addEventListener("click", () => {
  navWrap.classList.remove("is-open");
  document.querySelector("#mobile-menu-toggle").setAttribute("aria-expanded", "false");
  openAccountDialog();
});
document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog").close());
});
document.querySelectorAll(".site-dialog").forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
});
document.querySelector(".notification-button").addEventListener("click", () => {
  showToast("Şu an yeni bildiriminiz yok.");
});

if (contactForm) contactForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = contactForm.querySelector('button[type="submit"]');
  const message = document.querySelector("#contact-message");
  button.disabled = true;
  message.classList.remove("is-success");
  const values = new FormData(contactForm);
  try {
    await api("/api/messages", {
      method: "POST",
      body: {
        name: values.get("name"),
        email: values.get("email"),
        body: values.get("body")
      }
    });
    contactForm.reset();
    message.textContent = "Mesajın bize ulaştı. En kısa sürede dönüş yapacağız.";
    message.classList.add("is-success");
    showToast("Mesajın gönderildi.");
  } catch (error) {
    message.textContent = error.message;
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
});

if (listingMode) {
  if (filterForm) {
    filterForm.addEventListener("submit", (event) => {
      event.preventDefault();
      applyFilters();
    });
    filterForm.addEventListener("change", (event) => {
      if (event.target.matches('input[type="radio"], input[type="checkbox"]')) applyFilters();
    });
  }
  document.querySelector("#filter-clear")?.addEventListener("click", () => {
    Object.assign(listingState, { q: "", kategori: "", minFiyat: "", maxFiyat: "", stokta: false, indirim: false, sayfa: 1 });
    syncFilterInputs();
    loadListing();
  });
  if (listingSort) listingSort.addEventListener("change", () => {
    listingState.siralama = listingSort.value;
    listingState.sayfa = 1;
    loadListing();
  });
}

async function initialize() {
  try {
    const session = await api("/api/session");
    currentUser = session.user;
    currentAdmin = session.admin;
    favoriteProductIds = new Set(session.favorites);
    cart = session.cart;
    setUser(currentUser);
    renderCart();

    if (listingMode) {
      const params = new URLSearchParams(window.location.search);
      listingState.q = params.get("q") || "";
      listingState.kategori = params.get("kategori") || "";
      listingState.minFiyat = params.get("minFiyat") || "";
      listingState.maxFiyat = params.get("maxFiyat") || "";
      listingState.stokta = params.get("stokta") === "1";
      listingState.indirim = params.get("indirim") === "1";
      listingState.siralama = params.get("siralama") || "newest";
      listingState.sayfa = Math.max(1, Number(params.get("sayfa")) || 1);
      syncFilterInputs();
      await loadListing();
      return;
    }

    const catalog = await api("/api/catalog");
    categories = catalog.categories;
    products = catalog.products;
    indexProducts(catalog.products);
    renderCategories();
    renderCategoryDropdown();
    renderProducts();
    renderDeals();
    const initialQuery = new URLSearchParams(window.location.search).get("q");
    if (storefront && initialQuery) {
      searchInput.value = initialQuery;
      const result = await api(`/api/catalog?q=${encodeURIComponent(initialQuery)}`);
      indexProducts(result.products);
      renderProducts(result.products);
      document.querySelector("#yeni-urunler").scrollIntoView({ behavior: "smooth" });
    }
  } catch (error) {
    showToast(error.message);
  }
}

initialize();
