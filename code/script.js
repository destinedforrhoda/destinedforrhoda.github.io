// Edit page content, photos and links in index.html.
// The calendar and countdown read the wedding-date element's datetime attribute.
document.documentElement.classList.add("js");
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

    // Local-only RSVP: no fetch, storage, external form service or automatic message.
    const form = document.getElementById("rsvp-form");
    const count = document.getElementById("guest-count");
    const submit = document.getElementById("submit-rsvp");
    const confirmation = document.getElementById("confirmation");
    form.addEventListener("change", () => {
      const declining = form.elements.attendance.value === "no";
      count.disabled = declining;
      count.required = !declining;
    });
    form.addEventListener("input", () => {
      submit.disabled = false;
      submit.textContent = "Prepare my RSVP";
      confirmation.hidden = true;
    });
    form.addEventListener("submit", event => {
      event.preventDefault();
      const name = form.elements.name;
      if (!name.value.trim()) {
        name.setCustomValidity("Please enter your name.");
        name.reportValidity();
        name.addEventListener("input", () => name.setCustomValidity(""), { once: true });
        return;
      }
      const attending = form.elements.attendance.value === "yes";
      const response = attending ? "Attending · " + count.value + " guest(s)." : "Unable to attend.";
      const message = form.elements.message.value.trim();
      confirmation.textContent = "Thank you, " + name.value.trim() + ". Your response is prepared on this page: " + response + " Nothing has been sent or permanently stored. Please contact " + Array.from(document.querySelectorAll("#contacts a span:first-child"), contact => contact.textContent.trim()).join(", ") + " to confirm your RSVP.";
      if (message) {
        const note = document.createElement("p");
        note.textContent = "Your message: " + message;
        confirmation.append(note);
      }
      confirmation.hidden = false;
      submit.disabled = true;
      submit.textContent = "Response prepared";
    });
    form.hidden = false;

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
  function newId() {
    if (window.crypto.randomUUID) return window.crypto.randomUUID();
    const bytes = window.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
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
    requestId ||= newId();
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
