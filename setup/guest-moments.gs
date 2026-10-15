// Copy this file into Code.gs at https://script.google.com/ .
// Read-only, public media feed. No spreadsheet, names, filenames or phone numbers.
const GALLERY_FOLDER_ID = '12-V00cNlWi58awNrzOkPfZ8X1ikFHG21jN7JuwkuxoeVyOlUxR5nO5ql0sRGWvE-ZtqehQ4b';

function collectGuestMedia_() {
  const root = DriveApp.getFolderById(GALLERY_FOLDER_ID);
  if (root.isTrashed()) return [];
  const pending = [root];
  const visited = new Set();
  const items = [];
  let examined = 0;
  while (pending.length) {
    const folder = pending.pop();
    if (visited.has(folder.getId()) || folder.isTrashed()) continue;
    visited.add(folder.getId());
    if (visited.size > 100) throw new Error('Folder limit exceeded');
    const files = folder.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      if (++examined > 5000) throw new Error('Scan limit exceeded');
      if (file.isTrashed()) continue;
      const mime = file.getMimeType();
      const type = mime.startsWith('image/') ? 'photo' : mime.startsWith('video/') ? 'video' : null;
      if (!type) continue; // Excludes spreadsheets, forms, documents and shortcuts.
      const access = file.getSharingAccess();
      if (access !== DriveApp.Access.ANYONE && access !== DriveApp.Access.ANYONE_WITH_LINK) continue;
      items.push({ id: file.getId(), type: type, resourceKey: file.getResourceKey() || '', created: file.getDateCreated().getTime() });
      if (items.length > 1000) throw new Error('Gallery limit exceeded');
    }
    const children = folder.getFolders();
    while (children.hasNext()) pending.push(children.next());
  }
  items.sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
  return items.map(item => ({ id: item.id, type: item.type, resourceKey: item.resourceKey }));
}

function doGet(e) {
  const callback = e && e.parameter && e.parameter.callback;
  if (callback && !/^guestMoments_[a-zA-Z0-9_]{1,80}$/.test(callback)) {
    return ContentService.createTextOutput('{"ok":false}').setMimeType(ContentService.MimeType.JSON);
  }
  let result;
  try {
    result = { ok: true, items: collectGuestMedia_() };
  } catch (error) {
    // Do not expose internal details or return a partial snapshot as a successful refresh.
    console.error('Guest gallery scan failed. Check folder access and Apps Script quotas.');
    result = { ok: false, error: 'Gallery temporarily unavailable' };
  }
  const json = JSON.stringify(result);
  return ContentService.createTextOutput(callback ? callback + '(' + json + ');' : json)
    .setMimeType(callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
}

// Run once in the editor to authorize Drive access and check your folder.
function checkGallery() {
  const items = collectGuestMedia_();
  console.log('Public photos and videos found: ' + items.length);
}
