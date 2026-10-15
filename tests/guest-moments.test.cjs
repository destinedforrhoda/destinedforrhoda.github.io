const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function iterator(values) {
  let i = 0;
  return { hasNext: () => i < values.length, next: () => values[i++] };
}
function file(id, mime, access = 'public', trashed = false) {
  return { getId: () => id, getMimeType: () => mime, getSharingAccess: () => access,
    isTrashed: () => trashed, getResourceKey: () => '', getDateCreated: () => new Date(0),
    getName: () => { throw new Error('Private filenames must never be read'); } };
}
function folder(id, files, children = []) {
  return { getId: () => id, isTrashed: () => false, getFiles: () => iterator(files), getFolders: () => iterator(children) };
}

test('Drive feed excludes private data, follows subfolders and reflects deletion', () => {
  const files = [file('photo_123456', 'image/jpeg'), file('private_12345', 'image/jpeg', 'private'),
    file('sheet_123456', 'application/vnd.google-apps.spreadsheet'), file('trashed_12345', 'video/mp4', 'public', true)];
  const sub = [file('video_123456', 'video/mp4')];
  const drive = folder('root', files, [folder('child', sub)]);
  const context = vm.createContext({ console: { error() {}, log() {} }, DriveApp: {
    getFolderById: () => drive, Access: { ANYONE: 'public', ANYONE_WITH_LINK: 'link' }
  }, ContentService: { MimeType: { JSON: 'json', JAVASCRIPT: 'js' },
    createTextOutput: text => ({ text, setMimeType() { return this; } }) } });
  vm.runInContext(fs.readFileSync(path.join(root, 'setup/guest-moments.gs'), 'utf8'), context);
  const get = () => JSON.parse(context.doGet({ parameter: {} }).text);
  assert.deepEqual(get().items.map(x => x.id), ['photo_123456', 'video_123456']);
  assert.deepEqual(Object.keys(get().items[0]).sort(), ['id', 'resourceKey', 'type']);
  sub.pop();
  assert.deepEqual(get().items.map(x => x.id), ['photo_123456']);
  files.splice(0);
  assert.deepEqual(get(), { ok: true, items: [] });
  const rejected = context.doGet({ parameter: { callback: 'alert(1)//' } }).text;
  assert.deepEqual(JSON.parse(rejected), { ok: false });
  drive.getFiles = () => { throw new Error('Permission lost'); };
  assert.equal(get().ok, false);
});

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.listeners = {}; this.hidden = false; this.textContent = ''; }
  append(...children) { for (const child of children) this.insertBefore(child, null); }
  prepend(child) { this.insertBefore(child, this.children[0] || null); }
  insertBefore(child, anchor) {
    child.remove();
    const index = anchor ? this.children.indexOf(anchor) : this.children.length;
    this.children.splice(index, 0, child); child.parent = this;
  }
  remove() { if (this.parent) { const a = this.parent.children; a.splice(a.indexOf(this), 1); this.parent = null; } }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  setAttribute() {}
  removeAttribute() {}
  contains(node) { return node === this || this.children.some(c => c.contains(node)); }
  focus() {}
}

test('Gallery preserves playing frames, removes deleted cards and keeps last snapshot on failure', async () => {
  const elements = Object.fromEntries(['guest-gallery', 'guest-gallery-status', 'guest-gallery-retry', 'guest-gallery-heading'].map(id => [id, new Element('div')]));
  const head = new Element('head');
  let poll;
  const window = { GUEST_MOMENTS_CONFIG: { feedUrl: 'https://script.google.com/macros/s/test_deployment/exec' }, addEventListener() {} };
  const document = { head, hidden: false, getElementById: id => elements[id], createElement: tag => new Element(tag), addEventListener() {} };
  const context = vm.createContext({ window, document, URL, Date, console, setTimeout, clearTimeout, setInterval: fn => { poll = fn; } });
  vm.runInContext(fs.readFileSync(path.join(root, 'code/guest-moments.js'), 'utf8'), context);
  const respond = async data => {
    const script = head.children[0];
    assert.ok(script, 'A refresh must request the feed');
    window[new URL(script.src).searchParams.get('callback')](data);
    await new Promise(resolve => setImmediate(resolve));
  };
  const photo = { id: 'photo_123456', type: 'photo' };
  const video = { id: 'video_123456', type: 'video' };
  await respond({ ok: true, items: [photo, video] });
  const gallery = elements['guest-gallery'];
  const frame = gallery.children[1].children[0];
  assert.equal(frame.tag, 'iframe');
  assert.equal(gallery.children[0].children[1].textContent, 'Download photo');
  assert.match(gallery.children[1].children[1].href, /export=download/);
  poll(); await respond({ ok: true, items: [photo, video] });
  assert.equal(gallery.children[1].children[0], frame, 'Refresh must preserve the video frame');
  poll(); await respond({ ok: false });
  assert.equal(gallery.children.length, 2, 'Failed feed must not erase known media');
  assert.equal(elements['guest-gallery-retry'].hidden, false);
  poll(); await respond({ ok: true, items: [photo, { id: '../bad', type: 'video' }] });
  assert.equal(gallery.children.length, 2, 'Invalid partial feed must not remove cards');
  poll(); await respond({ ok: true, items: [video] });
  assert.equal(gallery.children.length, 1);
  assert.equal(gallery.children[0].children[0], frame);
  poll(); await respond({ ok: true, items: [] });
  assert.equal(gallery.children.length, 0, 'Empty successful snapshot removes every card');
});
