// Public media only. Google Forms responses are never read by this page.
(() => {
  const gallery = document.getElementById("guest-gallery");
  const status = document.getElementById("guest-gallery-status");
  const retry = document.getElementById("guest-gallery-retry");
  const endpoint = window.GUEST_MOMENTS_CONFIG?.feedUrl;
  if (!gallery || !endpoint) return;
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint)) {
    status.textContent = "Our shared memories are not available yet. Please check back soon.";
    return;
  }
  const cards = new Map();
  let busy = false;
  let request = 0;

  function loadFeed() {
    return new Promise((resolve, reject) => {
      const callback = `guestMoments_${Date.now()}_${++request}`;
      const script = document.createElement("script");
      let timeout;
      const finish = (error, result) => {
        clearTimeout(timeout);
        script.remove();
        delete window[callback];
        if (error) reject(error); else resolve(result);
      };
      window[callback] = result => finish(null, result);
      script.onerror = () => finish(new Error("Feed unavailable"));
      const url = new URL(endpoint);
      url.searchParams.set("callback", callback);
      url.searchParams.set("t", Date.now());
      script.src = url.href;
      script.async = true;
      timeout = setTimeout(() => finish(new Error("Feed timed out")), 20000);
      document.head.append(script);
    });
  }

  function validateFeed(data) {
    if (!data || data.ok !== true || !Array.isArray(data.items) || data.items.length > 1000) {
      throw new Error("Incomplete feed");
    }
    const ids = new Set();
    return data.items.map(item => {
      if (!item || typeof item.id !== "string" || !/^[A-Za-z0-9_-]{10,200}$/.test(item.id)
        || !["photo", "video"].includes(item.type) || ids.has(item.id)
        || (item.resourceKey != null && (typeof item.resourceKey !== "string" || !/^[A-Za-z0-9_-]{0,200}$/.test(item.resourceKey)))) {
        throw new Error("Invalid media entry");
      }
      ids.add(item.id);
      return { id: item.id, type: item.type, resourceKey: item.resourceKey || "" };
    });
  }

  function driveUrl(path, item, params = {}) {
    const url = new URL(path, "https://drive.google.com");
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    if (item.resourceKey) url.searchParams.set("resourcekey", item.resourceKey);
    return url.href;
  }

  function createCard(item) {
    const card = document.createElement("article");
    card.className = "guest-memory";
    card.dataset.signature = `${item.type}:${item.resourceKey}`;
    const media = document.createElement(item.type === "video" ? "iframe" : "img");
    media.className = "guest-memory-media";
    media.loading = "lazy";
    if (item.type === "video") {
      media.src = driveUrl(`/file/d/${item.id}/preview`, item);
      media.title = "Wedding video shared by a guest";
      media.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
      media.allowFullscreen = true;
    } else {
      media.src = driveUrl("/thumbnail", item, { id: item.id, sz: "w1600" });
      media.alt = "Wedding photo shared by a guest";
      media.decoding = "async";
      // A failed preview is not proof that the file was deleted. Only the feed removes it.
      media.addEventListener("error", () => {
        media.hidden = true;
        const fallback = document.createElement("a");
        fallback.className = "guest-memory-fallback";
        fallback.href = driveUrl(`/file/d/${item.id}/view`, item);
        fallback.target = "_blank";
        fallback.rel = "noopener noreferrer";
        fallback.textContent = "Open photo";
        card.prepend(fallback);
      }, { once: true });
    }
    const download = document.createElement("a");
    download.className = "button guest-memory-download";
    download.href = driveUrl("/uc", item, { export: "download", id: item.id });
    download.target = "_blank";
    download.rel = "noopener noreferrer";
    download.textContent = item.type === "video" ? "Download video" : "Download photo";
    card.append(media, download);
    if (item.type === "video") {
      const open = document.createElement("a");
      open.className = "guest-memory-open";
      open.href = driveUrl(`/file/d/${item.id}/view`, item);
      open.target = "_blank";
      open.rel = "noopener noreferrer";
      open.textContent = "Watch on Google Drive";
      card.append(open);
    }
    return card;
  }

  function render(items) {
    const wanted = new Set(items.map(item => item.id));
    cards.forEach((card, id) => {
      if (!wanted.has(id)) {
        if (card.contains(document.activeElement)) document.getElementById("guest-gallery-heading").focus();
        card.remove();
        cards.delete(id);
      }
    });
    items.forEach((item, index) => {
      let card = cards.get(item.id);
      if (card && card.dataset.signature !== `${item.type}:${item.resourceKey}`) {
        card.remove(); cards.delete(item.id); card = null;
      }
      if (!card) { card = createCard(item); cards.set(item.id, card); }
      // Keep unchanged video frames mounted so polling does not interrupt playback.
      if (gallery.children[index] !== card) gallery.insertBefore(card, gallery.children[index] || null);
    });
    status.textContent = items.length ? "" : "Our shared memories will appear here soon.";
    status.hidden = items.length > 0;
  }

  async function refresh() {
    if (busy || document.hidden) return;
    busy = true;
    retry.disabled = true;
    gallery.setAttribute("aria-busy", "true");
    try {
      const items = validateFeed(await loadFeed());
      render(items);
      retry.hidden = true;
    } catch {
      // Never interpret a network/permission/quota error as an empty folder.
      status.hidden = false;
      status.textContent = cards.size
        ? "We couldn’t refresh the gallery. Some memories may have changed. Please try again."
        : "We couldn’t load the shared memories. Please try again shortly.";
      retry.hidden = false;
    } finally {
      busy = false;
      retry.disabled = false;
      gallery.removeAttribute("aria-busy");
    }
  }
  status.textContent = "Loading shared memories…";
  retry.addEventListener("click", refresh);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  window.addEventListener("online", refresh);
  setInterval(refresh, 60000);
  refresh();
})();
