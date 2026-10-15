// Edit page content, photos and links in index.html.
// The calendar and countdown read the wedding-date element's datetime attribute.
document.documentElement.classList.add("js");
// Reveal once on arrival. Content stays visible without animation support or JS.
(() => {
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (preference.matches || !("IntersectionObserver" in window) || !Element.prototype.animate) return;
  const running = new Map();
  const observer = new IntersectionObserver(entries => {
    let delay = 0;
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);
      if (entry.target.contains(document.activeElement)) return;
      const animation = entry.target.animate([
        { opacity: 0, transform: "translateY(24px)" },
        { opacity: 1, transform: "translateY(0)" }
      ], { duration: 850, delay, easing: "cubic-bezier(.2,.65,.3,1)", fill: "backwards" });
      running.set(entry.target, animation);
      animation.finished.then(() => running.delete(entry.target), () => running.delete(entry.target));
      delay = Math.min(delay + 55, 165);
    });
  }, { threshold: 0.08, rootMargin: "0px 0px -24px 0px" });
  let stopped = false;
  document.querySelectorAll(".section .eyebrow, .section h2, .section .intro, .portrait img, .venue, .timeline li, .swatch, .gallery img, .rsvp-layout, .closing-copy").forEach(element => {
    // Lazy photos must be loaded before their one-time reveal can start.
    // Observe the photo itself, not the space around it.
    const observe = () => { if (!stopped) observer.observe(element); };
    if (element.tagName === "IMG" && !element.complete) {
      element.addEventListener("load", observe, { once: true });
    } else {
      observe();
    }
  });
  // Keyboard navigation and motion preferences always take priority.
  document.addEventListener("focusin", event => {
    running.forEach((animation, element) => {
      if (element.contains(event.target)) animation.cancel();
    });
  });
  function stopMotion() {
    stopped = true;
    observer.disconnect();
    running.forEach(animation => animation.cancel());
    running.clear();
  }
  const preferenceChanged = event => { if (event.matches) stopMotion(); };
  if (preference.addEventListener) preference.addEventListener("change", preferenceChanged);
  else if (preference.addListener) preference.addListener(preferenceChanged);
  window.addEventListener("beforeprint", stopMotion);
})();
const weddingDate = document.getElementById("wedding-date")?.getAttribute("datetime");
    // Generate the save-the-date calendar using UTC to avoid date shifts.
    const date = new Date(weddingDate);
    if (!Number.isNaN(date.getTime())) {
      document.getElementById("calendar-month").textContent = date.toLocaleDateString("en-GB", {month: "long", year: "numeric", timeZone: "UTC"});
      const year = date.getUTCFullYear(), month = date.getUTCMonth();
      const offset = new Date(Date.UTC(year, month, 1)).getUTCDay();
      const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      const body = document.getElementById("calendar-days");
      body.replaceChildren();
      for (let row = 0; row < Math.ceil((offset + days) / 7); row++) {
        const tr = document.createElement("tr");
        for (let column = 0; column < 7; column++) {
          const day = row * 7 + column - offset + 1;
          const td = document.createElement("td");
          if (day > 0 && day <= days) {
            const span = document.createElement("span");
            span.textContent = day;
            if (day === date.getUTCDate()) {
              span.className = "chosen";
              span.setAttribute("aria-label", day + ", wedding day");
            }
            td.append(span);
          }
          tr.append(td);
        }
        body.append(tr);
      }
    }
    const menu = document.querySelector(".menu");
    const navigation = document.getElementById("navigation");
    function closeMenu() {
      menu.setAttribute("aria-expanded", "false");
      navigation.classList.remove("open");
    }
    menu.addEventListener("click", () => {
      const open = menu.getAttribute("aria-expanded") !== "true";
      menu.setAttribute("aria-expanded", String(open));
      navigation.classList.toggle("open", open);
    });
    navigation.addEventListener("click", event => {
      if (event.target.closest("a")) closeMenu();
    });
    navigation.addEventListener("keydown", event => {
      if (event.key === "Escape") { closeMenu(); menu.focus(); }
    });

// Ghana is UTC+00:00. The HTML datetime includes its timezone for all guests.
(() => {
  const clock = document.getElementById("countdown-clock");
  const message = document.getElementById("countdown-message");
  const target = Date.parse(weddingDate);
  if (!Number.isFinite(target)) return;
  const fields = ["days", "hours", "minutes", "seconds"].map(unit => document.getElementById(`countdown-${unit}`));
  let interval;
  function updateCountdown() {
    const remaining = Math.max(0, Math.ceil((target - Date.now()) / 1000));
    const values = [Math.floor(remaining / 86400), Math.floor(remaining % 86400 / 3600), Math.floor(remaining % 3600 / 60), remaining % 60];
    fields.forEach((field, index) => { field.textContent = String(values[index]).padStart(2, "0"); });
    clock.hidden = false;
    if (remaining === 0) {
      clearInterval(interval);
      if (message.hidden) {
        message.textContent = "The celebration has begun!";
        message.hidden = false;
      }
    }
  }
  updateCountdown();
  if (target > Date.now()) interval = setInterval(updateCountdown, 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) updateCountdown();
  });
})();
