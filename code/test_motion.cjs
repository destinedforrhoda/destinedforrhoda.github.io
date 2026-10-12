// Run with Node. Checks the actual motion controller without a browser dependency.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/script.js', 'utf8');
const motion = source.slice(source.indexOf('// Motion follows'), source.indexOf('const weddingDate'));

function setup({reduced = false, stored = null, storageFails = false} = {}) {
  const root = {dataset: {}};
  const handlers = {};
  function element(tagName = 'DIV', complete = true) {
    const classes = new Set();
    return {tagName, complete, handlers: {}, hidden: true, classes,
      classList: {add: value => classes.add(value), remove: value => classes.delete(value)},
      style: {setProperty() {}}, contains: value => value === 'focused',
      setAttribute(key, value) { this[key] = value; },
      addEventListener(key, callback) { this.handlers[key] = callback; }};
  }
  const toggle = element();
  const heading = element();
  const photo = element('IMG', false);
  const observers = [];
  const preference = {matches: reduced, addListener(callback) { handlers.preference = callback; }};
  function Observer(callback) {
    this.callback = callback;
    this.observed = new Set();
    this.observe = element => this.observed.add(element);
    this.disconnect = () => this.observed.clear();
    observers.push(this);
  }
  const document = {documentElement: root, activeElement: null,
    getElementById: () => toggle, querySelectorAll: () => [heading, photo],
    addEventListener: (key, callback) => { handlers[key] = callback; }};
  const storage = {getItem() { if (storageFails) throw Error('unavailable'); return stored; },
    setItem(key, value) { if (storageFails) throw Error('unavailable'); stored = value; }};
  vm.runInNewContext(motion, {document, localStorage: storage, IntersectionObserver: Observer,
    window: {matchMedia: () => preference, IntersectionObserver: Observer,
      addEventListener: (key, callback) => { handlers[key] = callback; }}});
  return {root, toggle, heading, photo, observers, handlers};
}

const app = setup();
assert.equal(app.root.dataset.motion, 'on');
const observer = app.observers[0];
assert.ok(observer.observed.has(app.heading));
assert.ok(!observer.observed.has(app.photo));
app.photo.handlers.load();
assert.ok(observer.observed.has(app.photo));
const enter = ratio => observer.callback([{target: app.photo, isIntersecting: true, intersectionRatio: ratio}]);
enter(.01);
assert.ok(!app.photo.classes.has('reveal-enter'), 'Do not animate at the first visible pixel');
enter(.2);
assert.ok(app.photo.classes.has('reveal-enter'));
observer.callback([{target: app.photo, isIntersecting: false, intersectionRatio: 0}]);
assert.ok(!app.photo.classes.has('reveal-enter'));
enter(.2);
assert.ok(app.photo.classes.has('reveal-enter'), 'Replay after reentry');
app.handlers.focusin({target: 'focused'});
assert.ok(!app.photo.classes.has('reveal-enter'), 'Keyboard focus must show content immediately');
app.toggle.handlers.click();
assert.equal(app.root.dataset.motion, 'off');
assert.equal(observer.observed.size, 0);

const reduced = setup({reduced: true, storageFails: true});
assert.equal(reduced.root.dataset.motion, 'off');
assert.equal(reduced.observers.length, 0);
reduced.toggle.handlers.click();
assert.equal(reduced.root.dataset.motion, 'on', 'Explicit guest choice can enable motion');
assert.equal(reduced.observers.length, 1);
assert.equal(setup({reduced: true, stored: 'on'}).root.dataset.motion, 'on');
assert.equal(setup({stored: 'off'}).root.dataset.motion, 'off');
console.log('Motion checks passed: load timing, visible threshold, replay, keyboard focus, device preference and manual override.');
