// Edit page content, photos and links in index.html.
// The calendar and countdown read the wedding-date element's datetime attribute.
document.documentElement.classList.add("js");
// Motion follows the device preference unless the guest explicitly chooses otherwise.
(() => {
  const root = document.documentElement;
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  const toggle = document.getElementById("motion-toggle");
  let choice = null;
  try { choice = localStorage.getItem("wedding-motion"); } catch { /* Storage can be unavailable in private browsing. */ }
  let enabled = false;
  let observer;
  const inView = new Set();
  const targets = [...document.querySelectorAll(".section .eyebrow, .section h2, .section .intro, .portrait img, .venue, .timeline li, .swatch, .gallery img, .rsvp-layout, .closing-copy")];
  function stopReveals() {
    observer?.disconnect();
    targets.forEach(element => element.classList.remove("reveal-enter"));
    inView.clear();
  }
  function applyMotion() {
    stopReveals();
    enabled = choice === "on" || (choice !== "off" && !preference.matches);
    root.dataset.motion = enabled ? "on" : "off";
    toggle.textContent = enabled ? "Animations: on" : "Animations: off — tap to enable";
    toggle.setAttribute("aria-pressed", String(enabled));
    toggle.hidden = false;
    if (!enabled || !("IntersectionObserver" in window)) return;
    observer = new IntersectionObserver(entries => {
      let delay = 0;
      entries.forEach(entry => {
        const element = entry.target;
        if (!entry.isIntersecting) {
          element.classList.remove("reveal-enter");
          inView.delete(element);
          return;
        }
        // Start when a meaningful part of the content is visible, not at the first pixel.
        if (entry.intersectionRatio < 0.1 || inView.has(element)) return;
        inView.add(element);
        if (element.contains(document.activeElement)) return;
        element.style.setProperty("--reveal-delay", delay + "ms");
        element.classList.add("reveal-enter");
        delay = Math.min(delay + 70, 210);
      });
    }, { threshold: [0, 0.1], rootMargin: "0px 0px -16px 0px" });
    targets.forEach(element => {
      if (element.tagName !== "IMG" || element.complete) observer.observe(element);
    });
  }
  // Lazy images join the observer only once there is a photo to animate.
  targets.filter(element => element.tagName === "IMG").forEach(image => {
    image.addEventListener("load", () => { if (enabled && observer) observer.observe(image); });
  });
  document.addEventListener("focusin", event => {
    targets.forEach(element => {
      if (element.contains(event.target)) element.classList.remove("reveal-enter");
    });
  });
  toggle.addEventListener("click", () => {
    choice = enabled ? "off" : "on";
    try { localStorage.setItem("wedding-motion", choice); } catch { /* Keep the choice for this visit. */ }
    applyMotion();
  });
  const preferenceChanged = () => { if (choice !== "on" && choice !== "off") applyMotion(); };
  if (preference.addEventListener) preference.addEventListener("change", preferenceChanged);
  else if (preference.addListener) preference.addListener(preferenceChanged);
  window.addEventListener("beforeprint", stopReveals);
  window.addEventListener("afterprint", applyMotion);
  applyMotion();
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

// Attendance is confirmed only after the server saves the Excel register.
(() => {
  const form = document.getElementById("rsvp-form");
  const submit = document.getElementById("submit-rsvp");
  const confirmation = document.getElementById("confirmation");
  const name = document.getElementById("guest-name");
  const phone = document.getElementById("guest-phone");
  const api = new URL("./api/attendance", window.location.href);
  let busy = false;
  let confirmed = false;
  let requestId = null;
  function showStatus(message, error = false) {
    confirmation.textContent = message;
    confirmation.classList.toggle("error", error);
    confirmation.hidden = false;
  }
  form.addEventListener("input", () => {
    if (busy) return;
    confirmed = false;
    requestId = null;
    submit.disabled = false;
    submit.textContent = "Confirm Attendance";
    confirmation.hidden = true;
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || confirmed || !form.reportValidity()) return;
    if (!name.value.trim()) {
      showStatus("Please enter your name.", true);
      name.focus();
      return;
    }
    const digits = phone.value.replace(/\D/g, "");
    if (!/^\+?[0-9() .-]{7,30}$/.test(phone.value.trim()) || digits.length < 7 || digits.length > 15) {
      showStatus("Please enter a valid phone number, including your country code.", true);
      phone.focus();
      return;
    }
    if (window.location.protocol === "file:") {
      showStatus("Please open the invitation using its website link to confirm attendance, or call one of the contacts listed.", true);
      return;
    }
    requestId ||= newRequestId();
    const details = {name: name.value.trim(), phone: phone.value.trim()};
    busy = true;
    form.setAttribute("aria-busy", "true");
    name.disabled = phone.disabled = submit.disabled = true;
    submit.textContent = "Confirming…";
    showStatus("Saving your attendance…");
    try {
      const response = await fetch(api, {
        method: "POST",
        headers: {"Content-Type": "application/json", "X-Wedding-Attendance": "1", "X-Confirmation-ID": requestId},
        body: JSON.stringify(details),
        signal: AbortSignal.timeout(30000)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.saved) throw new Error(result.error || "Your attendance could not be saved. Please try again.");
      confirmed = true;
      showStatus("Thank you, " + details.name + "! Your attendance is confirmed. We look forward to celebrating with you.");
    } catch (error) {
      showStatus(error.name === "TypeError" || error.name === "TimeoutError"
        ? "We couldn’t confirm your attendance because the connection was interrupted. Please try again or call one of the contacts listed."
        : error.message, true);
    } finally {
      busy = false;
      form.removeAttribute("aria-busy");
      name.disabled = phone.disabled = false;
      submit.disabled = confirmed;
      submit.textContent = confirmed ? "Attendance confirmed" : "Confirm Attendance";
    }
  });
  form.hidden = false;
})();

function newRequestId() {
  if (window.crypto.randomUUID) return window.crypto.randomUUID();
  const bytes = window.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

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

// Guest moments are submitted to the companion server, never stored in-browser.
(() => {
  const dialog = document.getElementById("moments-dialog");
  const openButton = document.getElementById("open-moments");
  const closeButton = document.getElementById("close-moments");
  const uploadForm = document.getElementById("moments-form");
  const sendButton = document.getElementById("send-moment");
  const fileInput = document.getElementById("moment-item");
  const status = document.getElementById("upload-status");
  const progressWrap = document.getElementById("upload-progress");
  const progress = document.getElementById("moment-progress");
  // Resolve from this page so the project can be moved without personal paths.
  const api = new URL("./api/moments", window.location.href);
  let busy = false;
  let requestId = null;

  function setStatus(message, kind = "") {
    status.textContent = message;
    status.className = "upload-status" + (kind ? " " + kind : "");
  }
  openButton.disabled = false;
  openButton.addEventListener("click", async () => {
    dialog.showModal();
    document.getElementById("moment-name").focus();
    if (busy) return;
    if (window.location.protocol === "file:") {
      setStatus("Uploads need the wedding website’s upload server. Please open the invitation using its server link.", "error");
      sendButton.disabled = true;
      return;
    }
    sendButton.disabled = true;
    setStatus("Checking that uploads are available…");
    try {
      const response = await fetch(api.href + "/status", { signal: AbortSignal.timeout(8000) });
      const result = await response.json();
      if (!response.ok || !result.ready) throw new Error();
      sendButton.disabled = false;
      setStatus("");
    } catch {
      setStatus("Uploads aren’t available right now. Please try again later or contact the couple.", "error");
    }
  });
  closeButton.addEventListener("click", () => { if (!busy) dialog.close(); });
  dialog.addEventListener("cancel", event => {
    if (busy) event.preventDefault();
  });
  uploadForm.addEventListener("input", () => {
    if (!busy) { requestId = null; setStatus(""); }
  });
  fileInput.addEventListener("change", () => {
    fileInput.setCustomValidity("");
    if (fileInput.files[0]?.size > 250 * 1024 * 1024) {
      fileInput.setCustomValidity("Please choose a file smaller than 250 MB.");
      fileInput.reportValidity();
    }
  });
  uploadForm.addEventListener("submit", event => {
    event.preventDefault();
    if (busy || !uploadForm.reportValidity()) return;
    const guestName = document.getElementById("moment-name");
    const phone = document.getElementById("moment-phone");
    if (!guestName.value.trim()) { setStatus("Please enter your name.", "error"); guestName.focus(); return; }
    const digits = phone.value.replace(/\D/g, "");
    if (!/^\+?[0-9() .-]{7,30}$/.test(phone.value.trim()) || digits.length < 7 || digits.length > 15) {
      setStatus("Please enter a valid phone number, including your country code.", "error"); phone.focus(); return;
    }
    const data = new FormData(uploadForm);
    requestId ||= newRequestId();
    busy = true;
    uploadForm.setAttribute("aria-busy", "true");
    [...uploadForm.elements].forEach(element => { element.disabled = true; });
    closeButton.disabled = true;
    progressWrap.hidden = false;
    progress.value = 0;
    sendButton.textContent = "Uploading…";
    setStatus("Uploading your moment. Please keep this window open.");
    const xhr = new XMLHttpRequest();
    xhr.open("POST", api.href);
    xhr.setRequestHeader("X-Wedding-Upload", "1");
    xhr.setRequestHeader("X-Upload-ID", requestId);
    xhr.timeout = 15 * 60 * 1000;
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) {
        progress.value = Math.round(event.loaded / event.total * 100);
        if (event.loaded === event.total) {
          setStatus("Your file has arrived. We’re preparing it and saving your details. Videos may take a few minutes.");
          sendButton.textContent = "Processing…";
          progress.removeAttribute("value");
        }
      }
    };
    function finish() {
      busy = false;
      uploadForm.removeAttribute("aria-busy");
      [...uploadForm.elements].forEach(element => { element.disabled = false; });
      closeButton.disabled = false;
      sendButton.textContent = "Upload moment";
      progressWrap.hidden = true;
    }
    xhr.onload = () => {
      finish();
      let result;
      try { result = JSON.parse(xhr.responseText); } catch { result = {}; }
      if (xhr.status >= 200 && xhr.status < 300 && result.saved) {
        setStatus("Thank you! Your moment and contact details have been saved." + (result.trimmed ? " Your video was trimmed to its first 3 minutes." : "") + " You can share another item below.", "success");
        fileInput.value = "";
        requestId = null;
      } else {
        setStatus(result.error || "We couldn’t save your moment. Please try again.", "error");
      }
    };
    xhr.onerror = xhr.ontimeout = () => {
      finish();
      setStatus("The connection was interrupted. Please retry this same item; it won’t be saved twice.", "error");
    };
    xhr.send(data);
  });
})();
