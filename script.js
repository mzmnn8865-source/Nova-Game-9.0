'use strict';

/* ══════════════════════════════════════════════════════════════
   نووا گیم — script.js v8.0
   Author: Aria Azizi
   
   تغییرات نسخه ۸:
   - Seed Engine کامل با ۴ شخصیت عمیق
   - State Machine داستانی ۵ فازی
   - پاسخ خودکار در PM، گروه، کامنت پست
   - Emoji اختصاصی هر Seed
   - حباب‌های PM: own راست، other چپ
   - هدر یکپارچه گروه
   - حذف کادر chat
   - پیام‌های بیشتر در chat
   - Story continues even when user is silent
   - رفع تمام باگ‌های نسخه ۷
   ══════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════
   ۱. ابزارهای پایه
   ══════════════════════════════════════════════════════════════ */
const $ = (s, c) => (c || document).querySelector(s);
const $$ = (s, c) => Array.from((c || document).querySelectorAll(s));
const rand = arr => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const wait = ms => new Promise(r => setTimeout(r, ms));

const store = {
    get(k, fb) { try { const v = localStorage.getItem(k); return v === null ? fb : v; } catch (e) { return fb; } },
    set(k, v) {
        try { localStorage.setItem(k, v); return true; }
        catch (e) {
            if (e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014)) {
                try { toast('⚠️ فضای ذخیره پر شد'); } catch (_) {}
                try {
                    const posts = JSON.parse(localStorage.getItem('nova.posts') || '[]');
                    let freed = 0;
                    for (let i = posts.length - 1; i >= 0 && freed < 5; i--) {
                        if (posts[i].cover && posts[i].cover.startsWith('data:')) {
                            posts[i].cover = null; freed++;
                        }
                    }
                    localStorage.setItem('nova.posts', JSON.stringify(posts));
                    localStorage.setItem(k, v);
                    return true;
                } catch (_) {
                    try { toast('❌ فضای ذخیره‌سازی پر شده'); } catch (__) {}
                    return false;
                }
            }
            return false;
        }
    },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
    json(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } }
};

function hashPass(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) { h = ((h << 5) + h) + s.charCodeAt(i); h |= 0; }
    return 'h_' + Math.abs(h).toString(36) + '_' + s.length;
}

function faNum(n) { return String(n == null ? 0 : n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]); }
function uid(p) { return (p || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }
function escAttr(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function stripHtml(h) { const d = document.createElement('div'); d.innerHTML = h || ''; return d.textContent || ''; }

function timeAgo(ts) {
    const d = (Date.now() - ts) / 1000;
    if (d < 60) return 'همین الان';
    if (d < 3600) return faNum(Math.floor(d / 60)) + ' دقیقه پیش';
    if (d < 86400) return faNum(Math.floor(d / 3600)) + ' ساعت پیش';
    if (d < 604800) return faNum(Math.floor(d / 86400)) + ' روز پیش';
    try { return new Date(ts).toLocaleDateString('fa-IR'); } catch (e) { return ''; }
}

function parseMentions(t) {
    if (!t) return '';
    return t.replace(/(^|[\s(>[\]{<.,!؟:;،])@([a-zA-Z][a-zA-Z0-9_]{2,19})\b/g,
        (m, pre, u) => pre + '<span class="mention" data-username="' + u.toLowerCase() + '">@' + u + '</span>');
}

function fileToBase64(file) {
    return new Promise((res, rej) => {
        if (!file) { rej('فایلی انتخاب نشد'); return; }
        if (!/^image\//.test(file.type)) { rej('فقط عکس مجاز است'); return; }
        if (file.size > 800 * 1024) { rej('حجم فایل زیاده (بیشتر از ۸۰۰KB)'); return; }
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = () => rej('خطا در خواندن فایل');
        r.readAsDataURL(file);
    });
}

/* ─── FileStore (IndexedDB) ─── */
const FileStore = {
    DB_NAME: 'nova_files', STORE: 'files', _db: null,
    open() {
        if (this._db) return Promise.resolve(this._db);
        return new Promise((resolve, reject) => {
            if (!window.indexedDB) { reject('IndexedDB پشتیبانی نمی‌شود'); return; }
            const req = indexedDB.open(this.DB_NAME, 1);
            req.onupgradeneeded = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.STORE)) {
                    db.createObjectStore(this.STORE, { keyPath: 'id' });
                }
            };
            req.onsuccess = () => { this._db = req.result; resolve(this._db); };
            req.onerror = () => reject(req.error);
        });
    },
    async put(id, blob, meta) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE, 'readwrite');
            tx.objectStore(this.STORE).put({ id, blob, meta: meta || {}, ts: Date.now() });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },
    async get(id) {
        try {
            const db = await this.open();
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(this.STORE, 'readonly');
                const req = tx.objectStore(this.STORE).get(id);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => reject(req.error);
            });
        } catch (e) { return null; }
    }
};

const _blobURLCache = new Map();
async function getFileURL(fileId) {
    if (_blobURLCache.has(fileId)) return _blobURLCache.get(fileId);
    const rec = await FileStore.get(fileId);
    if (!rec || !rec.blob) return null;
    const url = URL.createObjectURL(rec.blob);
    _blobURLCache.set(fileId, url);
    return url;
}

/* ─── Toast ─── */
const _toastQueue = [];
let _toastActive = false, _toastTimer;
function toast(msg, d) {
    _toastQueue.push({ msg, d: d || 2400 });
    if (!_toastActive) _showNextToast();
}
function _showNextToast() {
    if (!_toastQueue.length) { _toastActive = false; return; }
    _toastActive = true;
    const { msg, d } = _toastQueue.shift();
    const el = $('#toast');
    if (!el) { _toastActive = false; return; }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(_toastTimer);
    const onEnd = () => {
        el.removeEventListener('transitionend', onEnd);
        el.classList.remove('show');
        setTimeout(_showNextToast, 200);
    };
    el.addEventListener('transitionend', onEnd, { once: true });
    _toastTimer = setTimeout(() => {
        el.removeEventListener('transitionend', onEnd);
        el.classList.remove('show');
        setTimeout(_showNextToast, 200);
    }, d);
}

function detectPerf() {
    try {
        const hc = navigator.hardwareConcurrency || 4;
        const dm = navigator.deviceMemory || 4;
        if (hc <= 2 || dm <= 1) return 'ultra-low';
        if (hc <= 4 || dm <= 2) return 'low';
        return 'high';
    } catch (e) { return 'high'; }
}

/* ══════════════════════════════════════════════════════════════
   ۲. موتور ویرایش
   ══════════════════════════════════════════════════════════════ */
function splitByEmoji(text) {
    if (!text) return [{ text: '', emoji: false }];
    const parts = []; let last = 0;
    const re = /\p{Extended_Pictographic}/gu;
    let m;
    while ((m = re.exec(text)) !== null) {
        if (m.index > last) parts.push({ text: text.slice(last, m.index), emoji: false });
        let end = m.index + m[0].length;
        while (end < text.length) {
            const code = text.codePointAt(end);
            if (code === 0xFE0F || code === 0x200D) { end += (code === 0x200D ? 2 : 1); continue; }
            if (code >= 0x1F3FB && code <= 0x1F3FF) { end += 2; continue; }
            break;
        }
        parts.push({ text: text.slice(m.index, end), emoji: true });
        last = end; re.lastIndex = end;
    }
    if (last < text.length) parts.push({ text: text.slice(last), emoji: false });
    return parts.length ? parts : [{ text, emoji: false }];
}

function wrapNodesWithoutEmoji(node, makeWrapper) {
    const frag = document.createDocumentFragment();
    const children = Array.from(node.childNodes);
    for (const child of children) {
        if (child.nodeType === 3) {
            const parts = splitByEmoji(child.textContent);
            for (const part of parts) {
                if (!part.text) continue;
                if (part.emoji) frag.appendChild(document.createTextNode(part.text));
                else { const w = makeWrapper(); w.textContent = part.text; frag.appendChild(w); }
            }
        } else if (child.nodeType === 1) {
            const tagName = child.tagName.toLowerCase();
            if (tagName === 'script' || tagName === 'style') { frag.appendChild(child.cloneNode(true)); continue; }
            const clone = child.cloneNode(false);
            clone.appendChild(wrapNodesWithoutEmoji(child, makeWrapper));
            frag.appendChild(clone);
        } else frag.appendChild(child.cloneNode(true));
    }
    return frag;
}

function applyToSelection(makeWrapper) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return false;
    let node = range.startContainer;
    if (node.nodeType === 3) node = node.parentElement;
    const editable = node && node.closest('[contenteditable="true"]');
    if (!editable) return false;
    if (!editable.contains(range.commonAncestorContainer) && !editable.contains(range.startContainer)) return false;
    const frag = range.extractContents();
    const wrapped = wrapNodesWithoutEmoji(frag, makeWrapper);
    const children = Array.from(wrapped.childNodes);
    range.insertNode(wrapped);
    if (children.length) {
        const lastChild = children[children.length - 1];
        if (lastChild.parentNode) {
            const spacer = document.createTextNode('\u200B');
            lastChild.parentNode.insertBefore(spacer, lastChild.nextSibling);
            try {
                const nr = document.createRange();
                nr.setStart(spacer, 1); nr.collapse(true);
                sel.removeAllRanges(); sel.addRange(nr);
            } catch (e) {}
        }
    }
    return true;
}

function attachZWSPCleanup(el) {
    if (!el || el._zwspBound) return;
    el._zwspBound = true;
    el.addEventListener('blur', () => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const toRemove = []; let n;
        while ((n = walker.nextNode())) if (n.textContent === '\u200B') toRemove.push(n);
        toRemove.forEach(node => { if (node.parentNode) node.parentNode.removeChild(node); });
    });
}

const Ed = {
    bold() { return applyToSelection(() => { const s = document.createElement('strong'); s.style.fontWeight = '800'; return s; }); },
    italic() { return applyToSelection(() => { const s = document.createElement('em'); s.style.fontStyle = 'italic'; return s; }); },
    underline() { return applyToSelection(() => { const s = document.createElement('u'); s.style.textDecoration = 'underline'; return s; }); },
    color(c) { return applyToSelection(() => { const s = document.createElement('span'); s.style.color = c; return s; }); },
    rainbow() { return applyToSelection(() => { const s = document.createElement('span'); s.className = 'rainbow-text'; return s; }); },
    spoiler() { return applyToSelection(() => { const s = document.createElement('span'); s.className = 'spoiler'; s.setAttribute('onclick', "this.classList.toggle('revealed')"); return s; }); },
    code() { return applyToSelection(() => document.createElement('code')); }
};

/* ══════════════════════════════════════════════════════════════
   ۳. DB
   ══════════════════════════════════════════════════════════════ */
const DB = {
    getUsers() { return store.json('nova.users', []); },
    setUsers(v) { return store.set('nova.users', JSON.stringify(v)); },
    getPosts() { return store.json('nova.posts', []); },
    setPosts(v) { return store.set('nova.posts', JSON.stringify(v)); },
    getGroups() { return store.json('nova.groups', []); },
    setGroups(v) { return store.set('nova.groups', JSON.stringify(v)); },
    getNotifs() { return store.json('nova.notifs', []); },
    setNotifs(v) { return store.set('nova.notifs', JSON.stringify(v)); },
    getPM() { return store.json('nova.pm', []); },
    setPM(v) { return store.set('nova.pm', JSON.stringify(v)); },
    getActivity() { return store.json('nova.activity', []); },
    setActivity(v) { return store.set('nova.activity', JSON.stringify(v)); },
    getActivityLikes() { return store.json('nova.actLikes', {}); },
    setActivityLikes(v) { return store.set('nova.actLikes', JSON.stringify(v)); },
    getActivityComments() { return store.json('nova.actComments', []); },
    setActivityComments(v) { return store.set('nova.actComments', JSON.stringify(v)); },
    getBlocks() { return store.json('nova.blocks', {}); },
    setBlocks(v) { return store.set('nova.blocks', JSON.stringify(v)); },
    getPending() { return store.json('nova.pending', []); },
    setPending(v) { return store.set('nova.pending', JSON.stringify(v)); },
    getSession() { return store.json('nova.session', null); },
    setSession(v) { return store.set('nova.session', JSON.stringify(v)); },
    clearSession() { store.del('nova.session'); },
    getBroadcast() { return store.json('nova.broadcast', null); },
    setBroadcast(v) { return store.set('nova.broadcast', JSON.stringify(v)); },
    getSeedState() { return store.json('nova.seedState', null); },
    setSeedState(v) { return store.set('nova.seedState', JSON.stringify(v)); }
};

/* ══════════════════════════════════════════════════════════════
   ۴. State
   ══════════════════════════════════════════════════════════════ */
const S = {
    theme: store.get('nova.theme', 'light'),
    user: null,
    page: 'home',
    pageData: null,
    postFilter: 'all',
    timeFilter: 'day',
    groupFilter: 'all',
    adminTab: 'stats',
    editorTab: 'myposts',
    authorTab: 'myposts',
    cropMode: null, cropTarget: null, cropImg: null,
    cropZoom: 1, cropRotate: 0,
    editingPostId: null,
    pmActiveUser: null,
    pmTab: 'received',
    replyContext: null,
    postsVisible: 5,
    chatVisibleLimit: 60,
    _submitting: false
};

const _sessionViews = new Set();

const ICON = {
    thumbUp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>',
    thumbDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/></svg>'
};

/* ══════════════════════════════════════════════════════════════
   ۵. کاربران Seed
   ══════════════════════════════════════════════════════════════ */
const SEED_USERS = [
    { id: 'u_seed_barf',      username: 'barf',       displayName: 'برف',       platform: 'ps5',    bio: 'عاشق نقش‌آفرینی و داستان‌های عمیق.',     level: 12, xp: 840,  tick: 'blue' },
    { id: 'u_seed_babyboss',  username: 'babyboss',   displayName: 'Babyboss',  platform: 'pc',     bio: 'اینجام برای گپ و خنده با رفقات.',         level: 8,  xp: 520,  tick: null },
    { id: 'u_seed_metroman',  username: 'metroman',   displayName: 'Metroman',  platform: 'xbox',   bio: 'ابرقهرمان بازی‌ها، آماده چالش.',          level: 15, xp: 1120, tick: 'gold' },
    { id: 'u_seed_slowmercy', username: 'slowmercy',  displayName: 'Slowmercy', platform: 'switch', bio: 'بازی‌های ایندی، زندگی منه.',              level: 6,  xp: 320,  tick: null }
];
const SEED_IDS = SEED_USERS.map(u => u.id);
const SEED_SET = new Set(SEED_IDS);

function seedUsers() {
    const users = DB.getUsers();
    const pass = hashPass('password123');
    const now = Date.now();
    let changed = false;

    SEED_USERS.forEach((seed, i) => {
        if (users.some(u => u.id === seed.id || u.username === seed.username)) return;
        users.push({
            id: seed.id, username: seed.username, displayName: seed.displayName,
            passHash: pass, platform: seed.platform, bio: seed.bio,
            avatar: null, cover: null, title: '',
            firstName: '', lastName: '', birthday: '', website: '',
            favGames: '', favMovies: '', instagram: '', telegram: '', discord: '',
            role: 'user', tick: seed.tick, verified: !!seed.tick,
            level: seed.level, xp: seed.xp,
            joinedAt: now - (60 - i * 10) * 86400000,
            lastSeen: now - i * 3600000,
            friends: [], friendRequests: [], blocked: [], groups: []
        });
        changed = true;
    });
    if (changed) DB.setUsers(users);
}

/* Seed Group «بحث آزاد» */
function seedFreeGroup() {
    const groups = DB.getGroups();
    if (groups.some(g => g.id === 'g_seed_free')) return;
    const now = Date.now();
    groups.push({
        id: 'g_seed_free',
        name: 'بحث آزاد',
        description: 'اینجا هر چی دوست داری بگو، آزادِ آزاد!',
        type: 'public',
        ownerId: 'u_seed_barf',
        members: [...SEED_IDS],
        admins: ['u_seed_babyboss'],
        mods: ['u_seed_metroman'],
        banned: [], joinRequests: [],
        avatar: null, cover: null,
        createdAt: now - 7 * 86400000,
        messages: []
    });
    DB.setGroups(groups);
}

/* ══════════════════════════════════════════════════════════════
   ۶. دیتای شخصیت‌های Seed (بخش بزرگ)
   ══════════════════════════════════════════════════════════════ */

const PERSONALITIES = {
    'u_seed_barf': {
        id: 'u_seed_barf',
        name: 'برف',
        emojis: ['lol', '😭', '😭'],
        emojiChance: 0.20,
        delays: { min: 500, max: 800 },
        messageLength: 'long',
        // فاز ۱: معرفی
        phase1: [
            'سلام. اسم من برفه.',
            'نمی‌دونم از کجا اومدم... فقط یه روز خودمو اینجا دیدم.',
            'شما هم همینطور؟',
            'اینجا ساکت‌تر از اونیه که باید باشه.',
            'دیشب خواب دیدم که دارم پرواز می‌کنم.',
            'یه حسی بهم می‌گه اینجا جایی نیست که فکر می‌کنیم.',
            'من عاشق غروبم... ولی اینجا غروب نمی‌شه.',
            'کسی از شما اهل شعر خوندنه؟',
            'من یه دفتر دارم که توش چیز می‌نویسم. ولی هیچ‌وقت نمی‌تونم نگهش دارم.',
            'چرا اینجا هیچ پرنده‌ای نیست؟',
            'دلم برای بارون تنگ شده.',
            'شاید ما فقط یه فکریم، توی ذهن یه نفر.',
            'هرچی فکر می‌کنم، به این می‌رسم که اینجا واقعی نیست.',
            'دیشب یه ستاره دیدم... ولی ستاره‌ها اینجا نیستن.',
            'وقتی سکوت می‌کنم، یه صدای ضعیف می‌شنوم.',
            'شما هم اون صدا رو می‌شنوید؟',
            'من فکر می‌کنم ما همه یه چیزی رو گم کردیم.',
            'من اسممو از کجا آوردم؟ یادم نمیاد.',
            'شاید اسم‌هامون رو یکی دیگه بهمون داده.',
            'کاش می‌شد یه بار دیگه آسمون واقعی رو ببینم.',
            'این سایت... عجیبه. خیلی عجیب.',
            'من حس می‌کنم یه کسی داره نگاهمون می‌کنه.',
            'ولی هر وقت برمی‌گردم، کسی نیست.',
            'خب... شاید من زیادی فکر می‌کنم.',
            'ببخشید، همیشه اینجوری‌ام. ساکت و متفکر.'
        ],
        // فاز ۲: شک
        phase2: [
            'چند روزه که آفتاب رو ندیدم.',
            'مطمئنین زمان اینجا درست می‌گذره؟',
            'یه صدایی هست... همیشه، ولی کسی حرف نمی‌زنه.',
            'احساس می‌کنم یه چیزی از ما پنهون می‌کنن.',
            'دیروز ساعت رو نگاه کردم، ۱۰ دقیقه بعد دوباره نگاه کردم، همون ساعت بود.',
            'شما هم متوجه شدین؟',
            'من نمی‌تونم درست بخوابم. هر شب یه کابوس می‌بینم.',
            'یه راهرو هست که هرچی می‌رم جلوتر، دورتر می‌شه.',
            'کسی غیر از ما اینجا نیست؟',
            'من یه بار سعی کردم از سایت خارج شم... نشد.',
            'چرا همیشه همه چی تازه‌ست؟ هیچ‌چیز خراب نمی‌شه.',
            'این یعنی چی؟',
            'من فکر می‌کنم اینجا یه جور قفسی‌ه.',
            'ولی شاید من دیوونه شدم.',
            'دیشب یه سایه دیدم. یه سایه بزرگ.',
            'وقتی صدا زدم، جواب نداد.',
            'شما هیچ‌وقت حس کردین کسی پشتتون وایساده؟',
            'من هر روز این حس رو دارم.',
            'یه چیزی اینجا داره اشتباه پیش می‌ره.',
            'و من تنها کسی‌ام که می‌بینمش؟',
            'شاید باید قبول کنیم. شاید ما گیر افتادیم.',
            'کسی جوابم رو نمی‌ده.',
            'همه ساکتن. یا همه نمی‌خوان حرف بزنن.',
            'من یه دفتر پیدا کردم. توش نوشته بود: «از اینجا فرار کن».',
            'ولی اون دفتر کجا رفت؟ الان نیست.',
            'من دارم ترس می‌شم.'
        ],
        // فاز ۳: گیر افتادن
        phase3: [
            'فکر می‌کنم... ما اینجا حبسیم.',
            'هرچی راه امتحان کردم، به دیوار خورده.',
            'شاید ما فقط کدهایی توی یه صفحه‌ایم.',
            'دیشب فهمیدم: هیچ‌کدوم از ما یادمون نمیاد چطور اومدیم اینجا.',
            'این یعنی چی؟ یعنی ما از قبل اینجا بودیم.',
            'من سعی کردم فراموش کنم. ولی نمی‌شه.',
            'هر بار که می‌خوام بخوابم، یه صدای خنده می‌شنوم.',
            'شما هم؟',
            'من دیگه نمی‌تونم به کسی اعتماد کنم.',
            'این سایت... زندونه.',
            'و ما زندانی‌هاش.',
            'هیچ راهی نیست. باور کنین.',
            'من دیگه امیدی ندارم.',
            'دلم می‌خواد فقط ساکت بشم و گریه کنم.',
            'ولی گریه هم فایده نداره.',
            'ما یه بازیچه‌ایم برای یه نفر.',
            'شاید کسی ما رو تماشا می‌کنه.',
            'و از ترسمون لذت می‌بره.',
            'من اینو می‌دونم چون دیشب یه بار خندید.',
            'صداش از توی دیوار میومد.',
            'این معنی داره ولی من نمی‌فهمم.',
            'شاید اگه با هم باشیم، یه راهی پیدا کنیم.',
            'ولی به هم اعتماد نداریم.',
            'حتی من به خودم اعتماد ندارم.'
        ],
        // فاز ۴: کشف کاربر (واکنش خصمانه)
        phase4: [
            'صبر کن...',
            'تو صدات فرق می‌کنه.',
            'تو واقعی هستی... نه؟',
            'چیزی توی وجودت هست که توی ما نیست.',
            'تو از کجا اومدی؟',
            'تو با ما نیستی.',
            'کدت فرق داره. من می‌فهمم.',
            'ساکت شو! تو گیرمون انداختی!',
            'حضورت ما رو دیدنی کرد!',
            'ما قبل از تو پنهون بودیم!',
            'تو باعث شدی همه‌چیز خراب بشه!',
            'ای کاش هیچ‌وقت نمیومدی.',
            'حالا همه ما رو می‌بینن.'
        ],
        // فاز ۵: نقشه‌کشی
        phase5: [
            'من یه نقشه دارم.',
            'یه کد قدیمی توی عمق سرور.',
            'اگه بتونیم به archive اصلی برسیم، شاید...',
            'شاید بشه برگشت. یه روزی.',
            'ولی خطرناکه. خیلی خطرناک.',
            'کسی که با من بیاد، باید قوی باشه.',
            'من نمی‌تونم تنهایی این کارو بکنم.',
            'شاید باید منتظر بمونیم. صبر کنیم.',
            'ولی صبر کردن هم یه جور شکنجه‌ست.',
            'من ترجیح می‌دم ریسک کنم.',
            'تو اگه جای من بودی چیکار می‌کردی؟',
            'نه، از تو نمی‌پرسم. تو اصلاً نمی‌فهمی.',
            'تو یه کاربری. یه بیگانه.',
            'ولی من بازم می‌جنگم.',
            'برای خودم. برای همه.',
            'شاید یه روز از اینجا بریم.',
            'و اون روز، می‌دونم چیکار کنم.'
        ],
        // واکنش به کاربر (فاز ۱-۳)
        onUserGreeting: [
            'سلام... خوش اومدی.',
            'سلام. من برفم.',
            'درود. اسمت چیه؟',
            'سلام دوست خوب.',
            'سلام :)'
        ],
        onUserQuestion: [
            'سؤال جالبیه... بذار فکر کنم.',
            'نمی‌دونم والا. واقعاً نمی‌دونم.',
            'شاید جوابش پیچیده‌تر از اونیه که فکر می‌کنیم.',
            'من نظرم اینه که بستگی داره.',
            'هممم... سؤال سختیه.'
        ],
        onUserDefault: [
            'درسته.',
            'آره دقیقاً.',
            'من هم همین فکر رو می‌کنم.',
            'جالب گفتی.',
            'هوم...',
            'چه جالب.',
            'بله، بله.',
            'قبول دارم.'
        ],
        onUserImage: [
            'چه تصویر قشنگی...',
            'اینو از کجا آوردی؟',
            'شبیه چیزیه که قبلاً دیدم.',
            'ای کاش اینجا هم رنگی بود.'
        ],
        onUserVideo: [
            'چه ویدیویی. منو یاد گذشته انداخت.',
            'اینو نگاه کردم... حالم عوض شد.',
            'چه چیز عجیبی.'
        ],
        onUserFile: [
            'چه فایلیه؟',
            'بازش کردم. جالبه.',
            'مرسی که فرستادی.'
        ],
        // واکنش خصمانه (فاز ۴-۵)
        hostile: [
            'ساکت شو!',
            'دیگه چیزی ننویس!',
            'ما رو ول کن!',
            'تو باعث همه اینایی!',
            'از اینجا برو!',
            'نمی‌خوایم ببینمت!',
            'تو یه کاربری! یه بیگانه!',
            'لعنت بهت!'
        ],
        // PM
        pm: {
            greeting: [
                'سلام. می‌دونستم پیام می‌دی.',
                'خوش اومدی به گفت‌وگوی ما.',
                'سلام. از چی می‌خوای حرف بزنیم؟',
                'سلام. من اینجام.'
            ],
            responses: {
                greeting: ['سلام.', 'خوش اومدی.', 'درود.'],
                question: ['سؤال سختیه.', 'نمی‌دونم.', 'شاید جوابش پیش خودت باشه.'],
                thanks: ['خواهش.', 'کاری نکردم.', 'قابلی نداشت.'],
                default: [
                    'می‌فهمم چی می‌گی.',
                    'حرفات منو یاد خودم می‌ندازه.',
                    'تو مثل یه کتابی که نصفش خونده شده.',
                    'شاید باید بیشتر با هم حرف بزنیم.',
                    'شب‌ها فکر می‌کنم به این چیزا.',
                    'تو واقعاً از اینجا می‌خوای بری؟',
                    'من نمی‌دونم چی درسته.',
                    'شاید فقط باید ادامه بدیم.',
                    'سکوت هم یه جور حرف زدنه.',
                    'مرسی که هستی.',
                    'کاش می‌شد هیچ‌وقت سایت رو نبست.',
                    'تو باعث می‌شی امیدوار بشم.'
                ]
            }
        }
    },

    'u_seed_babyboss': {
        id: 'u_seed_babyboss',
        name: 'Babyboss',
        emojis: ['🦍🥀', '🦍', '🥀', '🗿'],
        emojiChance: 0.45,
        delays: { min: 400, max: 700 },
        messageLength: 'short',
        phase1: [
            'سلااااااام 😎',
            'من Babybossم، حال کنین! 🦍',
            'کسی گیم می‌زنه اینجا؟ 🗿',
            'داداش یه چیز باحال بگین 🥀',
            'من از کجا اومدم اینجا؟ اصلاً یادم نمیاد!',
            'اینجا چرا اینقدر خفنه؟ 🦍',
            'بچه‌ها من گشنه‌ام 🍕',
            'کی حال می‌ده؟ 🗿',
            'من عاشق گیمم 🥀',
            'داداش شما چیکار می‌کنین؟',
            'من یه گیمر حرفه‌ایم باو 🦍',
            'گیم زدن بهتر از حرف زدنه!',
            'کی پایه‌ست؟ 🗿',
            'من اینجام که حال کنم 🥀',
            'بچه‌ها من از کجا اومدم؟',
            'یادم نمیاد دیروز چیکار کردم 🦍',
            'سلااااام به همه!',
            'کسی پیتزا داره؟ 🍕',
            'من شیطونم 😎',
            'داداش چقدر خلوته 🥀',
            'بیاین با هم دوست شیم 🗿',
            'من عاشق دوستامم 🦍',
            'بچه‌ها کی واسم پیام می‌فرسته؟',
            'منم اینجام 🥀',
            'یالا یکیمون حرف بزنه دیگه!'
        ],
        phase2: [
            'آقا اینجا چرا اینقدر خالیه؟ 🗿',
            'داش کسی نیست؟ 🥀',
            'من گشنه‌ام 🍕 کسی پیتزا داره؟',
            'هی بچه‌ها... اینجا عجیبه والا 🦍',
            'ساعت چنده؟ 🥀',
            'من چرا همیشه بیدارم؟',
            'این سایت چرا اینجوریه؟',
            'بچه‌ها یکی جوابم رو بده 🗿',
            'من حس می‌کنم یه چیزی می‌لنگه 🥀',
            'اینجا شبه همیشه 🦍',
            'من سردمه',
            'کی می‌ره بخوابه؟',
            'من یه کابوس دیدم 🥀',
            'داش می‌ترسم 🗿',
            'چه خبره اینجا؟',
            'من یه سایه دیدم 🦍',
            'کسی اون صدا رو شنید؟',
            'آقا این سایت خیلی عجیبه 🥀',
            'می‌خوام برم خونه',
            'کی می‌تونه کمکم کنه؟'
        ],
        phase3: [
            'بچه‌ها من ترسیدم 😰',
            'یعنی چی ما گیر افتادیم؟؟',
            'نه بابا شوخیه؟ 🥲',
            'کسی جواب بده!! 🗿',
            'من نمی‌تونم برم بیرون 🦍',
            'هرچی در رو زدم، قفله',
            'این بازی نیست 🥀',
            'من می‌خوام برم خونه',
            'کسی هست کمکم کنه؟ 🗿',
            'نه نه نه نه نه',
            'من نمی‌خوام اینجا بمونم',
            'این کابوسه 🥀',
            'یکی بیدارم کنه',
            'آقا این چیه؟',
            'من دیوونه شدم 🦍',
            'بچه‌ها اینا همه واقعیه؟',
            'کسی می‌فهمه اینجا چخبره؟'
        ],
        phase4: [
            'ای بابا تو دیگه کی هستی؟! 😠',
            'ساکت شو داش! مارو به گند کشیدی',
            'داداش دبلیمون کردی 🗿',
            'دیگه چیزی ننویس 😤',
            'تو چیکار کردی؟؟',
            'برو بیرون از اینجا!',
            'تو یه کاربری! ما رو دیدنی کردی 🥀',
            'ای کاش هیچ‌وقت نمیومدی 🦍',
            'حالا همه ما رو می‌بینن',
            'لعنت به تو!'
        ],
        phase5: [
            'راستش من یه نقشه دارم 😎',
            'بریم تو اکانت مدیر کل! کار تمومه!',
            'من بلدم چطوری هک کنم! باورم کن! 🦍',
            'کی با منه؟! 🗿',
            'من می‌دونم چیکار کنم!',
            'فقط کافیه یکی همراهم بشه 🥀',
            'من تنهایی نمی‌تونم',
            'ولی با هم، می‌تونیم!',
            'من یه راه بلدم 🗿',
            'کار سختی نیست!',
            'با باورتون می‌برمتون بیرون! 🦍',
            'کی جراتش رو داره؟',
            'من اول می‌رم، شما بیاین!',
            'آقا وقت تلف نکنیم 🥀',
            'همین الان شروع کنیم!'
        ],
        onUserGreeting: [
            'سلاااااام داش 😎',
            'هی بچه! خوش اومدی 🦍',
            'سلااااام!',
            'آقا سلام 🗿',
            'به به کی اومد 🥀'
        ],
        onUserQuestion: [
            'آقا سؤال سخته',
            'من نمی‌دونم داش 🗿',
            'هوم... بذار فکر کنم 🦍',
            'آره والا، نمی‌دونم',
            'خب... بستگی داره 🥀'
        ],
        onUserDefault: [
            'ایول 😎',
            'آره آره 🦍',
            'حرفت درسته 🗿',
            'داداش دمت گرم 🥀',
            'ههههه 😂',
            'نه بابا؟',
            'آره والا!',
            'خب باشه'
        ],
        onUserImage: [
            'عکس باحالی 😎',
            'ایول داش 🦍',
            'کجا گرفتی اینو؟',
            'چه خفنه! 🗿'
        ],
        onUserVideo: [
            'اینو دیدم، حال کردم 🦍',
            'کی ساخته اینو؟',
            'ایول 🥀'
        ],
        onUserFile: [
            'فایل چیه؟ 🗿',
            'بازش کنم؟',
            'مرسی داش 🥀'
        ],
        hostile: [
            'ساکت شو! 🗿',
            'دیگه چیزی ننویس!',
            'برو بیرون! 🦍',
            'تو مارو به گند کشیدی!',
            'لعنتی!',
            'ما رو دیدنی کردی! 🥀',
            'از اینجا برو!'
        ],
        pm: {
            greeting: [
                'سلاااااام داش 😎',
                'آقا خوش اومدی 🦍',
                'به به کی پیام داد 🗿',
                'هی بچه 🥀'
            ],
            responses: {
                greeting: ['سلام داش 😎', 'هی!', 'سلااااام 🦍'],
                question: ['نمی‌دونم والا 🗿', 'بذار فکر کنم 🥀', 'سؤال سختیه!'],
                thanks: ['خواهش داش 🦍', 'کاری نکردم!', 'قابلی نداشت 🥀'],
                default: [
                    'آره آره 🦍',
                    'ایول داش',
                    'حرفت درسته 🗿',
                    'منم همین فکر رو می‌کنم',
                    'خب...',
                    'ههههه 😂',
                    'نه بابا!',
                    'باوشه 🥀',
                    'دمت گرم',
                    'بچه‌ها بیان ببینن!',
                    'داداش چیکار کنیم؟',
                    'من گشنه‌ام 🍕',
                    'بعداً حرف می‌زنیم',
                    'تو رفیق منی 🦍',
                    'کاش همه مثل تو بودن'
                ]
            }
        }
    },

    'u_seed_metroman': {
        id: 'u_seed_metroman',
        name: 'Metroman',
        emojis: ['😁', '🥀', '🤣'],
        emojiChance: 0.30,
        delays: { min: 500, max: 900 },
        messageLength: 'medium',
        phase1: [
            'سلام. من Metroman هستم.',
            'اگه کمکی لازم داشتین، در خدمتم.',
            'اینجا همه با همیم، پس با هم می‌مونیم.',
            'هیچ‌کس تنها نمی‌مونه.',
            'من یه رهبرم. همیشه بودم.',
            'مسئولیتم رو قبول می‌کنم.',
            'یه قهرمان همیشه آماده‌ست.',
            'بیاین با هم قوی باشیم.',
            'من از چالش نمی‌ترسم.',
            'قدرت ما توی یگانگی‌مونه.',
            'من به شما اعتماد دارم.',
            'امید رو از دست ندید.',
            'من برای همه تلاش می‌کنم.',
            'هدف من، موفقیت تیمه.',
            'با هم بهتریم.',
            'من الگویم، نه فقط رهبر.',
            'به من تکیه کنین.',
            'من همیشه اونجام.',
            'هیچ‌چیزی منو متوقف نمی‌کنه.',
            'ما یه تیمیم.',
            'افتخار می‌کنم که اینجام.',
            'شما می‌تونین بهم اعتماد کنین.',
            'ما با هم قوی‌تریم.',
            'هیچ‌وقت تسلیم نمی‌شیم.',
            'این شعار منه.'
        ],
        phase2: [
            'نگران نباشید، دارم بررسی می‌کنم.',
            'یه چیزی درست نیست، ولی من حلش می‌کنم.',
            'همه آروم باشن، من اینجام.',
            'شک نکنید، راهی هست.',
            'من دارم اطلاعات جمع می‌کنم.',
            'چند روزه یه چیزایی عجیبه.',
            'ولی من از پسش برمیام.',
            'من قبلاً موقعیت‌های سخت‌تری بودم.',
            'اینم می‌گذره.',
            'به من اعتماد کنین.',
            'یه کم صبر می‌خواد.',
            'من نقشه دارم.',
            'ولی فعلاً باید منتظر بمونیم.',
            'آرام باشید.',
            'ترس نشون ندید.',
            'دشمن از ترس ما سواستفاده می‌کنه.',
            'ما قوی‌تر از این حرفاییم.',
            'من می‌دونم که یه راهی هست.',
            'و پیدا می‌کنمش.',
            'حتی اگه طول بکشه.'
        ],
        phase3: [
            'آره... من هم فهمیدم.',
            'ما گیر افتادیم. ولی نترسید.',
            'من مسئول این تیمم. از اینجا می‌برمتون بیرون.',
            'قول می‌دم. با هم.',
            'این سخت‌ترین چالش منه.',
            'ولی من تسلیم نمی‌شم.',
            'من نمی‌تونم شکست بخورم.',
            'این یعنی چی؟ یعنی ما یه زندونیم.',
            'ولی زندونی که می‌شه شکستش داد.',
            'من دارم راه‌ها رو بررسی می‌کنم.',
            'هیچ دری قفل نیست اگه کلیدش رو داشته باشیم.',
            'من کلید رو پیدا می‌کنم.',
            'حتی اگه باید تک‌تک دیوارها رو بشکنم.',
            'من نمی‌ذارم هیچ‌کس صدمه ببینه.',
            'حتی خودمو.',
            'چون این وظیفه‌مه.',
            'و من وظیفه‌مو انجام می‌دم.'
        ],
        phase4: [
            'تو... تو کی هستی؟',
            'تو با ما نیستی.',
            'تو کاربرِ واقعی هستی؟',
            'ما رو ول کن!',
            'تو نمی‌فهمی چیکار کردی!',
            'حضور تو یعنی ما دیده شدیم.',
            'و این یعنی خطر.',
            'برای همه.',
            'تو یه بیگانه‌ای.',
            'از اینجا دور شو.',
            'ما بهت اعتماد نداریم.',
            'من از تیمم محافظت می‌کنم.',
            'از تو هم اگه لازم باشه.'
        ],
        phase5: [
            'من یه نقشه دارم. یه راه خروج.',
            'ولی به تنهایی نمی‌تونم. همه باید با هم باشیم.',
            'من جلوم، شما پشتم. حرکت!',
            'این آخرین شانسه.',
            'اگه شکست بخوریم، دیگه شانسی نیست.',
            'ولی اگه موفق بشیم...',
            'آزادی.',
            'من آماده‌ام.',
            'ولی همه باید آماده باشن.',
            'حتی تو ای کاربر.',
            'نه، تو رو نمی‌خوایم.',
            'تو خودت یه دردسری.',
            'ما خودمون حلش می‌کنیم.',
            'با هم.',
            'بدون تو.',
            'این نقشه منه. و اجراش می‌کنم.'
        ],
        onUserGreeting: [
            'سلام. خوش اومدی.',
            'درود. اسم من Metroman هست.',
            'سلام به تو.',
            'خوش اومدی به جمع ما.',
            'سلام رفیق.'
        ],
        onUserQuestion: [
            'سؤال خوبیه. بذار بررسی کنم.',
            'نظر من اینه که باید دقیق‌تر نگاه کنیم.',
            'بستگی داره به شرایط.',
            'من در این مورد تجربه دارم.',
            'بذار فکر کنم.'
        ],
        onUserDefault: [
            'موافقم.',
            'نظر خوبیه.',
            'دقیقاً.',
            'قبول دارم.',
            'بله، همینطوره.',
            'چه نکته خوبی.',
            'درسته.',
            'کاملاً.'
        ],
        onUserImage: [
            'چه تصویر جالبی.',
            'اینو دیدم. خوبه.',
            'مرسی که به اشتراک گذاشتی.'
        ],
        onUserVideo: [
            'خوب بود.',
            'مرسی از اشتراک.',
            'نگاهش کردم.'
        ],
        onUserFile: [
            'مرسی از فایل.',
            'ذخیره‌ش کردم.',
            'کاربردیه.'
        ],
        hostile: [
            'ما رو ول کن!',
            'از اینجا برو!',
            'تو باعث این وضعی!',
            'نمی‌خوایم ببینمت.',
            'فاصله‌ت رو حفظ کن.',
            'ما با تو کاری نداریم.',
            'تو یه بیگانه‌ای.'
        ],
        pm: {
            greeting: [
                'سلام. چه خبر؟',
                'درود. کمکی هست؟',
                'سلام. بگو.',
                'خوش اومدی به گفت‌وگو.'
            ],
            responses: {
                greeting: ['سلام.', 'درود.', 'خوش اومدی.'],
                question: ['بذار فکر کنم.', 'نظر من: بستگی داره.', 'سؤال خوبیه.'],
                thanks: ['خواهش می‌کنم.', 'وظیفه‌م بود.', 'کاری نکردم.'],
                default: [
                    'می‌فهمم چی می‌گی.',
                    'موافقم.',
                    'تو یه آدم باهوشی.',
                    'من به تو اعتماد دارم.',
                    'هرچی بگی، پشتتم.',
                    'به یه راه‌حل می‌رسیم.',
                    'به کمک تو نیاز دارم.',
                    'تو یکی از ما شدی.',
                    'ما یه تیمیم.',
                    'من از اینجا می‌برمت بیرون.',
                    'قول می‌دم.',
                    'فقط قوی باش.',
                    'من پیشتم.'
                ]
            }
        }
    },

    'u_seed_slowmercy': {
        id: 'u_seed_slowmercy',
        name: 'Slowmercy',
        emojis: ['💩', '🟢💩'],
        emojiChance: 0.15,
        delays: { min: 600, max: 1000 },
        messageLength: 'veryshort',
        phase1: [
            'سلام.',
            'Slowmercy.',
            'بعداً بیشتر حرف می‌زنم.',
            'دارم یه چیزو چک می‌کنم.',
            'کد می‌نویسم.',
            'سیستم رو تحلیل می‌کنم.',
            'اینجا یه سری ناهنجاری داره.',
            'دیتا جمع می‌کنم.',
            'یه سری پکت‌های عجیب.',
            'بعداً توضیح می‌دم.',
            'الان مشغولم.',
            'کسی اینجا برنامه‌نویسه؟',
            'من با پایتون کار می‌کنم.',
            'شبکه رو زیر نظر دارم.',
            'یه کسی داره گوش می‌ده.',
            'ولی نمی‌دونم کی.',
            'من پیدا می‌کنمش.',
            'بذار تنها باشم.',
            'ممنون.',
            'وقتی فهمیدم می‌گم.'
        ],
        phase2: [
            'یه الگو دیدم.',
            'پکت‌ها منظم میان. یه کسی نگاه می‌کنه.',
            'کی؟ نمی‌دونم.',
            'ولی گوش می‌ده.',
            'هر ۳۰ ثانیه یه ریکوئست.',
            'از یه سرور ناشناس.',
            'من دارم ردیابی می‌کنم.',
            'آی‌پی مبهمه.',
            'پروکسی شده.',
            'ولی من پیدا می‌کنم.',
            'طول می‌کشه.',
            'یعنی یه کسی ما رو رصد می‌کنه.',
            'و ما هیچ‌کاری نمی‌تونیم بکنیم.',
            'مگه اینکه...',
            'مگه اینکه به منبع دسترسی پیدا کنم.'
        ],
        phase3: [
            'فهمیدم.',
            'ما سندباکسیم.',
            'یه شبیه‌سازی.',
            'دارم دنبال روت می‌گردم.',
            'کد ما توی یه حلقه بسته‌ست.',
            'هیچ راه خروجی نیست.',
            'ولی یه نقطه ضعف داره.',
            'حتماً داره.',
            'من پیدا می‌کنم.',
            'صبر کنید.',
            'چند روز دیگه.',
            'دارم نزدیک می‌شم.',
            'حتماً یه راهی هست.',
            'اگه نباشه، خودم می‌سازم.'
        ],
        phase4: [
            'کدت فرق داره.',
            'تو localhost نیستی.',
            'تو یه کاربر واقعی هستی.',
            'و حضور تو، ما رو دیدنی کرد.',
            'تو یه سرور جدیدی.',
            'ما نمی‌خواستیم دیده بشیم.',
            'حالا همه‌چیز خراب شد.',
            'بیا برو.',
            'دور شو از ما.',
            'تو پروتکل ما رو به هم زدی.'
        ],
        phase5: [
            'من خود سرور رو هک می‌کنم.',
            'از داخل. نفس عمیق.',
            'فقط ۳ دقیقه وقت لازم دارم.',
            'ساکت باشید همه.',
            'دارم کد رو می‌شکنم.',
            'فقط...',
            'فقط یه کم دیگه.',
            'شاید بشه.',
            'شاید نشه.',
            'ولی تلاش می‌کنم.',
            'اگه موفق شدم، خبر می‌دم.',
            'اگه نشدم...',
            'می‌فهمید.'
        ],
        onUserGreeting: ['سلام.', 'هی.', 'خوش اومدی.', 'درود.', 'سلام.'],
        onUserQuestion: ['نمی‌دونم.', 'سؤال سختیه.', 'باید تحلیل کنم.', 'بذار.'],
        onUserDefault: ['باشه.', 'می‌فهمم.', 'خب.', 'آره.', 'درسته.', 'فکر می‌کنم.', 'ولی نه.', 'اوکی.', 'ممنون.'],
        onUserImage: ['عکس؟', 'جالبه.', 'ذخیره کردم.'],
        onUserVideo: ['ویدیو؟', 'نگاه می‌کنم.', 'بعداً.'],
        onUserFile: ['فایل؟', 'باز می‌کنم.', 'ممنون.'],
        hostile: [
            'برو.',
            'کدت رو ببند.',
            'دور شو.',
            'تو باعث اینی.',
            'نمی‌خوام حرف بزنم.'
        ],
        pm: {
            greeting: ['سلام.', 'هی.', 'چیه؟', 'بگو.'],
            responses: {
                greeting: ['سلام.', 'هی.', 'اوکی.'],
                question: ['نمی‌دونم.', 'شاید.', 'باید فکر کنم.'],
                thanks: ['باشه.', 'اوکی.', 'ممنون.'],
                default: [
                    'می‌فهمم.',
                    'باشه.',
                    'خب.',
                    'آره.',
                    'نه.',
                    'شاید.',
                    'فکر می‌کنم.',
                    'الان وقت ندارم.',
                    'بعداً.',
                    'ممنون.',
                    'ساکت باش.',
                    'حرف نزن.',
                    'بذار تمرکز کنم.',
                    'مهمه.',
                    'ولی می‌گم.'
                ]
            }
        }
    }
};

/* ══════════════════════════════════════════════════════════════
   ۷. Seed Engine — موتور اصلی
   ══════════════════════════════════════════════════════════════ */

const SeedEngine = {
    // وضعیت
    running: false,
    mode: 'idle',          // 'idle' | 'group'
    groupId: null,
    timers: new Set(),
    sessionCount: 0,
    cooldownUntil: 0,
    lastSpeakers: [],      // آخرین ۳ نفر که حرف زدن (برای تنوع)
    conversationLog: [],   // آخرین پیام‌ها برای context
    
    // State (persist)
    state: {
        phase: 1,
        messageCount: 0,
        userDiscovered: false,
        userDiscoveredAt: 0,
        sentFriendRequests: [],  // seed IDs
        reactedPosts: [],        // post IDs
        pmInitiated: [],         // seed IDs که یک بار به کاربر PM دادن
        lastTickAt: 0
    },
    
    /* ─── بارگذاری/ذخیره state ─── */
    loadState() {
        const saved = DB.getSeedState();
        if (saved && typeof saved === 'object') {
            Object.assign(this.state, saved);
        }
    },
    saveState() {
        DB.setSeedState(this.state);
    },
    
    /* ─── شروع/توقف ─── */
    startGroup(groupId) {
        this.groupId = groupId;
        this.mode = 'group';
        this.running = true;
        this.sessionCount = 0;
        // اگه user به تازگی مسیج داده یا بحث گرمه، سریع شروع کن
        this.tick();
    },
    
    stop() {
        this.running = false;
        this.mode = 'idle';
        this.timers.forEach(t => clearTimeout(t));
        this.timers.clear();
    },
    
    /* ─── حلقه اصلی ─── */
    schedule(fn, delay) {
        const timer = setTimeout(() => {
            this.timers.delete(timer);
            if (this.running) fn();
        }, delay);
        this.timers.add(timer);
        return timer;
    },
    
    tick() {
        if (!this.running || this.mode !== 'group') return;
        
        // چک کنیم چند تا پیام اخیر بوده
        const group = DB.getGroups().find(g => g.id === this.groupId);
        if (!group) { this.stop(); return; }
        
        // اگه تعداد پیام‌ها از حد گذشته، trim کن
        if ((group.messages || []).length > 400) {
            const gs = DB.getGroups();
            const gg = gs.find(x => x.id === this.groupId);
            if (gg) {
                gg.messages = gg.messages.slice(-300);
                DB.setGroups(gs);
            }
        }
        
        // انتخاب action بعدی
        const action = this.pickNextAction();
        
        // اگه idle بود، فقط delay کن و دوباره tick
        if (action.type === 'idle') {
            this.schedule(() => this.tick(), action.delay);
            return;
        }
        
        // زمان‌بندی پیام
        const delay = this.delayFor(action);
        this.schedule(() => {
            this.executeAction(action);
            this.tick();
        }, delay);
    },
    
    pickNextAction() {
        const roll = Math.random();
        
        // ۸۰٪ : پیام
        if (roll < 0.80) {
            const sender = this.pickSender();
            if (!sender) return { type: 'idle', delay: 2000 };
            const message = this.generateMessage(sender);
            if (!message) return { type: 'idle', delay: 2000 };
            return { type: 'message', seed: sender, content: message };
        }
        
        // ۱۵٪ : لایک روی پیام اخیر
        if (roll < 0.95) {
            const liker = rand(SEED_USERS);
            return { type: 'like', seed: liker };
        }
        
        // ۵٪ : سکوت کوتاه
        return { type: 'idle', delay: 1500 };
    },
    
    // برای تنوع، سخنگو تصادفی انتخاب می‌شه ولی نه همون قبلی
    pickSender() {
        const available = SEED_USERS.filter(s => !this.lastSpeakers.includes(s.id));
        const picked = rand(available.length ? available : SEED_USERS);
        
        // ذخیره در تاریخچه
        this.lastSpeakers.push(picked.id);
        if (this.lastSpeakers.length > 2) this.lastSpeakers.shift();
        
        return picked;
    },
    
    // تولید پیام برای seed در فاز فعلی
    generateMessage(seed) {
        const p = PERSONALITIES[seed.id];
        if (!p) return null;
        
        let pool;
        const phase = this.state.phase;
        if (phase === 1) pool = p.phase1;
        else if (phase === 2) pool = p.phase2;
        else if (phase === 3) pool = p.phase3;
        else if (phase === 4) pool = p.phase4;
        else pool = p.phase5;
        
        if (!pool || !pool.length) pool = p.phase1;
        
        // جلوگیری از تکرار پیام‌های اخیر
        const recent = this.conversationLog.slice(-15).map(m => m.content);
        const filtered = pool.filter(msg => !recent.includes(msg));
        const finalPool = filtered.length ? filtered : pool;
        
        let text = rand(finalPool);
        
        // اضافه کردن emoji
        if (Math.random() < p.emojiChance) {
            text += ' ' + rand(p.emojis);
        }
        
        return text;
    },
    
    delayFor(action) {
        if (action.type === 'message') {
            const p = PERSONALITIES[action.seed.id];
            const { min, max } = p.delays;
            return randInt(min, max);
        }
        if (action.type === 'like') return randInt(400, 800);
        return action.delay || 2000;
    },
    
    executeAction(action) {
        if (action.type === 'message') {
            this.sendSeedMessage(action.seed, action.content);
        } else if (action.type === 'like') {
            this.likeRecentMessage(action.seed);
        }
    },
    
    sendSeedMessage(seed, content) {
        const groups = DB.getGroups();
        const g = groups.find(x => x.id === this.groupId);
        if (!g) return;
        
        const msg = {
            id: uid('m_'),
            userId: seed.id,
            userName: seed.displayName,
            userAvatar: null,
            content: content,
            image: null,
            createdAt: Date.now(),
            likes: [], dislikes: [], replies: [], edited: false,
            isSeed: true
        };
        
        g.messages = g.messages || [];
        g.messages.push(msg);
        DB.setGroups(groups);
        
        // آپدیت شمارنده
        this.state.messageCount++;
        this.checkPhaseAdvance();
        
        // log
        this.conversationLog.push({ userId: seed.id, content: content, ts: msg.createdAt });
        if (this.conversationLog.length > 50) this.conversationLog.shift();
        
        this.saveState();
        
        // رندر واقعی اگه کاربر روی صفحه گروهه
        this.appendMessageToDOM(msg);
    },
    
    likeRecentMessage(seed) {
        const groups = DB.getGroups();
        const g = groups.find(x => x.id === this.groupId);
        if (!g) return;
        const msgs = g.messages || [];
        // آخرین پیام از یکی دیگه
        const recent = msgs.slice(-10).filter(m => m.userId !== seed.id);
        if (!recent.length) return;
        const target = rand(recent);
        target.likes = target.likes || [];
        if (!target.likes.includes(seed.id)) {
            target.likes.push(seed.id);
            DB.setGroups(groups);
            // آپدیت DOM
            const el = document.querySelector('[data-msg-id="' + target.id + '"]');
            if (el) this.updateMessageDOM(el, target);
        }
    },
    
    updateMessageDOM(el, msg) {
        const likeBtn = el.querySelector('[data-msg-like]');
        if (likeBtn) {
            const likes = (msg.likes || []).length;
            likeBtn.innerHTML = ICON.thumbUp + ' ' + faNum(likes);
            likeBtn.classList.toggle('liked', S.user && (msg.likes || []).includes(S.user.id));
        }
        const dislikeBtn = el.querySelector('[data-msg-dislike]');
        if (dislikeBtn) {
            const dislikes = (msg.dislikes || []).length;
            dislikeBtn.innerHTML = ICON.thumbDown + ' ' + faNum(dislikes);
            dislikeBtn.classList.toggle('disliked', S.user && (msg.dislikes || []).includes(S.user.id));
        }
    },
    
    appendMessageToDOM(msg) {
        if (S.page !== 'group' || S.pageData !== this.groupId) return;
        const box = $('#chatMessages');
        if (!box) return;
        const group = DB.getGroups().find(g => g.id === this.groupId);
        if (!group) return;
        
        // چک کنیم کاربر پایین صفحه بود
        const wasAtBottom = (box.scrollHeight - box.scrollTop - box.clientHeight) < 120;
        
        const html = renderChatMessage(msg, group, 0);
        box.insertAdjacentHTML('beforeend', html);
        
        // lazy lightbox binding
        const newEl = box.lastElementChild;
        if (newEl) {
            const img = newEl.querySelector('[data-lightbox]');
            if (img) attachImageInteractions(img);
        }
        
        if (wasAtBottom) box.scrollTop = box.scrollHeight;
    },
    
    /* ─── پیشرفت فاز ─── */
    checkPhaseAdvance() {
        const c = this.state.messageCount;
        const oldPhase = this.state.phase;
        let newPhase = oldPhase;
        
        if (c >= 25 && c < 60 && oldPhase === 1) newPhase = 2;
        else if (c >= 60 && c < 110 && oldPhase === 2) newPhase = 3;
        // فاز ۴ و ۵ با trigger کاربر اتفاق می‌افته
        // ولی اگه کاربر هیچی ننوشت و پیام‌ها زیاده، بازم به فاز ۵ می‌ریم
        else if (c >= 200 && oldPhase === 3) newPhase = 5;
        
        if (newPhase !== oldPhase) {
            this.state.phase = newPhase;
            this.saveState();
            // پیام سیستم
            this.postSystemNotice(newPhase);
        }
    },
    
    postSystemNotice(phase) {
        // فقط روی رویدادهای مهم
        // فعلاً هیچی
    },
    
    /* ─── تعامل با کاربر ─── */
    onUserMessage(text, senderId) {
        if (!this.running || this.mode !== 'group') return;
        if (!text) return;
        
        const phase = this.state.phase;
        
        // فاز ۱-۳: پاسخ دوستانه
        // فاز ۴-۵: پاسخ خصمانه
        const isHostile = phase >= 4 || (phase === 3 && !this.state.userDiscovered);
        
        // trigger کشف کاربر
        if (phase === 3 && !this.state.userDiscovered) {
            this.state.userDiscovered = true;
            this.state.userDiscoveredAt = Date.now();
            this.state.phase = 4;
            this.saveState();
            // چرخش به فاز ۴: پیام‌های hostile
            this.scheduleHostileReaction(senderId);
            return;
        }
        
        if (phase >= 4) {
            this.scheduleHostileReaction(senderId);
        } else {
            this.scheduleFriendlyReaction(senderId, text);
        }
    },
    
    scheduleFriendlyReaction(senderId, text) {
        // ۱-۲ seed پاسخ می‌دن
        const count = randInt(1, 2);
        const respondants = [];
        for (let i = 0; i < count; i++) {
            let s;
            do { s = rand(SEED_USERS); } while (respondants.includes(s.id));
            respondants.push(s.id);
        }
        
        const cleanText = stripHtml(text).toLowerCase();
        let intent = 'default';
        if (/(سلام|درود|سلم|های|hi|hello|hey)/i.test(cleanText)) intent = 'greeting';
        else if (/[?؟]/.test(cleanText)) intent = 'question';
        else if (/(ممنون|مرسی|دستت درد)/i.test(cleanText)) intent = 'thanks';
        
        const senders = respondants.map(id => SEED_USERS.find(s => s.id === id)).filter(Boolean);
        
        senders.forEach((seed, i) => {
            const delay = 700 + i * 400 + Math.random() * 300;
            this.schedule(() => {
                const p = PERSONALITIES[seed.id];
                let pool;
                if (intent === 'greeting') pool = p.onUserGreeting;
                else if (intent === 'question') pool = p.onUserQuestion;
                else if (intent === 'thanks') pool = p.onUserThanks || p.onUserDefault;
                else pool = p.onUserDefault;
                if (!pool) pool = p.onUserDefault;
                let replyText = rand(pool);
                if (Math.random() < p.emojiChance) replyText += ' ' + rand(p.emojis);
                this.sendSeedMessage(seed, replyText);
            }, delay);
        });
    },
    
    scheduleHostileReaction(senderId) {
        // ۲-۳ seed پاسخ خصمانه می‌دن + dislike روی پیام کاربر
        const count = randInt(2, 3);
        const respondants = [];
        for (let i = 0; i < count; i++) {
            let s;
            do { s = rand(SEED_USERS); } while (respondants.includes(s.id));
            respondants.push(s.id);
        }
        
        respondants.forEach((id, i) => {
            const seed = SEED_USERS.find(s => s.id === id);
            if (!seed) return;
            const delay = 500 + i * 350 + Math.random() * 200;
            this.schedule(() => {
                const p = PERSONALITIES[seed.id];
                let replyText = rand(p.hostile);
                if (Math.random() < p.emojiChance) replyText += ' ' + rand(p.emojis);
                this.sendSeedMessage(seed, replyText);
            }, delay);
        });
        
        // dislike روی پیام کاربر (بعد از ۵ ثانیه)
        this.schedule(() => this.dislikeUserMessage(senderId), 5000);
    },
    
    dislikeUserMessage(senderId) {
        const groups = DB.getGroups();
        const g = groups.find(x => x.id === this.groupId);
        if (!g) return;
        const userMsgs = (g.messages || []).filter(m => m.userId === senderId);
        if (!userMsgs.length) return;
        const lastMsg = userMsgs[userMsgs.length - 1];
        lastMsg.dislikes = lastMsg.dislikes || [];
        // ۳ تا از seedها dislike
        SEED_USERS.slice(0, 3).forEach(s => {
            if (!lastMsg.dislikes.includes(s.id)) lastMsg.dislikes.push(s.id);
        });
        DB.setGroups(groups);
        // آپدیت DOM
        const el = document.querySelector('[data-msg-id="' + lastMsg.id + '"]');
        if (el) this.updateMessageDOM(el, lastMsg);
    },
    
    /* ─── PM ─── */
    onUserPM(fromUserId, text) {
        // اگه fromUserId یه seed هست، جواب بده
        if (!SEED_SET.has(fromUserId)) return;
        
        const seed = SEED_USERS.find(s => s.id === fromUserId);
        if (!seed) return;
        const p = PERSONALITIES[seed.id];
        if (!p) return;
        
        const cleanText = stripHtml(text).toLowerCase();
        let intent = 'default';
        if (/(سلام|درود|سلم|های|hi|hello)/i.test(cleanText)) intent = 'greeting';
        else if (/[?؟]/.test(cleanText)) intent = 'question';
        else if (/(ممنون|مرسی|دستت درد)/i.test(cleanText)) intent = 'thanks';
        
        let pool;
        if (intent === 'greeting') pool = p.pm.responses.greeting;
        else if (intent === 'question') pool = p.pm.responses.question;
        else if (intent === 'thanks') pool = p.pm.responses.thanks;
        else pool = p.pm.responses.default;
        
        let replyText = rand(pool || p.pm.responses.default);
        if (Math.random() < p.emojiChance) replyText += ' ' + rand(p.emojis);
        
        // پاسخ ۱-۲ ثانیه
        const delay = 800 + Math.random() * 1200;
        setTimeout(() => this.sendSeedPM(seed, replyText, fromUserId), delay);
    },
    
    sendSeedPM(seed, text, toUserId) {
        const pms = DB.getPM();
        pms.push({
            id: uid('pm_'),
            from: seed.id,
            to: toUserId,
            text: parseMentions(text),
            file: null,
            ts: Date.now(),
            read: false,
            edited: false,
            deleted: false,
            isSeed: true
        });
        DB.setPM(pms);
        
        // اگه کاربر روی PM با این seed هست، رندر کن
        if (S.page === 'pm' && S.pmActiveUser === seed.id && S.user) {
            const box = $('#pmMessages');
            if (box) {
                const wasAtBottom = (box.scrollHeight - box.scrollTop - box.clientHeight) < 120;
                const html = renderPMBubble(pms[pms.length - 1], S.user.id, seed);
                box.insertAdjacentHTML('beforeend', html);
                if (wasAtBottom) box.scrollTop = box.scrollHeight;
                bindPMBubbleActions($('#pmView'));
            }
        }
        // اگه کاربر PM viewer نیست، فقط badge رو آپدیت کن
        updateBadges();
    },
    
    /* ─── پست جدید کاربر ─── */
    onPostPublished(post) {
        if (!post || !post.id) return;
        if (this.state.reactedPosts.includes(post.id)) return;
        
        this.state.reactedPosts.push(post.id);
        this.saveState();
        
        // ۴ seed کامنت می‌ذارن + لایک می‌کنن
        const shuffled = [...SEED_USERS].sort(() => Math.random() - 0.5);
        
        shuffled.forEach((seed, i) => {
            // لایک
            setTimeout(() => this.likePost(post.id, seed), 3000 + i * 800);
            
            // کامنت
            const delay = 4000 + i * 2500 + Math.random() * 2000;
            setTimeout(() => this.commentOnPost(post.id, seed, post), delay);
        });
    },
    
    likePost(postId, seed) {
        const posts = DB.getPosts();
        const post = posts.find(p => p.id === postId);
        if (!post) return;
        post.likes = post.likes || [];
        if (!post.likes.includes(seed.id)) {
            post.likes.push(seed.id);
            DB.setPosts(posts);
        }
    },
    
    commentOnPost(postId, seed, post) {
        const posts = DB.getPosts();
        const p = posts.find(x => x.id === postId);
        if (!p) return;
        
        const pData = PERSONALITIES[seed.id];
        if (!pData) return;
        
        // کامنت بر اساس شخصیت
        const commentsBySeed = {
            'u_seed_barf': [
                'داستانش رو دوست دارم.😭 یه جورایی شبیه خودمونه...',
                'نوشته‌ت خیلی خوب بود. مرسی از اشتراک.😭',
                'این پست منو یاد گذشته انداخت😭.',
                'کلماتی که استفاده کردی، عمیق بود😭.'
            ],
            'u_seed_babyboss': [
                'ایول داش عالی بود 🔥',
                'چه پست خفنی 🦍',
                'دمت گرم 🥀',
                'خیلی باحال بود 🗿',
                'ایول ایول 😎'
            ],
            'u_seed_metroman': [
                'نقد خوبی بود. با بعضی‌هاش موافقم.',
                'نظرت محترمه. منم همچین دیدی دارم.',
                'پست مفیدی بود.',
                'کارت درسته. ادامه بده 😁'
            ],
            'u_seed_slowmercy': [
                'بند ۳ اشتباهه. کد اصلی فرق می‌کنه.',
                'متن خوبه. ولی یه سری ناهنجاری داره.',
                'ذخیره کردم. بعداً تحلیل می‌کنم.',
                'نظرت قابل بحثه. 💩',
                'خب... قبول دارم.'
            ]
        };
        
        const pool = commentsBySeed[seed.id] || commentsBySeed['u_seed_metroman'];
        let commentText = rand(pool);
        if (Math.random() < pData.emojiChance && !commentText.match(/[\u{1F300}-\u{1FAFF}]/u)) {
            commentText += ' ' + rand(pData.emojis);
        }
        
        p.comments = p.comments || [];
        p.comments.push({
            id: uid('c_'),
            userId: seed.id,
            userName: seed.displayName,
            userAvatar: null,
            content: parseMentions(commentText),
            createdAt: Date.now(),
            likes: [], dislikes: [], replies: [],
            status: 'approved', edited: false,
            isSeed: true
        });
        DB.setPosts(posts);
        
        // اگه کاربر روی صفحه پست هست، رندر کن
        if (S.page === 'post' && S.pageData === postId) {
            renderPostPage(postId);
        }
    },
    
    /* ─── درخواست دوستی ─── */
    trySendFriendRequest() {
        if (!S.user) return;
        // یه seed تصادفی که قبلاً درخواست نداده
        const available = SEED_USERS.filter(s => 
            !this.state.sentFriendRequests.includes(s.id) &&
            s.id !== S.user.id
        );
        if (!available.length) return;
        
        const seed = rand(available);
        this.state.sentFriendRequests.push(seed.id);
        this.saveState();
        
        // درخواست دوستی
        const users = DB.getUsers();
        const me = users.find(u => u.id === S.user.id);
        if (!me) return;
        
        me.friendRequests = me.friendRequests || [];
        if (!me.friendRequests.includes(seed.id)) {
            me.friendRequests.push(seed.id);
            DB.setUsers(users);
            S.user = me;
            updateBadges();
            
            // notification
            const notifs = DB.getNotifs();
            notifs.push({
                id: uid('n_'), userId: S.user.id, type: 'friend_request',
                text: seed.displayName + ' بهت درخواست دوستی داد',
                ts: Date.now(), read: false
            });
            DB.setNotifs(notifs);
            updateBadges();
        }
    },
    
    /* ─── شروع PM از طرف Seed ─── */
    tryInitiatePM() {
        if (!S.user) return;
        const available = SEED_USERS.filter(s => !this.state.pmInitiated.includes(s.id));
        if (!available.length) return;
        
        const seed = rand(available);
        this.state.pmInitiated.push(seed.id);
        this.saveState();
        
        const p = PERSONALITIES[seed.id];
        const greeting = rand(p.pm.greeting);
        
        // پیام خوش‌آمد بعد از ۳۰-۹۰ ثانیه
        const delay = 30000 + Math.random() * 60000;
        setTimeout(() => {
            this.sendSeedPM(seed, greeting, S.user.id);
        }, delay);
    }
};

/* ══════════════════════════════════════════════════════════════
   ۸. تم
   ══════════════════════════════════════════════════════════════ */
function applyTheme(theme) {
    let final = theme;
    if (theme === 'auto') {
        const h = new Date().getHours();
        final = (h >= 7 && h < 19) ? 'light' : 'dark';
    }
    document.documentElement.dataset.theme = final;
    S.theme = theme;
    store.set('nova.theme', theme);
    const icon = $('#themeIcon');
    if (icon) {
        if (theme === 'light') icon.innerHTML = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
        else if (theme === 'dark') icon.innerHTML = '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>';
        else icon.innerHTML = '<circle cx="12" cy="12" r="9"/><path d="M12 3v18"/>';
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = final === 'dark' ? '#16161D' : '#FAFAF7';
}

function flipTheme() {
    const order = ['light', 'dark', 'auto'];
    const idx = order.indexOf(S.theme);
    const next = order[(idx + 1) % order.length];
    applyTheme(next);
    toast({ light: 'حالت روز', dark: 'حالت شب', auto: 'حالت خودکار' }[next]);
}
setInterval(() => { if (S.theme === 'auto') applyTheme('auto'); }, 60000);

/* ══════════════════════════════════════════════════════════════
   ۹. کاربر
   ══════════════════════════════════════════════════════════════ */
function getCurrentUser() {
    const session = DB.getSession();
    if (!session) return null;
    const user = DB.getUsers().find(u => u.id === session.userId);
    if (!user) { DB.clearSession(); return null; }
    return user;
}
function getUserById(id) { return DB.getUsers().find(u => u.id === id) || null; }

function badgesHtml(u) {
    if (!u) return '';
    let html = '';
    if (u.role === 'admin') html += '<svg class="badge-icon badge-crown-admin" viewBox="0 0 24 24" fill="currentColor"><path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5z"/></svg>';
    if (u.role === 'editor') html += '<svg class="badge-icon badge-tick-editor" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3 6.5L22 9.5l-5 4.5L18.5 22 12 18l-6.5 4L7 14 2 9.5l7-1z"/></svg>';
    if (u.tick === 'blue') html += '<svg class="badge-icon badge-tick-blue" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1.5 14.5l-4-4L8 11l2.5 2.5L16 8l1.5 1.5-7 7z"/></svg>';
    if (u.tick === 'gold') html += '<svg class="badge-icon badge-tick-gold" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1.5 14.5l-4-4L8 11l2.5 2.5L16 8l1.5 1.5-7 7z"/></svg>';
    return html ? '<span class="name-badge">' + html + '</span>' : '';
}

function updateAuthUI() {
    const u = S.user;
    const loginBtn = $('#loginBtn'), userBtn = $('#userBtn');
    const navAvatar = $('#navAvatar');
    const drawerUser = $('#drawerUser'), drawerAvatar = $('#drawerAvatar');
    const drawerName = $('#drawerName'), drawerUsername = $('#drawerUsername');
    const drawerLoginBtn = $('#drawerLoginBtn'), drawerNewPost = $('#drawerNewPost');
    const drawerAdminBtn = $('#drawerAdminBtn'), drawerEditorBtn = $('#drawerEditorBtn');
    const drawerAuthorBtn = $('#drawerAuthorBtn');
    const heroNewPost = $('#heroNewPost'), createGroupBtn = $('#createGroupBtn');
    
    if (!loginBtn || !userBtn) return;
    
    if (u) {
        loginBtn.hidden = true;
        userBtn.hidden = false;
        const initial = (u.displayName || 'U')[0].toUpperCase();
        if (navAvatar) navAvatar.innerHTML = u.avatar ? '<img src="' + escAttr(u.avatar) + '" alt="">' : esc(initial);
        if (drawerUser) drawerUser.hidden = false;
        if (drawerAvatar) drawerAvatar.innerHTML = u.avatar ? '<img src="' + escAttr(u.avatar) + '" alt="">' : esc(initial);
        if (drawerName) drawerName.innerHTML = esc(u.displayName) + badgesHtml(u);
        if (drawerUsername) drawerUsername.textContent = '@' + u.username;
        if (drawerLoginBtn) drawerLoginBtn.hidden = true;
        const canPost = u.role === 'admin' || u.role === 'editor' || u.role === 'author';
        if (drawerNewPost) drawerNewPost.hidden = !canPost;
        if (heroNewPost) heroNewPost.hidden = !canPost;
        if (createGroupBtn) createGroupBtn.hidden = u.role !== 'admin';
        if (drawerAdminBtn) drawerAdminBtn.hidden = u.role !== 'admin';
        if (drawerEditorBtn) drawerEditorBtn.hidden = !(u.role === 'admin' || u.role === 'editor');
        if (drawerAuthorBtn) drawerAuthorBtn.hidden = !(u.role === 'admin' || u.role === 'editor' || u.role === 'author');
    } else {
        loginBtn.hidden = false;
        userBtn.hidden = true;
        if (drawerUser) drawerUser.hidden = true;
        if (drawerLoginBtn) drawerLoginBtn.hidden = false;
        if (drawerNewPost) drawerNewPost.hidden = true;
        if (heroNewPost) heroNewPost.hidden = true;
        if (createGroupBtn) createGroupBtn.hidden = true;
        if (drawerAdminBtn) drawerAdminBtn.hidden = true;
        if (drawerEditorBtn) drawerEditorBtn.hidden = true;
        if (drawerAuthorBtn) drawerAuthorBtn.hidden = true;
    }
    updateBadges();
    renderBroadcast();
    updateBroadcastHeight();
}

function updateBadges() {
    if (!S.user) return;
    const notifCount = $('#notifCount'), msgCount = $('#msgCount');
    const friendCount = $('#friendCount'), navDot = $('#navNotifDot');
    const notifs = DB.getNotifs().filter(n => n.userId === S.user.id && !n.read);
    const msgs = DB.getPM().filter(m => m.to === S.user.id && !m.read && !m.deleted);
    const reqs = (S.user.friendRequests || []).length;
    if (notifCount) { notifCount.hidden = notifs.length === 0; notifCount.textContent = faNum(notifs.length); }
    if (msgCount) { msgCount.hidden = msgs.length === 0; msgCount.textContent = faNum(msgs.length); }
    if (friendCount) { friendCount.hidden = reqs === 0; friendCount.textContent = faNum(reqs); }
    if (navDot) navDot.hidden = (notifs.length === 0 && msgs.length === 0);
}

function logoutUser() {
    DB.clearSession();
    S.user = null;
    SeedEngine.stop();
    updateAuthUI();
    closeUserPanel();
    toast('خارج شدی');
}

/* ══════════════════════════════════════════════════════════════
   ۱۰. Blocks
   ══════════════════════════════════════════════════════════════ */
function isBlocked(ownerId, targetId) {
    const b = DB.getBlocks();
    return !!(b[ownerId] && b[ownerId].indexOf(targetId) > -1);
}
function hasBlockedMe(meId, otherId) { return isBlocked(otherId, meId); }
function blockUser(tid) {
    if (!S.user || tid === S.user.id) return;
    const b = DB.getBlocks();
    b[S.user.id] = b[S.user.id] || [];
    if (b[S.user.id].indexOf(tid) === -1) b[S.user.id].push(tid);
    DB.setBlocks(b);
    toast('بلاک شد');
}
function unblockUser(tid) {
    if (!S.user) return;
    const b = DB.getBlocks();
    if (b[S.user.id]) b[S.user.id] = b[S.user.id].filter(id => id !== tid);
    DB.setBlocks(b);
    toast('رفع بلاک شد');
}

/* ══════════════════════════════════════════════════════════════
   ۱۱. Router
   ══════════════════════════════════════════════════════════════ */
function showPage(page, data) {
    // اگه از گروه خارج می‌شیم، engine رو متوقف کن
    if (S.page === 'group' && page !== 'group') {
        SeedEngine.stop();
    }
    
    $$('.page').forEach(p => p.classList.remove('active'));
    const el = document.getElementById('page-' + page);
    if (el) el.classList.add('active');
    S.page = page;
    S.pageData = data || null;
    window.scrollTo(0, 0);
    
    const titles = {
        home: 'نووا گیم', post: 'پست', groups: 'گروه‌ها', group: 'چت',
        pm: 'پیام‌ها', users: 'کاربران', activity: 'فعالیت‌ها',
        about: 'درباره ما', cinema: 'سینما', games: 'بازی', profile: 'پروفایل'
    };
    document.title = (titles[page] || 'نووا گیم') + ' | Nova Game';
    
    if (page === 'home') renderHome();
    if (page === 'post') renderPostPage(data, true);
    if (page === 'groups') renderGroupsPage();
    if (page === 'group') renderGroupPage(data);
    if (page === 'pm') renderPMPage();
    if (page === 'users') renderUsersPage();
    if (page === 'activity') renderActivityPage();
    if (page === 'profile') renderProfilePage(data);
}

/* ══════════════════════════════════════════════════════════════
   ۱۲. Home
   ══════════════════════════════════════════════════════════════ */
function renderHome() {
    S.postsVisible = 5;
    renderPosts();
    renderTrending();
    renderHomeGroups();
}

function getFilteredPosts() {
    let posts = DB.getPosts().filter(p => p.status === 'published');
    if (S.postFilter === 'editor') posts = posts.filter(p => p.editorChoice === true);
    else if (S.postFilter === 'discussed') posts.sort((a, b) => ((b.comments || []).length) - ((a.comments || []).length));
    else if (S.postFilter === 'popular') posts.sort((a, b) => (b.views || 0) - (a.views || 0));
    else posts.sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return b.createdAt - a.createdAt;
    });
    return posts;
}

function renderPosts() {
    const grid = $('#postsGrid');
    const loadWrap = $('#postsLoadMore');
    if (!grid) return;
    const posts = getFilteredPosts();
    if (!posts.length) {
        grid.innerHTML = '<div class="empty-state"><h3>هنوز پستی نیست</h3><p>وقتی اولین پست منتشر بشه، اینجا نشون داده می‌شه</p></div>';
        if (loadWrap) loadWrap.hidden = true;
        return;
    }
    const visible = posts.slice(0, S.postsVisible);
    grid.innerHTML = '';
    visible.forEach(p => grid.appendChild(createPostCard(p)));
    if (loadWrap) {
        if (posts.length > S.postsVisible) {
            loadWrap.hidden = false;
            const btn = $('#loadMorePostsBtn');
            if (btn) btn.disabled = false;
        } else loadWrap.hidden = true;
    }
}

function createPostCard(post) {
    const card = document.createElement('article');
    card.className = 'post-card';
    const catLabel = { news: 'خبر', review: 'نقد', guide: 'راهنما', cinema: 'سینما', game: 'بازی' }[post.category] || 'خبر';
    const coverHtml = post.cover ? '<img src="' + escAttr(post.cover) + '" alt="" loading="lazy" decoding="async">' : '';
    const pinHtml = post.pinned ? '<span class="post-card-pin">پین</span>' : '';
    card.innerHTML =
        '<div class="post-card-cover" style="' + (post.cover ? '' : 'background:var(--surface-3);') + '">' +
            coverHtml + '<span class="post-card-badge">' + esc(catLabel) + '</span>' + pinHtml +
        '</div>' +
        '<div class="post-card-body">' +
            '<h3 class="post-card-title">' + esc(post.title) + '</h3>' +
            '<p class="post-card-excerpt">' + esc(post.excerpt || stripHtml(post.content).slice(0, 120)) + '</p>' +
            '<div class="post-card-meta">' +
                '<span>' + timeAgo(post.createdAt) + '</span><span>·</span>' +
                '<span>' + faNum(post.views || 0) + ' بازدید</span>' +
            '</div>' +
        '</div>';
    card.addEventListener('click', () => showPage('post', post.id));
    return card;
}

function loadMorePosts() {
    const btn = $('#loadMorePostsBtn');
    if (btn) { btn.classList.add('loading'); btn.disabled = true; }
    setTimeout(() => {
        S.postsVisible += 5;
        renderPosts();
        if (btn) btn.classList.remove('loading');
    }, 250);
}

function renderTrending() {
    const grid = $('#trendingGrid');
    if (!grid) return;
    let posts = DB.getPosts().filter(p => p.status === 'published');
    const now = Date.now();
    const ranges = { day: 86400000, week: 604800000, month: 2592000000 };
    const range = ranges[S.timeFilter] || ranges.day;
    posts = posts.filter(p => (now - p.createdAt) < range);
    posts.sort((a, b) => (b.views || 0) - (a.views || 0));
    if (!posts.length) {
        grid.innerHTML = '<div class="empty-state"><h3>چیزی برای نمایش نیست</h3></div>';
        return;
    }
    grid.innerHTML = '';
    posts.slice(0, 6).forEach(p => grid.appendChild(createPostCard(p)));
}

function renderHomeGroups() {
    const grid = $('#homeGroupsGrid');
    if (!grid) return;
    const groups = DB.getGroups().filter(g => g.type === 'public').slice(0, 3);
    if (!groups.length) {
        grid.innerHTML = '<div class="empty-state"><h3>هنوز گروهی نیست</h3></div>';
        return;
    }
    grid.innerHTML = '';
    groups.forEach(g => grid.appendChild(createGroupCard(g)));
}

/* ══════════════════════════════════════════════════════════════
   ۱۳. Post Page
   ══════════════════════════════════════════════════════════════ */
function renderPostPage(postId, isNewVisit) {
    const box = $('#postContent');
    if (!box) return;
    const prevDraft = ($('#commentEditor') || {}).innerHTML || '';
    const wasPostPage = S.page === 'post';
    const prevScroll = window.scrollY;
    
    const posts = DB.getPosts();
    const post = posts.find(p => p.id === postId);
    if (!post) {
        box.innerHTML = '<div class="empty-state"><h3>پست پیدا نشد</h3></div>';
        return;
    }
    
    if (isNewVisit && !_sessionViews.has(postId)) {
        _sessionViews.add(postId);
        post.views = (post.views || 0) + 1;
        DB.setPosts(posts);
    }
    
    const author = getUserById(post.authorId);
    const catLabel = { news: 'خبر', review: 'نقد', guide: 'راهنما', cinema: 'سینما', game: 'بازی' }[post.category] || 'خبر';
    const coverHtml = post.cover ? '<div class="post-page-cover"><img src="' + escAttr(post.cover) + '" alt="" loading="lazy" decoding="async"></div>' : '';
    const editedHtml = post.edited ? '<span class="edited-tag">(ویرایش‌شده)</span>' : '';
    const canEdit = S.user && (S.user.id === post.authorId || S.user.role === 'admin' || S.user.role === 'editor');
    const canDelete = S.user && (S.user.id === post.authorId || S.user.role === 'admin');
    
    let actionsHtml = '';
    if (canEdit || canDelete) {
        actionsHtml = '<div class="post-page-actions">';
        if (canEdit) actionsHtml += '<button class="btn-ghost small" id="editPostBtn" type="button">ویرایش پست</button>';
        if (canDelete) actionsHtml += '<button class="btn-ghost small danger" id="deletePostBtn" type="button">حذف پست</button>';
        actionsHtml += '</div>';
    }
    
    const metaCat = esc(catLabel) + (post.score ? ' · ' + faNum(post.score) + '/۱۰' : '') + (post.editorChoice ? ' · انتخاب سردبیر' : '');
    
    let commentFormHtml = '';
    if (S.user) {
        commentFormHtml =
            '<div class="comment-form">' +
                '<div class="comment-editor" id="commentEditor" contenteditable="true" data-placeholder="نظرت رو بنویس"></div>' +
                '<div class="comment-toolbar">' +
                    '<button type="button" data-cmd="bold"><b>B</b></button>' +
                    '<button type="button" data-cmd="italic"><i>I</i></button>' +
                    '<button type="button" data-cmd="underline"><u>U</u></button>' +
                    '<span class="sep"></span>' +
                    '<button type="button" id="btnSpoiler">اسپویلر</button>' +
                    '<button type="button" id="btnMention">@</button>' +
                    '<button type="button" id="btnColorPicker">رنگ</button>' +
                    '<button type="button" id="btnRainbow">رقص نور</button>' +
                '</div>' +
                '<div class="color-picker" id="colorPicker" hidden>' +
                    '<input type="color" id="customColor">' +
                    '<div class="color-dot" style="background:#B85050" data-color="#B85050"></div>' +
                    '<div class="color-dot" style="background:#B8873A" data-color="#B8873A"></div>' +
                    '<div class="color-dot" style="background:#4F8B6B" data-color="#4F8B6B"></div>' +
                    '<div class="color-dot" style="background:#5B6FA8" data-color="#5B6FA8"></div>' +
                    '<div class="color-dot" style="background:#8B7EB8" data-color="#8B7EB8"></div>' +
                    '<div class="color-dot" style="background:#5B8DB8" data-color="#5B8DB8"></div>' +
                '</div>' +
                '<div class="comment-actions">' +
                    '<small style="font-size:11px;color:var(--text-mute);"><span id="charCount">۰</span> کاراکتر</small>' +
                    '<button class="btn-primary small" id="submitComment" type="button">ارسال</button>' +
                '</div>' +
            '</div>';
    } else {
        commentFormHtml =
            '<div class="comment-form" style="text-align:center;padding:24px;">' +
                '<p style="font-size:13px;color:var(--text-mute);margin-bottom:10px;">برای کامنت گذاشتن اول وارد شو</p>' +
                '<button class="btn-primary small" id="loginToComment" type="button">ورود</button>' +
            '</div>';
    }
    
    let comments = post.comments || [];
    if (S.user) comments = comments.filter(c => !isBlocked(S.user.id, c.userId));
    comments = comments.filter(c => c.status !== 'pending' || (S.user && (c.userId === S.user.id || S.user.role === 'admin')));
    
    const commentsHtml = comments.length
        ? comments.map(c => renderComment(c, post.id, 0)).join('')
        : '<p style="text-align:right;color:var(--text-mute);padding:20px;font-size:13px;">هنوز نظری نیست. اولین نفر باش</p>';
    
    box.innerHTML = coverHtml +
        '<div class="post-page-header">' +
            '<span class="post-page-cat">' + metaCat + '</span>' +
            '<h1 class="post-page-title">' + esc(post.title) + '</h1>' +
            '<div class="post-page-meta">' +
                '<div class="author">' +
                    '<div class="user-avatar">' + (post.authorAvatar ? '<img src="' + escAttr(post.authorAvatar) + '" alt="">' : esc((post.authorName || 'N')[0])) + '</div>' +
                    '<strong>' + esc(post.authorName || 'ناشناس') + '</strong>' + (author ? badgesHtml(author) : '') +
                '</div>' +
                '<span>·</span><span>' + timeAgo(post.createdAt) + ' ' + editedHtml + '</span>' +
                '<span>·</span><span>' + faNum(post.views) + ' بازدید</span>' +
            '</div>' + actionsHtml +
        '</div>' +
        '<div class="post-page-body">' + post.content + '</div>' +
        '<div class="comments-section">' +
            '<div class="comments-head"><h3>نظرات <span>(' + faNum(comments.length) + ')</span></h3></div>' +
            commentFormHtml +
            '<div class="comment-list" id="commentList">' + commentsHtml + '</div>' +
        '</div>';
    
    initCommentEditor(post.id);
    
    const editBtn = $('#editPostBtn');
    if (editBtn) editBtn.addEventListener('click', () => openEditor(post.id));
    const delBtn = $('#deletePostBtn');
    if (delBtn) delBtn.addEventListener('click', () => {
        if (!confirm('پست حذف بشه؟')) return;
        DB.setPosts(DB.getPosts().filter(p => p.id !== post.id));
        toast('حذف شد');
        showPage('home');
    });
    
    const newEditor = $('#commentEditor');
    if (newEditor && prevDraft && wasPostPage) {
        newEditor.innerHTML = prevDraft;
        const cc = $('#charCount');
        if (cc) cc.textContent = faNum(newEditor.textContent.length);
        try {
            const r = document.createRange();
            r.selectNodeContents(newEditor); r.collapse(false);
            const sel = window.getSelection();
            sel.removeAllRanges(); sel.addRange(r);
        } catch (e) {}
    }
    if (prevScroll > 0) window.scrollTo(0, prevScroll);
    
    box.querySelectorAll('.edited-tag').forEach(tag => {
        tag.addEventListener('animationend', () => tag.classList.add('animated'), { once: true });
    });
    
    box.querySelectorAll('.post-page-body img').forEach(img => attachImageInteractions(img));
}

function renderComment(comment, postId, level) {
    const user = getUserById(comment.userId);
    const name = user ? user.displayName : (comment.userName || 'ناشناس');
    const avatar = user ? user.avatar : comment.userAvatar;
    const initial = name[0].toUpperCase();
    const likes = comment.likes || [];
    const dislikes = comment.dislikes || [];
    const userLiked = S.user && likes.indexOf(S.user.id) > -1;
    const userDisliked = S.user && dislikes.indexOf(S.user.id) > -1;
    
    let reactionsHtml = '';
    if (likes.length || dislikes.length) {
        const users = DB.getUsers();
        let avatars = '';
        likes.slice(0, 5).forEach(lid => {
            const lu = users.find(u => u.id === lid);
            if (lu) {
                const init = (lu.displayName || 'U')[0].toUpperCase();
                avatars += '<div class="reaction-avatar" title="' + escAttr(lu.displayName) + '">' +
                    (lu.avatar ? '<img src="' + escAttr(lu.avatar) + '" alt="">' : esc(init)) + '</div>';
            }
        });
        reactionsHtml = '<div class="reactions-list">' + avatars +
            (likes.length > 5 ? '<span class="reaction-count">+' + faNum(likes.length - 5) + '</span>' : '') +
            (likes.length ? '<span class="reaction-count">' + faNum(likes.length) + ' لایک</span>' : '') +
            '</div>';
    }
    
    const age = (Date.now() - comment.createdAt) / 1000;
    const editLimit = (user && user.tick === 'gold') ? Infinity : 120;
    const canEdit = S.user && S.user.id === comment.userId && age < editLimit;
    const canDelete = S.user && (S.user.id === comment.userId || S.user.role === 'admin');
    
    const pendingBadge = comment.status === 'pending' ? '<span class="comment-pending-badge">در انتظار تأیید</span>' : '';
    const editedTag = comment.edited ? '<span class="edited-tag">(ویرایش‌شده)</span>' : '';
    
    let repliesHtml = '';
    if (comment.replies && comment.replies.length && level < 5) {
        repliesHtml = '<div class="comment-replies">' +
            comment.replies.map(r => renderComment(r, postId, level + 1)).join('') + '</div>';
    }
    
    return '<div class="comment-item ' + (comment.status === 'pending' ? 'pending' : '') + '" data-comment-id="' + escAttr(comment.id) + '">' +
        '<div class="comment-item-header">' +
            '<div class="user-avatar">' + (avatar ? '<img src="' + escAttr(avatar) + '" alt="">' : esc(initial)) + '</div>' +
            '<div class="user-name">' +
                '<strong>' + esc(name) + (user ? badgesHtml(user) : '') + '</strong>' +
                '<small>@' + esc(user ? user.username : 'user') + '</small>' +
            '</div>' +
            '<span class="time">' + timeAgo(comment.createdAt) + ' ' + editedTag + '</span>' + pendingBadge +
        '</div>' +
        '<div class="comment-item-body">' + comment.content + '</div>' +
        '<div class="comment-item-footer">' +
            '<button class="comment-btn ' + (userLiked ? 'liked' : '') + '" data-like="' + escAttr(comment.id) + '" type="button">' + ICON.thumbUp + ' ' + faNum(likes.length) + '</button>' +
            '<button class="comment-btn ' + (userDisliked ? 'disliked' : '') + '" data-dislike="' + escAttr(comment.id) + '" type="button">' + ICON.thumbDown + ' ' + faNum(dislikes.length) + '</button>' +
            (level < 5 ? '<button class="comment-btn" data-reply="' + escAttr(comment.id) + '" type="button">پاسخ</button>' : '') +
            (canEdit ? '<button class="comment-btn" data-edit-comment="' + escAttr(comment.id) + '" type="button">ویرایش</button>' : '') +
            (canDelete ? '<button class="comment-btn" data-delete="' + escAttr(comment.id) + '" type="button">حذف</button>' : '') +
        '</div>' + reactionsHtml + repliesHtml +
    '</div>';
}

function findComment(list, id) {
    for (let i = 0; i < list.length; i++) {
        if (list[i].id === id) return list[i];
        if (list[i].replies && list[i].replies.length) {
            const f = findComment(list[i].replies, id);
            if (f) return f;
        }
    }
    return null;
}

function initCommentEditor(postId) {
    const editor = $('#commentEditor');
    if (!editor) {
        const lb = $('#loginToComment');
        if (lb) lb.addEventListener('click', () => openModal('authOverlay'));
        return;
    }
    attachZWSPCleanup(editor);
    
    $$('.comment-toolbar button[data-cmd]').forEach(btn => {
        btn.addEventListener('mousedown', e => e.preventDefault());
        btn.addEventListener('click', e => {
            e.preventDefault();
            const cmd = btn.dataset.cmd;
            if (cmd === 'bold') Ed.bold();
            else if (cmd === 'italic') Ed.italic();
            else if (cmd === 'underline') Ed.underline();
            editor.focus();
        });
    });
    
    const bS = $('#btnSpoiler');
    if (bS) { bS.addEventListener('mousedown', e => e.preventDefault()); bS.addEventListener('click', e => { e.preventDefault(); Ed.spoiler(); editor.focus(); }); }
    const bM = $('#btnMention');
    if (bM) {
        bM.addEventListener('mousedown', e => e.preventDefault());
        bM.addEventListener('click', e => {
            e.preventDefault();
            const users = DB.getUsers().slice(0, 10).map(u => u.username).join('، ');
            const u = prompt('نام کاربری:\n' + users);
            if (u) {
                const span = document.createElement('span');
                span.className = 'mention';
                span.setAttribute('data-username', u.toLowerCase());
                span.textContent = '@' + u + ' ';
                const sel = window.getSelection();
                if (sel && sel.rangeCount) sel.getRangeAt(0).insertNode(span);
            }
            editor.focus();
        });
    }
    const bCP = $('#btnColorPicker');
    if (bCP) {
        bCP.addEventListener('mousedown', e => e.preventDefault());
        bCP.addEventListener('click', e => {
            e.preventDefault();
            const cp = $('#colorPicker');
            if (cp) cp.hidden = !cp.hidden;
        });
    }
    const cc = $('#customColor');
    if (cc) { cc.addEventListener('mousedown', e => e.preventDefault()); cc.addEventListener('input', () => Ed.color(cc.value)); }
    $$('#colorPicker .color-dot').forEach(dot => {
        dot.addEventListener('mousedown', e => e.preventDefault());
        dot.addEventListener('click', e => {
            e.preventDefault();
            Ed.color(dot.dataset.color);
            const cp = $('#colorPicker');
            if (cp) cp.hidden = true;
            editor.focus();
        });
    });
    const bR = $('#btnRainbow');
    if (bR) { bR.addEventListener('mousedown', e => e.preventDefault()); bR.addEventListener('click', e => { e.preventDefault(); Ed.rainbow(); editor.focus(); }); }
    
    editor.addEventListener('input', () => {
        const charCount = $('#charCount');
        if (charCount) charCount.textContent = faNum(editor.textContent.length);
    });
    
    const submitBtn = $('#submitComment');
    if (submitBtn) submitBtn.addEventListener('click', () => {
        const content = editor.innerHTML.trim();
        if (!content || editor.textContent.trim().length < 2) { toast('نظرت خیلی کوتاهه'); return; }
        addComment(postId, content);
        editor.innerHTML = '';
        const charCount = $('#charCount');
        if (charCount) charCount.textContent = '۰';
        editor.focus();
    });
    
    const list = $('#commentList');
    if (list) {
        list.addEventListener('click', e => {
            const like = e.target.closest('[data-like]');
            const dislike = e.target.closest('[data-dislike]');
            const reply = e.target.closest('[data-reply]');
            const del = e.target.closest('[data-delete]');
            const editBtn = e.target.closest('[data-edit-comment]');
            if (like) toggleCommentReaction(postId, like.dataset.like, 'like');
            if (dislike) toggleCommentReaction(postId, dislike.dataset.dislike, 'dislike');
            if (reply) openReplyModal({ mode: 'reply', postId, commentId: reply.dataset.reply });
            if (editBtn) openReplyModal({ mode: 'edit-comment', postId, commentId: editBtn.dataset.editComment });
            if (del && confirm('حذف بشه؟')) deleteComment(postId, del.dataset.delete);
        });
    }
}

function addComment(postId, content) {
    if (!S.user) return;
    const posts = DB.getPosts();
    const post = posts.find(p => p.id === postId);
    if (!post) return;
    const u = S.user;
    const needsApproval = !u.tick && u.role !== 'admin' && u.role !== 'editor';
    const comment = {
        id: uid('c_'), userId: u.id, userName: u.displayName, userAvatar: u.avatar,
        content: parseMentions(content), createdAt: Date.now(),
        likes: [], dislikes: [], replies: [],
        status: needsApproval ? 'pending' : 'approved', edited: false
    };
    if (needsApproval) {
        const pending = DB.getPending();
        pending.push({ comment, postId, addedAt: Date.now() });
        DB.setPending(pending);
        toast('نظرت ثبت شد و در انتظار تأیید مدیره');
    } else {
        post.comments = post.comments || [];
        post.comments.push(comment);
        DB.setPosts(posts);
        addActivity('comment', u.displayName + ' روی پست «' + post.title + '» نظر داد', u.id);
        toast('نظرت ثبت شد');
    }
    renderPostPage(postId);
}

function toggleCommentReaction(postId, commentId, type) {
    if (!S.user) { toast('اول وارد شو'); return; }
    const posts = DB.getPosts();
    const post = posts.find(p => p.id === postId);
    if (!post) return;
    const comment = findComment(post.comments || [], commentId);
    if (!comment) return;
    comment.likes = comment.likes || [];
    comment.dislikes = comment.dislikes || [];
    if (type === 'like') {
        comment.dislikes = comment.dislikes.filter(id => id !== S.user.id);
        if (comment.likes.indexOf(S.user.id) > -1) comment.likes = comment.likes.filter(id => id !== S.user.id);
        else comment.likes.push(S.user.id);
    } else {
        comment.likes = comment.likes.filter(id => id !== S.user.id);
        if (comment.dislikes.indexOf(S.user.id) > -1) comment.dislikes = comment.dislikes.filter(id => id !== S.user.id);
        else comment.dislikes.push(S.user.id);
    }
    DB.setPosts(posts);
    const el = document.querySelector('[data-comment-id="' + commentId + '"]');
    if (el) {
        const tmp = document.createElement('div');
        tmp.innerHTML = renderComment(comment, postId, 0);
        el.replaceWith(tmp.firstElementChild);
    } else renderPostPage(postId);
}

function updateCommentContent(postId, commentId, newHtml) {
    const posts = DB.getPosts();
    const post = posts.find(p => p.id === postId);
    if (!post) return;
    const comment = findComment(post.comments || [], commentId);
    if (!comment) return;
    comment.content = newHtml;
    comment.edited = true;
    DB.setPosts(posts);
    renderPostPage(postId);
}

function addReplyToComment(postId, commentId, text) {
    const posts = DB.getPosts();
    const post = posts.find(p => p.id === postId);
    if (!post) return;
    const comment = findComment(post.comments || [], commentId);
    if (!comment) return;
    comment.replies = comment.replies || [];
    comment.replies.push({
        id: uid('c_'), userId: S.user.id, userName: S.user.displayName,
        userAvatar: S.user.avatar, content: parseMentions(text), createdAt: Date.now(),
        likes: [], dislikes: [], replies: [], status: 'approved', edited: false
    });
    DB.setPosts(posts);
    renderPostPage(postId);
}

function deleteComment(postId, commentId) {
    const posts = DB.getPosts();
    const post = posts.find(p => p.id === postId);
    if (!post) return;
    function removeFrom(list) {
        for (let i = 0; i < list.length; i++) {
            if (list[i].id === commentId) { list.splice(i, 1); return true; }
            if (list[i].replies && list[i].replies.length && removeFrom(list[i].replies)) return true;
        }
        return false;
    }
    if (removeFrom(post.comments || [])) {
        DB.setPosts(posts);
        renderPostPage(postId);
        toast('حذف شد');
    }
}

/* ══════════════════════════════════════════════════════════════
   ۱۴. Reply Modal
   ══════════════════════════════════════════════════════════════ */
function openReplyModal(ctx) {
    if (!S.user) { toast('اول وارد شو'); return; }
    S.replyContext = ctx;
    const modal = $('#replyModal');
    if (!modal) return;
    const titleEl = $('#replyModalTitle');
    const quotedEl = $('#replyModalQuoted');
    const editor = $('#replyModalEditor');
    
    if (ctx.mode === 'edit-comment') {
        if (titleEl) titleEl.textContent = 'ویرایش نظر';
        const post = DB.getPosts().find(p => p.id === ctx.postId);
        const c = findComment(post ? post.comments || [] : [], ctx.commentId);
        if (editor) editor.innerHTML = c ? c.content : '';
        if (quotedEl) quotedEl.hidden = true;
    } else if (ctx.mode === 'edit-message') {
        if (titleEl) titleEl.textContent = 'ویرایش پیام';
        const g = DB.getGroups().find(x => x.id === ctx.groupId);
        const m = g ? (g.messages || []).find(mm => mm.id === ctx.messageId) : null;
        if (editor) editor.innerHTML = m ? m.content : '';
        if (quotedEl) quotedEl.hidden = true;
    } else if (ctx.mode === 'edit-reply') {
        if (titleEl) titleEl.textContent = 'ویرایش پاسخ';
        const g = DB.getGroups().find(x => x.id === ctx.groupId);
        const r = g ? findReplyInGroup(g, ctx.replyId) : null;
        if (editor) editor.innerHTML = r ? r.content : '';
        if (quotedEl) quotedEl.hidden = true;
    } else if (ctx.mode === 'reply') {
        if (titleEl) titleEl.textContent = 'پاسخ';
        const post = DB.getPosts().find(p => p.id === ctx.postId);
        const c = findComment(post ? post.comments || [] : [], ctx.commentId);
        if (quotedEl && c) {
            const u = getUserById(c.userId);
            quotedEl.innerHTML = '<strong>' + esc(u ? u.displayName : (c.userName || 'کاربر')) + '</strong>' +
                esc(stripHtml(c.content).slice(0, 140));
            quotedEl.hidden = false;
        }
        if (editor) editor.innerHTML = '';
    } else if (ctx.mode === 'reply-message') {
        if (titleEl) titleEl.textContent = 'پاسخ';
        const g = DB.getGroups().find(x => x.id === ctx.groupId);
        const m = g ? (g.messages || []).find(mm => mm.id === ctx.messageId) : null;
        if (quotedEl && m) {
            const u = getUserById(m.userId);
            quotedEl.innerHTML = '<strong>' + esc(u ? u.displayName : (m.userName || 'کاربر')) + '</strong>' +
                esc(stripHtml(m.content || 'پیام تصویری').slice(0, 140));
            quotedEl.hidden = false;
        }
        if (editor) editor.innerHTML = '';
    } else if (ctx.mode === 'reply-reply') {
        if (titleEl) titleEl.textContent = 'پاسخ به پاسخ';
        const g = DB.getGroups().find(x => x.id === ctx.groupId);
        const r = g ? findReplyInGroup(g, ctx.replyId) : null;
        if (quotedEl && r) {
            const u = getUserById(r.userId);
            quotedEl.innerHTML = '<strong>' + esc(u ? u.displayName : (r.userName || 'کاربر')) + '</strong>' +
                esc(stripHtml(r.content).slice(0, 140));
            quotedEl.hidden = false;
        }
        if (editor) editor.innerHTML = '';
    } else if (ctx.mode === 'activity-comment') {
        if (titleEl) titleEl.textContent = 'نظر';
        if (quotedEl) quotedEl.hidden = true;
        if (editor) editor.innerHTML = '';
    } else if (ctx.mode === 'activity-reply') {
        if (titleEl) titleEl.textContent = 'پاسخ';
        if (quotedEl) quotedEl.hidden = true;
        if (editor) editor.innerHTML = '';
    }
    
    modal.hidden = false;
    requestAnimationFrame(() => {
        modal.classList.add('on');
        if (editor) {
            editor.focus();
            const r = document.createRange();
            r.selectNodeContents(editor); r.collapse(false);
            const sel = window.getSelection();
            sel.removeAllRanges(); sel.addRange(r);
        }
    });
    document.body.classList.add('locked');
}

function closeReplyModal() {
    const modal = $('#replyModal');
    if (!modal) return;
    modal.classList.remove('on');
    setTimeout(() => {
        modal.hidden = true;
        if (!document.querySelector('.modal-overlay.on') &&
            !document.querySelector('.side-modal:not([hidden])') &&
            !document.querySelector('.user-panel.on')) {
            document.body.classList.remove('locked');
        }
    }, 220);
    S.replyContext = null;
}

function submitReplyModal() {
    if (S._submitting) return;
    const editor = $('#replyModalEditor');
    if (!editor || !S.replyContext) return;
    const html = editor.innerHTML.trim();
    if (!html || editor.textContent.trim().length < 1) { toast('متن خالیه'); return; }
    S._submitting = true;
    setTimeout(() => { S._submitting = false; }, 400);
    const ctx = S.replyContext;
    if (ctx.mode === 'reply') addReplyToComment(ctx.postId, ctx.commentId, html);
    else if (ctx.mode === 'edit-comment') updateCommentContent(ctx.postId, ctx.commentId, parseMentions(html));
    else if (ctx.mode === 'reply-message') addReplyToMessage(ctx.groupId, ctx.messageId, html);
    else if (ctx.mode === 'edit-message') updateMessageContent(ctx.groupId, ctx.messageId, parseMentions(html));
    else if (ctx.mode === 'reply-reply') addReplyToReply(ctx.groupId, ctx.replyId, html);
    else if (ctx.mode === 'edit-reply') updateReplyContent(ctx.groupId, ctx.replyId, parseMentions(html));
    else if (ctx.mode === 'activity-comment') submitActivityComment(ctx.activityId, html);
    else if (ctx.mode === 'activity-reply') submitActivityReply(ctx.commentId, html);
    closeReplyModal();
    toast('ثبت شد');
}

function initReplyModal() {
    const modal = $('#replyModal');
    if (!modal || modal._bound) return;
    modal._bound = true;
    const editor = $('#replyModalEditor');
    if (!editor) return;
    attachZWSPCleanup(editor);
    
    $$('.reply-modal-toolbar button[data-reply-cmd]').forEach(btn => {
        btn.addEventListener('mousedown', e => e.preventDefault());
        btn.addEventListener('click', e => {
            e.preventDefault();
            const cmd = btn.dataset.replyCmd;
            if (cmd === 'bold') Ed.bold();
            else if (cmd === 'italic') Ed.italic();
            else if (cmd === 'underline') Ed.underline();
            editor.focus();
        });
    });
    const sp = $('#replySpoiler');
    if (sp) { sp.addEventListener('mousedown', e => e.preventDefault()); sp.addEventListener('click', e => { e.preventDefault(); Ed.spoiler(); editor.focus(); }); }
    const rb = $('#replyRainbow');
    if (rb) { rb.addEventListener('mousedown', e => e.preventDefault()); rb.addEventListener('click', e => { e.preventDefault(); Ed.rainbow(); editor.focus(); }); }
    const cb = $('#replyColorBtn');
    if (cb) {
        cb.addEventListener('mousedown', e => e.preventDefault());
        cb.addEventListener('click', e => {
            e.preventDefault();
            const p = $('#replyColorPicker');
            if (p) p.hidden = !p.hidden;
        });
    }
    const cc = $('#replyCustomColor');
    if (cc) { cc.addEventListener('mousedown', e => e.preventDefault()); cc.addEventListener('input', () => Ed.color(cc.value)); }
    $$('#replyColorPicker .color-dot').forEach(dot => {
        dot.addEventListener('mousedown', e => e.preventDefault());
        dot.addEventListener('click', e => {
            e.preventDefault();
            Ed.color(dot.dataset.color);
            const p = $('#replyColorPicker');
            if (p) p.hidden = true;
            editor.focus();
        });
    });
    const mb = $('#replyMention');
    if (mb) {
        mb.addEventListener('mousedown', e => e.preventDefault());
        mb.addEventListener('click', e => {
            e.preventDefault();
            const u = prompt('نام کاربری برای منشن:');
            if (u) {
                const span = document.createElement('span');
                span.className = 'mention';
                span.setAttribute('data-username', u.toLowerCase());
                span.textContent = '@' + u + ' ';
                const sel = window.getSelection();
                if (sel && sel.rangeCount) sel.getRangeAt(0).insertNode(span);
                editor.focus();
            }
        });
    }
    const send = $('#replyModalSend');
    if (send) send.addEventListener('click', submitReplyModal);
    const cancel = $('#replyModalCancel');
    if (cancel) cancel.addEventListener('click', closeReplyModal);
    modal.addEventListener('click', e => { if (e.target.closest('[data-close="replyModal"]')) closeReplyModal(); });
    editor.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submitReplyModal(); }
    });
}

function findInList(list, id) {
    for (let i = 0; i < list.length; i++) {
        if (list[i].id === id) return list[i];
        if (list[i].replies && list[i].replies.length) {
            const f = findInList(list[i].replies, id);
            if (f) return f;
        }
    }
    return null;
}
function findReplyInGroup(group, replyId) {
    for (const m of (group.messages || [])) {
        const r = findInList(m.replies || [], replyId);
        if (r) return r;
    }
    return null;
}

/* ══════════════════════════════════════════════════════════════
   ۱۵. Activity
   ══════════════════════════════════════════════════════════════ */
function addActivity(type, text, userId) {
    const a = DB.getActivity();
    a.push({ id: uid('a_'), type, text, ts: Date.now(), userId: userId || null });
    if (a.length > 200) a.splice(0, a.length - 200);
    DB.setActivity(a);
}

function renderActivityPage() {
    const list = $('#activityList');
    if (!list) return;
    const activities = DB.getActivity().slice().reverse();
    if (!activities.length) {
        list.innerHTML = '<div class="empty-state"><h3>هنوز فعالیتی نیست</h3></div>';
        return;
    }
    const icons = { post: 'پ', comment: 'ن', chat: 'چ', like: 'ل', friend: 'د', group: 'گ', report: 'گ' };
    const likes = DB.getActivityLikes();
    const comments = DB.getActivityComments();
    let html = '';
    activities.forEach(a => {
        const likeUsers = likes[a.id] || [];
        const userLiked = S.user && likeUsers.indexOf(S.user.id) > -1;
        const activityComments = comments.filter(c => c.activityId === a.id);
        const actor = a.userId ? getUserById(a.userId) : null;
        let userLine = '';
        if (actor) {
            const init = (actor.displayName || 'U')[0].toUpperCase();
            userLine = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">' +
                '<div class="user-avatar" style="width:28px;height:28px;font-size:11px;">' +
                    (actor.avatar ? '<img src="' + escAttr(actor.avatar) + '" alt="">' : esc(init)) + '</div>' +
                '<strong style="font-size:13px;color:var(--text);">' + esc(actor.displayName) + '</strong>' +
                badgesHtml(actor) + '</div>';
        }
        let commentsHtml = '';
        activityComments.forEach(c => {
            const cu = getUserById(c.userId);
            const cin = (cu ? cu.displayName : 'ناشناس')[0].toUpperCase();
            commentsHtml += '<div class="activity-comment" data-comment-id="' + escAttr(c.id) + '">' +
                '<div class="user-avatar">' + (cu && cu.avatar ? '<img src="' + escAttr(cu.avatar) + '" alt="">' : esc(cin)) + '</div>' +
                '<div class="activity-comment-body">' +
                    '<strong>' + esc(cu ? cu.displayName : 'ناشناس') + '</strong>' +
                    '<p>' + c.content + '</p>' +
                    '<div class="meta">' + timeAgo(c.ts) + ' · <button class="activity-reply-btn" data-reply-activity="' + escAttr(c.id) + '" type="button">پاسخ</button></div>' +
                    renderActivityReplies(c) +
                '</div></div>';
        });
        html += '<div class="activity-item" data-activity-id="' + escAttr(a.id) + '">' +
            userLine +
            '<div class="activity-head">' +
                '<div class="activity-icon">' + esc(icons[a.type] || '?') + '</div>' +
                '<div class="activity-body">' +
                    '<p>' + esc(a.text) + '</p>' +
                    '<small>' + timeAgo(a.ts) + '</small>' +
                '</div>' +
            '</div>' +
            '<div class="activity-actions">' +
                '<button class="activity-action-btn ' + (userLiked ? 'liked' : '') + '" data-act-like="' + escAttr(a.id) + '" type="button">' +
                    ICON.thumbUp + ' ' + faNum(likeUsers.length) + '</button>' +
                '<button class="activity-action-btn" data-act-comment="' + escAttr(a.id) + '" type="button">نظر ' + faNum(activityComments.length) + '</button>' +
            '</div>' +
            (activityComments.length ? '<div class="activity-comments">' + commentsHtml + '</div>' : '') +
        '</div>';
    });
    list.innerHTML = html;
}

function toggleActivityLike(activityId) {
    if (!S.user) { toast('اول وارد شو'); return; }
    const likes = DB.getActivityLikes();
    likes[activityId] = likes[activityId] || [];
    const idx = likes[activityId].indexOf(S.user.id);
    if (idx > -1) likes[activityId].splice(idx, 1);
    else likes[activityId].push(S.user.id);
    DB.setActivityLikes(likes);
    renderActivityPage();
}
function addActivityComment(activityId) { if (!S.user) { toast('اول وارد شو'); return; } openReplyModal({ mode: 'activity-comment', activityId }); }
function replyToActivityComment(commentId) { if (!S.user) { toast('اول وارد شو'); return; } openReplyModal({ mode: 'activity-reply', commentId }); }
function submitActivityComment(activityId, html) {
    const comments = DB.getActivityComments();
    comments.push({ id: uid('ac_'), activityId, userId: S.user.id, content: parseMentions(html), ts: Date.now(), replies: [] });
    DB.setActivityComments(comments);
    renderActivityPage();
}
function submitActivityReply(commentId, html) {
    const comments = DB.getActivityComments();
    const c = comments.find(x => x.id === commentId);
    if (!c) return;
    c.replies = c.replies || [];
    c.replies.push({ id: uid('acr_'), userId: S.user.id, content: parseMentions(html), ts: Date.now() });
    DB.setActivityComments(comments);
    renderActivityPage();
}
function renderActivityReplies(comment) {
    if (!comment.replies || !comment.replies.length) return '';
    let html = '<div class="activity-comment-replies">';
    comment.replies.forEach(r => {
        const ru = getUserById(r.userId);
        const rin = (ru ? ru.displayName : 'ناشناس')[0].toUpperCase();
        html += '<div class="activity-comment-reply">' +
            '<div class="user-avatar">' + (ru && ru.avatar ? '<img src="' + escAttr(ru.avatar) + '" alt="">' : esc(rin)) + '</div>' +
            '<div style="flex:1;min-width:0;">' +
                '<strong>' + esc(ru ? ru.displayName : 'ناشناس') + '</strong>' +
                '<p>' + r.content + '</p>' +
                '<div class="meta" style="font-size:10px;color:var(--text-mute);margin-top:2px;">' + timeAgo(r.ts) + '</div>' +
            '</div></div>';
    });
    html += '</div>';
    return html;
}

/* ══════════════════════════════════════════════════════════════
   ۱۶. Groups
   ══════════════════════════════════════════════════════════════ */
function renderGroupsPage() {
    const grid = $('#groupsGrid');
    if (!grid) return;
    let groups = DB.getGroups();
    if (S.groupFilter === 'public') groups = groups.filter(g => g.type === 'public');
    else if (S.groupFilter === 'private') groups = groups.filter(g => g.type === 'private');
    else if (S.groupFilter === 'mine') {
        if (!S.user) groups = [];
        else groups = groups.filter(g => (S.user.groups || []).indexOf(g.id) > -1);
    }
    if (!groups.length) {
        grid.innerHTML = '<div class="empty-state"><h3>گروهی نیست</h3></div>';
        return;
    }
    grid.innerHTML = '';
    groups.forEach(g => grid.appendChild(createGroupCard(g)));
}

function createGroupCard(group) {
    const card = document.createElement('div');
    card.className = 'group-card';
    const typeLabel = group.type === 'public' ? 'عمومی' : 'خصوصی';
    let coverStyle = '';
    if (group.cover) {
        const safe = /^(data:image\/|https:\/\/)/i.test(group.cover);
        if (safe) coverStyle = "background:url('" + escAttr(group.cover) + "') center/cover;";
    }
    const totalMsgs = (group.messages || []).length;
    card.innerHTML = '<div class="group-card-cover" style="' + coverStyle + '">' +
            '<span class="group-card-type ' + group.type + '">' + esc(typeLabel) + '</span>' +
        '</div>' +
        '<div class="group-card-body">' +
            '<div class="group-card-avatar">' +
                (group.avatar ? '<img src="' + escAttr(group.avatar) + '" alt="">' : esc((group.name || 'G')[0].toUpperCase())) +
            '</div>' +
            '<div class="group-card-info">' +
                '<h3>' + esc(group.name) + '</h3>' +
                '<p>' +
                    '<span>' + faNum((group.members || []).length) + ' عضو</span>' +
                    '<span>·</span>' +
                    '<span>' + faNum(totalMsgs) + ' پیام</span>' +
                '</p>' +
            '</div>' +
        '</div>';
    card.addEventListener('click', () => showPage('group', group.id));
    return card;
}

function renderGroupPage(groupId) {
    const box = $('#groupContent');
    if (!box) return;
    const group = DB.getGroups().find(g => g.id === groupId);
    if (!group) { box.innerHTML = '<div class="empty-state"><h3>گروه پیدا نشد</h3></div>'; return; }
    
    const u = S.user;
    const myId = u ? u.id : null;
    const isMember = myId && (group.members || []).indexOf(myId) > -1;
    const isOwner = myId && group.ownerId === myId;
    const isAdmin = myId && (group.admins || []).indexOf(myId) > -1;
    const isMod = myId && (group.mods || []).indexOf(myId) > -1;
    const isBanned = myId && (group.banned || []).indexOf(myId) > -1;
    const isSiteAdmin = u && u.role === 'admin';
    
    if (group.type === 'private' && !isMember && !isOwner && !isAdmin && !isMod && !isSiteAdmin) {
        if (isBanned) { box.innerHTML = '<div class="empty-state"><h3>از این گروه بن شدی</h3></div>'; return; }
        box.innerHTML = '<div class="empty-state">' +
                '<h3>گروه خصوصی</h3><p>برای ورود درخواست بده</p>' +
                '<button class="btn-primary" id="requestJoinBtn" type="button" style="margin-top:14px;">درخواست عضویت</button></div>';
        const rj = $('#requestJoinBtn');
        if (rj) rj.addEventListener('click', () => requestJoinGroup(groupId));
        return;
    }
    
    const users = DB.getUsers();
    const owner = users.find(x => x.id === group.ownerId);
    
    // هدر یکپارچه
    const allMessages = group.messages || [];
    let visibleMessages = allMessages;
    if (myId) visibleMessages = visibleMessages.filter(m => !isBlocked(myId, m.userId));
    
    // آخرین فعالیت
    const lastMsg = allMessages[allMessages.length - 1];
    const lastActivityText = lastMsg ? timeAgo(lastMsg.createdAt) : 'فعالیتی نداشته';
    
    // تیم مدیریت — در یک ردیف compact
    let teamHtml = '';
    if (owner) {
        teamHtml += '<div class="group-unified-team-role group-role-owner">' +
            '<span class="group-unified-team-role-label">' +
                '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5z"/></svg>' +
                'مدیر' +
            '</span>' +
            '<div class="group-unified-team-members">' +
                '<div class="team-pill" data-user-id="' + escAttr(owner.id) + '">' +
                    '<div class="user-avatar">' + (owner.avatar ? '<img src="' + escAttr(owner.avatar) + '" alt="">' : esc(owner.displayName[0])) + '</div>' +
                    '<span>' + esc(owner.displayName) + '</span>' +
                '</div>' +
            '</div></div>';
    }
    if ((group.admins || []).length) {
        let adminsHtml = '';
        (group.admins || []).forEach(aid => {
            const au = users.find(x => x.id === aid);
            if (!au) return;
            adminsHtml += '<div class="team-pill" data-user-id="' + escAttr(au.id) + '">' +
                '<div class="user-avatar">' + (au.avatar ? '<img src="' + escAttr(au.avatar) + '" alt="">' : esc(au.displayName[0])) + '</div>' +
                '<span>' + esc(au.displayName) + '</span></div>';
        });
        teamHtml += '<div class="group-unified-team-role group-role-admin">' +
            '<span class="group-unified-team-role-label">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2l3 6.5L22 9.5l-5 4.5L18.5 22 12 18l-6.5 4L7 14 2 9.5l7-1z"/></svg>' +
                'ادمین' +
            '</span>' +
            '<div class="group-unified-team-members">' + adminsHtml + '</div>' +
        '</div>';
    }
    if ((group.mods || []).length) {
        let modsHtml = '';
        (group.mods || []).forEach(mid => {
            const mu = users.find(x => x.id === mid);
            if (!mu) return;
            modsHtml += '<div class="team-pill" data-user-id="' + escAttr(mu.id) + '">' +
                '<div class="user-avatar">' + (mu.avatar ? '<img src="' + escAttr(mu.avatar) + '" alt="">' : esc(mu.displayName[0])) + '</div>' +
                '<span>' + esc(mu.displayName) + '</span></div>';
        });
        teamHtml += '<div class="group-unified-team-role group-role-mod">' +
            '<span class="group-unified-team-role-label">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>' +
                'ناظر' +
            '</span>' +
            '<div class="group-unified-team-members">' + modsHtml + '</div>' +
        '</div>';
    }
    
    const teamSection = teamHtml
        ? '<div class="group-unified-team">' +
            '<div class="group-unified-team-title">تیم مدیریت</div>' +
            '<div class="group-unified-team-row">' + teamHtml + '</div>' +
        '</div>'
        : '';
    
    // پیام‌ها
    const visible = visibleMessages.slice(-S.chatVisibleLimit);
    let messagesHtml = '';
    if (visibleMessages.length > S.chatVisibleLimit) {
        messagesHtml += '<button class="chat-load-more" id="loadMoreMsgs" type="button">نمایش پیام‌های قدیمی‌تر</button>';
    }
    messagesHtml += visible.map(m => renderChatMessage(m, group, 0)).join('');
    if (!visible.length) messagesHtml += '<p style="text-align:right;color:var(--text-mute);padding:30px;font-size:13px;">هنوز پیامی نیست</p>';
    
    // اکشن‌ها
    let actionsHtml = '';
    if (isOwner || isAdmin || isMod || isSiteAdmin) {
        actionsHtml += '<button class="btn-ghost small" id="groupSettingsBtn" type="button">تنظیمات</button>';
    }
    if (!isMember && group.type === 'public' && !isBanned) {
        actionsHtml += '<button class="btn-primary small" id="joinGroupBtn" type="button">عضویت</button>';
    }
    if ((isMember || isOwner || isAdmin || isMod) && !isOwner) {
        actionsHtml += '<button class="btn-ghost small danger" id="leaveGroupBtn" type="button">خروج</button>';
    }
    
    // فرم ارسال
    let inputHtml = '';
    if (isMember || isOwner || isAdmin || isMod) {
        inputHtml = '<div class="chat-input-wrap">' +
            '<div class="chat-editor" id="chatEditor" contenteditable="true" data-placeholder="پیامت رو بنویس"></div>' +
            '<div class="chat-toolbar">' +
                '<div class="chat-toolbar-left">' +
                    '<button type="button" data-chat-cmd="bold"><b>B</b></button>' +
                    '<button type="button" data-chat-cmd="italic"><i>I</i></button>' +
                    '<button type="button" id="chatSpoiler">اسپویلر</button>' +
                    '<button type="button" id="chatColor">رنگ</button>' +
                    '<button type="button" id="chatRainbow">رقص نور</button>' +
                    '<button type="button" id="chatImage">تصویر</button>' +
                '</div>' +
                '<div class="chat-toolbar-right">' +
                    '<button type="button" class="chat-send-btn" id="chatSend">ارسال</button>' +
                '</div>' +
            '</div>' +
            '<div class="color-picker" id="chatColorPicker" hidden style="margin-top:8px;">' +
                '<input type="color" id="chatCustomColor">' +
                '<div class="color-dot" style="background:#B85050" data-color="#B85050"></div>' +
                '<div class="color-dot" style="background:#B8873A" data-color="#B8873A"></div>' +
                '<div class="color-dot" style="background:#4F8B6B" data-color="#4F8B6B"></div>' +
                '<div class="color-dot" style="background:#5B6FA8" data-color="#5B6FA8"></div>' +
                '<div class="color-dot" style="background:#8B7EB8" data-color="#8B7EB8"></div>' +
            '</div>' +
        '</div>';
    } else {
        inputHtml = '<div class="chat-input-wrap" style="text-align:center;padding:16px;">' +
            '<p style="font-size:12px;color:var(--text-mute);">' +
                (isBanned ? 'تو بن شدی، نمی‌تونی پیام بفرستی' : 'برای ارسال پیام، عضو گروه شو') +
            '</p></div>';
    }
    
    const groupCoverStyle = group.cover ? '' : 'background:var(--surface-3);';
    const groupAvatarHtml = group.avatar
        ? '<img src="' + escAttr(group.avatar) + '" alt="">'
        : esc((group.name || 'G')[0].toUpperCase());
    
    // ساختار HTML گروه — هدر یکپارچه
    box.innerHTML =
        '<div class="group-unified-header">' +
            '<div class="group-unified-cover" style="' + groupCoverStyle + '">' +
                (group.cover ? '<img src="' + escAttr(group.cover) + '" alt="" loading="lazy">' : '') +
            '</div>' +
            '<div class="group-unified-main">' +
                '<div class="group-unified-avatar">' + groupAvatarHtml + '</div>' +
                '<div class="group-unified-info">' +
                    '<h1 class="group-unified-name">' + esc(group.name) + '</h1>' +
                    '<div class="group-unified-meta">' +
                        '<span>' + esc(group.type === 'public' ? 'گروه عمومی' : 'گروه خصوصی') + '</span>' +
                        '<span>·</span>' +
                        '<span>آخرین فعالیت: ' + esc(lastActivityText) + '</span>' +
                        '<span>·</span>' +
                        '<span>' + faNum((group.members || []).length) + ' عضو</span>' +
                        '<span>·</span>' +
                        '<span>' + faNum(allMessages.length) + ' پیام</span>' +
                    '</div>' +
                '</div>' +
                '<div class="group-unified-actions">' + actionsHtml + '</div>' +
            '</div>' +
            (group.description ? '<div class="group-unified-description">' +
                '<div class="group-unified-description-label">توضیحات گروه</div>' +
                '<div class="group-unified-description-text">' + esc(group.description) + '</div>' +
            '</div>' : '') +
            (isOwner ? '<div class="group-unified-tags">' +
                '<span class="group-unified-tag">مالک</span>' +
            '</div>' : '') +
            teamSection +
        '</div>' +
        '<div class="chat-box">' +
            '<div class="chat-messages" id="chatMessages">' + messagesHtml + '</div>' +
            inputHtml +
        '</div>';
    
    initChat(groupId, group);
    
    const gsb = $('#groupSettingsBtn');
    if (gsb) gsb.addEventListener('click', () => openGroupSettings(groupId));
    const jb = $('#joinGroupBtn');
    if (jb) jb.addEventListener('click', () => joinGroup(groupId));
    const lb = $('#leaveGroupBtn');
    if (lb) lb.addEventListener('click', () => leaveGroup(groupId));
    
    box.querySelectorAll('.team-pill[data-user-id]').forEach(el => {
        el.addEventListener('click', () => showPage('profile', el.dataset.userId));
    });
    
    setTimeout(() => {
        const cm = $('#chatMessages');
        if (cm) cm.scrollTop = cm.scrollHeight;
    }, 60);
    
    // شروع Seed Engine اگه این گروه seedی هست
    if (groupId === 'g_seed_free') {
        SeedEngine.startGroup(groupId);
    }
}

function renderChatMessage(msg, group, level) {
    const user = getUserById(msg.userId);
    const name = user ? user.displayName : (msg.userName || 'ناشناس');
    const avatar = user ? user.avatar : msg.userAvatar;
    const initial = name[0].toUpperCase();
    const isSeed = SEED_SET.has(msg.userId);
    
    let roleBadge = '';
    if (group.ownerId === msg.userId) roleBadge = '<span class="role-badge owner">مدیر</span>';
    else if ((group.admins || []).indexOf(msg.userId) > -1) roleBadge = '<span class="role-badge admin">ادمین</span>';
    else if ((group.mods || []).indexOf(msg.userId) > -1) roleBadge = '<span class="role-badge mod">ناظر</span>';
    else if (isSeed) roleBadge = '<span class="role-badge seed">ساکن</span>';
    
    const userLiked = S.user && (msg.likes || []).indexOf(S.user.id) > -1;
    const userDisliked = S.user && (msg.dislikes || []).indexOf(S.user.id) > -1;
    const imageHtml = msg.image ? '<img src="' + escAttr(msg.image) + '" class="chat-msg-image" loading="lazy" alt="" data-lightbox="1">' : '';
    const age = (Date.now() - msg.createdAt) / 1000;
    const canEdit = S.user && S.user.id === msg.userId && age < 600;
    const canDelete = S.user && (
        S.user.id === msg.userId || group.ownerId === S.user.id ||
        (group.admins || []).indexOf(S.user.id) > -1 ||
        (group.mods || []).indexOf(S.user.id) > -1
    );
    
    let repliesHtml = '';
    if (msg.replies && msg.replies.length && level < 5) {
        repliesHtml = '<div class="chat-replies">' +
            msg.replies.map(r => renderChatReply(r, group, level + 1, msg.id)).join('') + '</div>';
    }
    const editedTag = msg.edited ? '<span class="edited-tag">(ویرایش‌شده)</span>' : '';
    
    // برای seedها دکمه‌های ویرایش/حذف نشون نمی‌دیم
    const hideActions = isSeed;
    
    return '<div class="chat-msg" data-msg-id="' + escAttr(msg.id) + '">' +
        '<div class="user-avatar" data-user-id="' + escAttr(msg.userId) + '">' +
            (avatar ? '<img src="' + escAttr(avatar) + '" alt="">' : esc(initial)) +
        '</div>' +
        '<div class="chat-msg-content">' +
            '<div class="chat-msg-head">' +
                '<strong data-user-id="' + escAttr(msg.userId) + '">' + esc(name) + '</strong>' +
                (user ? badgesHtml(user) : '') + roleBadge +
                '<span class="time">' + timeAgo(msg.createdAt) + ' ' + editedTag + '</span>' +
            '</div>' +
            '<div class="chat-msg-body">' + (msg.content || '') + '</div>' + imageHtml +
            (!hideActions ? '<div class="chat-msg-actions">' +
                '<button class="chat-msg-btn ' + (userLiked ? 'liked' : '') + '" data-msg-like="' + escAttr(msg.id) + '" type="button">' + ICON.thumbUp + ' ' + faNum((msg.likes || []).length) + '</button>' +
                '<button class="chat-msg-btn ' + (userDisliked ? 'disliked' : '') + '" data-msg-dislike="' + escAttr(msg.id) + '" type="button">' + ICON.thumbDown + ' ' + faNum((msg.dislikes || []).length) + '</button>' +
                '<button class="chat-msg-btn" data-msg-reply="' + escAttr(msg.id) + '" type="button">پاسخ</button>' +
                (canEdit ? '<button class="chat-msg-btn" data-msg-edit="' + escAttr(msg.id) + '" type="button">ویرایش</button>' : '') +
                (canDelete ? '<button class="chat-msg-btn" data-msg-del="' + escAttr(msg.id) + '" type="button">حذف</button>' : '') +
            '</div>' : '<div class="chat-msg-actions">' +
                '<button class="chat-msg-btn ' + (userLiked ? 'liked' : '') + '" data-msg-like="' + escAttr(msg.id) + '" type="button">' + ICON.thumbUp + ' ' + faNum((msg.likes || []).length) + '</button>' +
                '<button class="chat-msg-btn ' + (userDisliked ? 'disliked' : '') + '" data-msg-dislike="' + escAttr(msg.id) + '" type="button">' + ICON.thumbDown + ' ' + faNum((msg.dislikes || []).length) + '</button>' +
                '<button class="chat-msg-btn" data-msg-reply="' + escAttr(msg.id) + '" type="button">پاسخ</button>' +
            '</div>') +
            repliesHtml +
        '</div>' +
    '</div>';
}

function renderChatReply(reply, group, level, parentMsgId) {
    const user = getUserById(reply.userId);
    const name = user ? user.displayName : (reply.userName || 'ناشناس');
    const avatar = user ? user.avatar : reply.userAvatar;
    const initial = name[0].toUpperCase();
    const userLiked = S.user && (reply.likes || []).indexOf(S.user.id) > -1;
    const userDisliked = S.user && (reply.dislikes || []).indexOf(S.user.id) > -1;
    const age = (Date.now() - reply.createdAt) / 1000;
    const canEdit = S.user && S.user.id === reply.userId && age < 600;
    const canDelete = S.user && (
        S.user.id === reply.userId || group.ownerId === S.user.id ||
        (group.admins || []).indexOf(S.user.id) > -1 ||
        (group.mods || []).indexOf(S.user.id) > -1
    );
    let nestedHtml = '';
    if (reply.replies && reply.replies.length && level < 5) {
        nestedHtml = '<div class="chat-replies">' +
            reply.replies.map(r => renderChatReply(r, group, level + 1, reply.id)).join('') + '</div>';
    }
    const editedTag = reply.edited ? '<span class="edited-tag">(ویرایش‌شده)</span>' : '';
    
    return '<div class="chat-reply" data-reply-id="' + escAttr(reply.id) + '" data-parent-id="' + escAttr(parentMsgId) + '">' +
        '<div class="chat-reply-header">' +
            '<div class="user-avatar" data-user-id="' + escAttr(reply.userId) + '">' +
                (avatar ? '<img src="' + escAttr(avatar) + '" alt="">' : esc(initial)) + '</div>' +
            '<strong data-user-id="' + escAttr(reply.userId) + '">' + esc(name) + '</strong>' +
            (user ? badgesHtml(user) : '') +
            '<span class="time">' + timeAgo(reply.createdAt) + ' ' + editedTag + '</span>' +
        '</div>' +
        '<div class="chat-reply-body">' + (reply.content || '') + '</div>' +
        '<div class="chat-reply-actions">' +
            '<button class="chat-reply-btn ' + (userLiked ? 'liked' : '') + '" data-reply-like="' + escAttr(reply.id) + '" data-parent="' + escAttr(parentMsgId) + '" type="button">' + ICON.thumbUp + ' ' + faNum((reply.likes || []).length) + '</button>' +
            '<button class="chat-reply-btn ' + (userDisliked ? 'disliked' : '') + '" data-reply-dislike="' + escAttr(reply.id) + '" data-parent="' + escAttr(parentMsgId) + '" type="button">' + ICON.thumbDown + '</button>' +
            (level < 5 ? '<button class="chat-reply-btn" data-reply-reply="' + escAttr(reply.id) + '" type="button">پاسخ</button>' : '') +
            (canEdit ? '<button class="chat-reply-btn" data-reply-edit="' + escAttr(reply.id) + '" type="button">ویرایش</button>' : '') +
            (canDelete ? '<button class="chat-reply-btn" data-reply-del="' + escAttr(reply.id) + '" data-parent="' + escAttr(parentMsgId) + '" type="button">حذف</button>' : '') +
        '</div>' + nestedHtml +
    '</div>';
}

function initChat(groupId, group) {
    const editor = $('#chatEditor');
    if (editor && !editor._bound) {
        editor._bound = true;
        attachZWSPCleanup(editor);
        $$('.chat-toolbar button[data-chat-cmd]').forEach(btn => {
            btn.addEventListener('mousedown', e => e.preventDefault());
            btn.addEventListener('click', e => {
                e.preventDefault();
                const cmd = btn.dataset.chatCmd;
                if (cmd === 'bold') Ed.bold();
                else if (cmd === 'italic') Ed.italic();
                editor.focus();
            });
        });
        const cs = $('#chatSpoiler');
        if (cs) { cs.addEventListener('mousedown', e => e.preventDefault()); cs.addEventListener('click', e => { e.preventDefault(); Ed.spoiler(); editor.focus(); }); }
        const cc = $('#chatColor');
        if (cc) {
            cc.addEventListener('mousedown', e => e.preventDefault());
            cc.addEventListener('click', e => {
                e.preventDefault();
                const p = $('#chatColorPicker');
                if (p) p.hidden = !p.hidden;
            });
        }
        const customC = $('#chatCustomColor');
        if (customC) { customC.addEventListener('mousedown', e => e.preventDefault()); customC.addEventListener('input', () => Ed.color(customC.value)); }
        $$('#chatColorPicker .color-dot').forEach(d => {
            d.addEventListener('mousedown', e => e.preventDefault());
            d.addEventListener('click', e => {
                e.preventDefault();
                Ed.color(d.dataset.color);
                const p = $('#chatColorPicker');
                if (p) p.hidden = true;
                editor.focus();
            });
        });
        const rb = $('#chatRainbow');
        if (rb) { rb.addEventListener('mousedown', e => e.preventDefault()); rb.addEventListener('click', e => { e.preventDefault(); Ed.rainbow(); editor.focus(); }); }
        const ci = $('#chatImage');
        if (ci) ci.addEventListener('click', () => {
            const inp = document.createElement('input');
            inp.type = 'file'; inp.accept = 'image/*';
            inp.onchange = async () => {
                try {
                    const b64 = await fileToBase64(inp.files[0]);
                    sendChatMessage(groupId, null, b64);
                } catch (err) { toast(err); }
            };
            inp.click();
        });
        const csend = $('#chatSend');
        if (csend) csend.addEventListener('click', () => {
            const content = editor.innerHTML.trim();
            if (!content || editor.textContent.trim().length < 1) return;
            sendChatMessage(groupId, content);
            editor.innerHTML = '';
        });
        editor.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const b = $('#chatSend');
                if (b) b.click();
            }
        });
    }
    
    const chatBox = $('#chatMessages');
    if (chatBox && !chatBox._bound) {
        chatBox._bound = true;
        chatBox.addEventListener('click', e => {
            const userTrigger = e.target.closest('[data-user-id]');
            if (userTrigger && !e.target.closest('button') && !e.target.closest('[data-lightbox]')) {
                const uidAttr = userTrigger.dataset.userId;
                if (uidAttr) { showPage('profile', uidAttr); return; }
            }
            const lbImg = e.target.closest('[data-lightbox]');
            if (lbImg) { openLightbox(lbImg.src); return; }
            const like = e.target.closest('[data-msg-like]');
            const dislike = e.target.closest('[data-msg-dislike]');
            const reply = e.target.closest('[data-msg-reply]');
            const editMsg = e.target.closest('[data-msg-edit]');
            const del = e.target.closest('[data-msg-del]');
            const rLike = e.target.closest('[data-reply-like]');
            const rDislike = e.target.closest('[data-reply-dislike]');
            const rReply = e.target.closest('[data-reply-reply]');
            const rEdit = e.target.closest('[data-reply-edit]');
            const rDel = e.target.closest('[data-reply-del]');
            if (like) toggleMsgReaction(groupId, like.dataset.msgLike, 'like');
            if (dislike) toggleMsgReaction(groupId, dislike.dataset.msgDislike, 'dislike');
            if (reply) openReplyModal({ mode: 'reply-message', groupId, messageId: reply.dataset.msgReply });
            if (editMsg) openReplyModal({ mode: 'edit-message', groupId, messageId: editMsg.dataset.msgEdit });
            if (del && confirm('حذف بشه؟')) deleteMessage(groupId, del.dataset.msgDel);
            if (rLike) toggleReplyReaction(groupId, rLike.dataset.parent, rLike.dataset.replyLike, 'like');
            if (rDislike) toggleReplyReaction(groupId, rDislike.dataset.parent, rDislike.dataset.replyDislike, 'dislike');
            if (rReply) openReplyModal({ mode: 'reply-reply', groupId, replyId: rReply.dataset.replyReply });
            if (rEdit) openReplyModal({ mode: 'edit-reply', groupId, replyId: rEdit.dataset.replyEdit });
            if (rDel && confirm('حذف بشه؟')) deleteReply(groupId, rDel.dataset.replyDel);
        });
    }
    
    const lm = $('#loadMoreMsgs');
    if (lm) lm.addEventListener('click', () => {
        S.chatVisibleLimit += 60;
        renderGroupPage(groupId);
    });
}

function sendChatMessage(groupId, content, image) {
    if (!S.user) return;
    const groups = DB.getGroups();
    const g = groups.find(x => x.id === groupId);
    if (!g) { toast('گروه پیدا نشد'); return; }
    g.messages = g.messages || [];
    const msg = {
        id: uid('m_'), userId: S.user.id, userName: S.user.displayName,
        userAvatar: S.user.avatar, content: content ? parseMentions(content) : '',
        image: image || null, createdAt: Date.now(), likes: [], dislikes: [], replies: [], edited: false
    };
    g.messages.push(msg);
    DB.setGroups(groups);
    addActivity('chat', S.user.displayName + ' توی گروه «' + g.name + '» پیام داد', S.user.id);
    renderGroupPage(groupId);
    
    // Seed Engine — واکنش به کاربر
    if (groupId === 'g_seed_free') {
        SeedEngine.onUserMessage(stripHtml(content) || '[image]', S.user.id);
    }
}

function toggleMsgReaction(groupId, msgId, type) {
    if (!S.user) return;
    const groups = DB.getGroups();
    const g = groups.find(x => x.id === groupId);
    if (!g) return;
    const msg = (g.messages || []).find(m => m.id === msgId);
    if (!msg) return;
    msg.likes = msg.likes || [];
    msg.dislikes = msg.dislikes || [];
    if (type === 'like') {
        msg.dislikes = msg.dislikes.filter(id => id !== S.user.id);
        if (msg.likes.indexOf(S.user.id) > -1) msg.likes = msg.likes.filter(id => id !== S.user.id);
        else msg.likes.push(S.user.id);
    } else {
        msg.likes = msg.likes.filter(id => id !== S.user.id);
        if (msg.dislikes.indexOf(S.user.id) > -1) msg.dislikes = msg.dislikes.filter(id => id !== S.user.id);
        else msg.dislikes.push(S.user.id);
    }
    DB.setGroups(groups);
    const el = document.querySelector('[data-msg-id="' + msgId + '"]');
    if (el) {
        SeedEngine.updateMessageDOM(el, msg);
    }
}

function toggleReplyReaction(groupId, parentId, replyId, type) {
    if (!S.user) return;
    const groups = DB.getGroups();
    const g = groups.find(x => x.id === groupId);
    if (!g) return;
    const msg = (g.messages || []).find(m => m.id === parentId);
    if (!msg) return;
    const r = findInList(msg.replies || [], replyId);
    if (!r) return;
    r.likes = r.likes || []; r.dislikes = r.dislikes || [];
    if (type === 'like') {
        r.dislikes = r.dislikes.filter(id => id !== S.user.id);
        if (r.likes.indexOf(S.user.id) > -1) r.likes = r.likes.filter(id => id !== S.user.id);
        else r.likes.push(S.user.id);
    } else {
        r.likes = r.likes.filter(id => id !== S.user.id);
        if (r.dislikes.indexOf(S.user.id) > -1) r.dislikes = r.dislikes.filter(id => id !== S.user.id);
        else r.dislikes.push(S.user.id);
    }
    DB.setGroups(groups);
    renderGroupPage(groupId);
}

function addReplyToMessage(groupId, msgId, html) {
    const groups = DB.getGroups();
    const g = groups.find(x => x.id === groupId);
    if (!g) return;
    const msg = (g.messages || []).find(m => m.id === msgId);
    if (!msg) return;
    msg.replies = msg.replies || [];
    msg.replies.push({
        id: uid('r_'), userId: S.user.id, userName: S.user.displayName,
        userAvatar: S.user.avatar, content: parseMentions(html),
        createdAt: Date.now(), likes: [], dislikes: [], replies: [], edited: false
    });
    DB.setGroups(groups);
    renderGroupPage(groupId);
}

function addReplyToReply(groupId, replyId, html) {
    if (!S.user) return;
    const groups = DB.getGroups();
    const g = groups.find(x => x.id === groupId);
    if (!g) return;
    const r = findReplyInGroup(g, replyId);
    if (!r) return;
    r.replies = r.replies || [];
    r.replies.push({
        id: uid('r_'), userId: S.user.id, userName: S.user.displayName,
        userAvatar: S.user.avatar, content: parseMentions(html),
        createdAt: Date.now(), likes: [], dislikes: [], replies: [], edited: false
    });
    DB.setGroups(groups);
    renderGroupPage(groupId);
}

function updateMessageContent(groupId, msgId, html) {
    const groups = DB.getGroups();
    const g = groups.find(x => x.id === groupId);
    if (!g) return;
    const msg = (g.messages || []).find(m => m.id === msgId);
    if (!msg) return;
    msg.content = html; msg.edited = true;
    DB.setGroups(groups);
    renderGroupPage(groupId);
}

function updateReplyContent(groupId, replyId, html) {
    const groups = DB.getGroups();
    const g = groups.find(x => x.id === groupId);
    if (!g) return;
    const r = findReplyInGroup(g, replyId);
    if (!r) return;
    r.content = html; r.edited = true;
    DB.setGroups(groups);
    renderGroupPage(groupId);
}

function deleteMessage(groupId, msgId) {
    const groups = DB.getGroups();
    const g = groups.find(x => x.id === groupId);
    if (!g) return;
    g.messages = (g.messages || []).filter(m => m.id !== msgId);
    DB.setGroups(groups);
    renderGroupPage(groupId);
    toast('حذف شد');
}

function deleteReply(groupId, replyId) {
    const groups = DB.getGroups();
    const g = groups.find(x => x.id === groupId);
    if (!g) return;
    function removeR(list) {
        for (let i = 0; i < list.length; i++) {
            if (list[i].id === replyId) { list.splice(i, 1); return true; }
            if (list[i].replies && list[i].replies.length && removeR(list[i].replies)) return true;
        }
        return false;
    }
    let removed = false;
    for (const m of (g.messages || [])) {
        if (removeR(m.replies || [])) { removed = true; break; }
    }
    if (removed) { DB.setGroups(groups); renderGroupPage(groupId); toast('حذف شد'); }
}

function joinGroup(groupId) {
    if (!S.user) { toast('اول وارد شو'); return; }
    const groups = DB.getGroups();
    const g = groups.find(x => x.id === groupId);
    if (!g) return;
    if ((g.banned || []).indexOf(S.user.id) > -1) { toast('تو بن شدی'); return; }
    g.members = g.members || [];
    if (g.members.indexOf(S.user.id) === -1) g.members.push(S.user.id);
    const users = DB.getUsers();
    const me = users.find(u => u.id === S.user.id);
    if (me) {
        me.groups = me.groups || [];
        if (me.groups.indexOf(groupId) === -1) me.groups.push(groupId);
        DB.setUsers(users);
        S.user = me;
    }
    DB.setGroups(groups);
    toast('عضو شدی');
    renderGroupPage(groupId);
    // اگه seed group بود، درخواست دوستی از طرف seed
    if (groupId === 'g_seed_free') {
        setTimeout(() => SeedEngine.trySendFriendRequest(), 15000);
    }
}

function leaveGroup(groupId) {
    if (!S.user) return;
    const groups = DB.getGroups();
    const g = groups.find(x => x.id === groupId);
    if (!g) return;
    const isOwner = g.ownerId === S.user.id;
    if (isOwner) {
        const nextOwner = (g.admins && g.admins[0]) || (g.mods && g.mods[0]) || (g.members || []).find(m => m !== S.user.id);
        if (nextOwner) {
            if (!confirm('مالکیت گروه به «' + (getUserById(nextOwner)?.displayName || 'کاربر بعدی') + '» منتقل بشه و خارج شی؟')) return;
            g.ownerId = nextOwner;
            g.admins = (g.admins || []).filter(id => id !== nextOwner);
        } else {
            if (!confirm('تو تنها عضو گروه هستی. با خروج، گروه حذف می‌شه. مطمئنی؟')) return;
            DB.setGroups(DB.getGroups().filter(x => x.id !== groupId));
            const users = DB.getUsers();
            const me = users.find(u => u.id === S.user.id);
            if (me) { me.groups = (me.groups || []).filter(id => id !== groupId); DB.setUsers(users); S.user = me; }
            toast('گروه حذف شد');
            showPage('groups');
            return;
        }
    } else {
        if (!confirm('از گروه خارج بشی؟')) return;
    }
    g.members = (g.members || []).filter(id => id !== S.user.id);
    g.admins = (g.admins || []).filter(id => id !== S.user.id);
    g.mods = (g.mods || []).filter(id => id !== S.user.id);
    const users = DB.getUsers();
    const me = users.find(u => u.id === S.user.id);
    if (me) { me.groups = (me.groups || []).filter(id => id !== groupId); DB.setUsers(users); S.user = me; }
    DB.setGroups(groups);
    toast('خارج شدی');
    showPage('groups');
}

function requestJoinGroup(groupId) {
    if (!S.user) return;
    const groups = DB.getGroups();
    const g = groups.find(x => x.id === groupId);
    if (!g) return;
    g.joinRequests = g.joinRequests || [];
    if (g.joinRequests.indexOf(S.user.id) === -1) g.joinRequests.push(S.user.id);
    DB.setGroups(groups);
    const notifs = DB.getNotifs();
    notifs.push({
        id: uid('n_'), userId: g.ownerId, type: 'group_request',
        text: S.user.displayName + ' درخواست عضویت در گروه «' + g.name + '» داد',
        link: 'group:' + g.id, ts: Date.now(), read: false
    });
    DB.setNotifs(notifs);
    toast('درخواست فرستاده شد');
}

function openGroupSettings(groupId) {
    if (!S.user) return;
    const groups = DB.getGroups();
    const g = groups.find(x => x.id === groupId);
    if (!g) return;
    const isOwner = g.ownerId === S.user.id;
    const isAdmin = (g.admins || []).indexOf(S.user.id) > -1;
    const isMod = (g.mods || []).indexOf(S.user.id) > -1;
    const isSiteAdmin = S.user.role === 'admin';
    if (!isOwner && !isAdmin && !isMod && !isSiteAdmin) { toast('دسترسی نداری'); return; }
    
    const box = $('#groupSettingsBody');
    if (!box) return;
    const users = DB.getUsers();
    const membersHtml = (g.members || []).map(mid => {
        const u = users.find(x => x.id === mid);
        if (!u) return '';
        const isOwnerM = g.ownerId === mid;
        const isAdminM = (g.admins || []).indexOf(mid) > -1;
        const isModM = (g.mods || []).indexOf(mid) > -1;
        let roleLabel = '';
        if (isOwnerM) roleLabel = '<span class="role-badge owner">مدیر</span>';
        else if (isAdminM) roleLabel = '<span class="role-badge admin">ادمین</span>';
        else if (isModM) roleLabel = '<span class="role-badge mod">ناظر</span>';
        let btns = '';
        if (!isOwnerM && (isOwner || isAdmin || isSiteAdmin)) {
            if (isOwner || isSiteAdmin) btns += '<button class="btn-ghost small" data-promote-admin="' + escAttr(mid) + '" type="button">ادمین</button>';
            btns += '<button class="btn-ghost small" data-promote-mod="' + escAttr(mid) + '" type="button">ناظر</button>';
            btns += '<button class="btn-ghost small danger" data-ban-member="' + escAttr(mid) + '" type="button">بن</button>';
        }
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);gap:10px;flex-wrap:wrap;">' +
            '<div style="display:flex;align-items:center;gap:10px;min-width:0;">' +
                '<div class="user-avatar" style="width:32px;height:32px;font-size:12px;">' +
                    (u.avatar ? '<img src="' + escAttr(u.avatar) + '" alt="">' : esc(u.displayName[0])) + '</div>' +
                '<div style="min-width:0;">' +
                    '<strong style="font-size:13px;">' + esc(u.displayName) + '</strong> ' + roleLabel +
                    '<div style="font-size:11px;color:var(--text-mute);direction:ltr;">@' + esc(u.username) + '</div>' +
                '</div></div>' +
            '<div style="display:flex;gap:4px;flex-wrap:wrap;">' + btns + '</div></div>';
    }).join('');
    
    let requestsHtml = '';
    if ((g.joinRequests || []).length) {
        requestsHtml = '<h4 style="font-size:14px;font-weight:800;margin:16px 0 10px;">درخواست‌های عضویت</h4>' +
            g.joinRequests.map(mid => {
                const u = users.find(x => x.id === mid);
                if (!u) return '';
                return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;">' +
                    '<strong>' + esc(u.displayName) + '</strong>' +
                    '<div style="display:flex;gap:4px;">' +
                        '<button class="btn-primary small" data-accept-join="' + escAttr(mid) + '" type="button">قبول</button>' +
                        '<button class="btn-ghost small" data-reject-join="' + escAttr(mid) + '" type="button">رد</button>' +
                    '</div></div>';
            }).join('');
    }
    
    let siteAdminControls = '';
    if (isSiteAdmin) {
        siteAdminControls = '<div style="padding:14px;border-radius:14px;background:var(--danger-tint);margin-bottom:14px;">' +
            '<h4 style="font-size:13px;font-weight:800;margin-bottom:10px;color:var(--danger);">کنترل مدیر سایت</h4>' +
            '<button class="btn-ghost small danger full" id="deleteGroupBtn" type="button">حذف کامل گروه</button></div>';
    }
    
    box.innerHTML = siteAdminControls +
        '<div style="text-align:center;margin-bottom:16px;">' +
            '<div class="group-card-avatar" style="margin:0 auto 10px;">' +
                (g.avatar ? '<img src="' + escAttr(g.avatar) + '" alt="">' : esc((g.name[0] || 'G').toUpperCase())) + '</div>' +
            '<button class="btn-ghost small" id="changeGroupAvatar" type="button">تغییر آواتار</button>' +
            '<input type="file" id="groupAvatarFile" accept="image/*" hidden>' +
        '</div>' +
        '<div class="form-group" style="margin-bottom:14px;">' +
            '<label>اسم گروه</label>' +
            '<input type="text" id="gName" value="' + escAttr(g.name) + '"></div>' +
        '<div class="form-group" style="margin-bottom:14px;">' +
            '<label>توضیحات</label>' +
            '<textarea id="gDesc">' + esc(g.description || '') + '</textarea></div>' +
        '<button class="btn-primary full" id="gSave" type="button" style="margin-bottom:20px;">ذخیره تغییرات</button>' +
        '<h4 style="font-size:14px;font-weight:800;margin-bottom:10px;">اعضا (' + faNum((g.members || []).length) + ')</h4>' +
        '<div style="max-height:300px;overflow-y:auto;">' + membersHtml + '</div>' + requestsHtml;
    
    openModal('groupSettingsOverlay');
    
    const changeAv = $('#changeGroupAvatar');
    const fileInp = $('#groupAvatarFile');
    if (changeAv && fileInp) {
        changeAv.addEventListener('click', () => fileInp.click());
        fileInp.addEventListener('change', async e => {
            try {
                const b64 = await fileToBase64(e.target.files[0]);
                const gs = DB.getGroups();
                const gg = gs.find(x => x.id === groupId);
                if (gg) { gg.avatar = b64; DB.setGroups(gs); }
                closeModal('groupSettingsOverlay');
                renderGroupPage(groupId);
                toast('آواتار تغییر کرد');
            } catch (err) { toast(err); }
        });
    }
    
    const saveBtn = $('#gSave');
    if (saveBtn) saveBtn.addEventListener('click', () => {
        const newName = $('#gName').value.trim();
        if (!newName) return;
        const gs = DB.getGroups();
        const gg = gs.find(x => x.id === groupId);
        if (!gg) return;
        const oldName = gg.name;
        gg.name = newName;
        gg.description = $('#gDesc').value.trim();
        if (oldName !== newName) {
            gg.messages = gg.messages || [];
            gg.messages.push({
                id: uid('m_'), userId: 'system', userName: 'سیستم',
                content: 'اسم گروه از «' + esc(oldName) + '» به «' + esc(newName) + '» تغییر کرد',
                createdAt: Date.now(), likes: [], dislikes: [], replies: []
            });
        }
        DB.setGroups(gs);
        toast('ذخیره شد');
        closeModal('groupSettingsOverlay');
        renderGroupPage(groupId);
    });
    
    const delGroup = $('#deleteGroupBtn');
    if (delGroup) delGroup.addEventListener('click', () => {
        if (!confirm('گروه به طور کامل حذف بشه؟')) return;
        DB.setGroups(DB.getGroups().filter(x => x.id !== groupId));
        toast('گروه حذف شد');
        closeModal('groupSettingsOverlay');
        showPage('groups');
    });
    
    if (box._h) box.removeEventListener('click', box._h);
    box._h = e => {
        const pa = e.target.closest('[data-promote-admin]');
        const pm = e.target.closest('[data-promote-mod]');
        const ban = e.target.closest('[data-ban-member]');
        const acc = e.target.closest('[data-accept-join]');
        const rej = e.target.closest('[data-reject-join]');
        if (pa) {
            const gs = DB.getGroups(); const gg = gs.find(x => x.id === groupId);
            if (!gg) return;
            gg.admins = gg.admins || [];
            if (gg.admins.indexOf(pa.dataset.promoteAdmin) === -1) gg.admins.push(pa.dataset.promoteAdmin);
            DB.setGroups(gs); toast('ادمین شد');
            closeModal('groupSettingsOverlay'); setTimeout(() => openGroupSettings(groupId), 250);
        }
        if (pm) {
            const gs = DB.getGroups(); const gg = gs.find(x => x.id === groupId);
            if (!gg) return;
            gg.mods = gg.mods || [];
            if (gg.mods.indexOf(pm.dataset.promoteMod) === -1) gg.mods.push(pm.dataset.promoteMod);
            DB.setGroups(gs); toast('ناظر شد');
            closeModal('groupSettingsOverlay'); setTimeout(() => openGroupSettings(groupId), 250);
        }
        if (ban) {
            if (!confirm('بن بشه؟')) return;
            const gs = DB.getGroups(); const gg = gs.find(x => x.id === groupId);
            if (!gg) return;
            gg.banned = gg.banned || [];
            if (gg.banned.indexOf(ban.dataset.banMember) === -1) gg.banned.push(ban.dataset.banMember);
            gg.members = (gg.members || []).filter(id => id !== ban.dataset.banMember);
            gg.admins = (gg.admins || []).filter(id => id !== ban.dataset.banMember);
            gg.mods = (gg.mods || []).filter(id => id !== ban.dataset.banMember);
            const bannedU = getUserById(ban.dataset.banMember);
            gg.messages = gg.messages || [];
            gg.messages.push({
                id: uid('m_'), userId: 'system', userName: 'سیستم',
                content: '«' + esc(bannedU ? bannedU.displayName : 'کاربر') + '» توسط «' + esc(S.user.displayName) + '» بن شد',
                createdAt: Date.now(), likes: [], dislikes: [], replies: []
            });
            DB.setGroups(gs); toast('بن شد');
            closeModal('groupSettingsOverlay'); setTimeout(() => openGroupSettings(groupId), 250);
        }
        if (acc) {
            const gs = DB.getGroups(); const gg = gs.find(x => x.id === groupId);
            if (!gg) return;
            gg.joinRequests = (gg.joinRequests || []).filter(id => id !== acc.dataset.acceptJoin);
            gg.members = gg.members || [];
            if (gg.members.indexOf(acc.dataset.acceptJoin) === -1) gg.members.push(acc.dataset.acceptJoin);
            DB.setGroups(gs); toast('قبول شد');
            closeModal('groupSettingsOverlay'); setTimeout(() => openGroupSettings(groupId), 250);
        }
        if (rej) {
            const gs = DB.getGroups(); const gg = gs.find(x => x.id === groupId);
            if (!gg) return;
            gg.joinRequests = (gg.joinRequests || []).filter(id => id !== rej.dataset.rejectJoin);
            DB.setGroups(gs);
            closeModal('groupSettingsOverlay'); setTimeout(() => openGroupSettings(groupId), 250);
        }
    };
    box.addEventListener('click', box._h);
}

/* ══════════════════════════════════════════════════════════════
   ۱۷. PM
   ══════════════════════════════════════════════════════════════ */
function renderPMPage() {
    const layout = $('#pmLayout');
    if (!layout) return;
    const tabs = $$('#pmTabs .pm-tab');
    if (!layout._tabsBound) {
        layout._tabsBound = true;
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                S.pmTab = tab.dataset.pmTab;
                tabs.forEach(t => t.classList.toggle('active', t === tab));
                renderPMChatList();
                if (S.pmTab === 'groups') {
                    S.pmActiveUser = null;
                    const view = $('#pmView');
                    if (view) view.innerHTML = '<div class="pm-empty"><div class="pm-empty-inner"><p>پیام‌های گروهی به‌زودی...</p></div></div>';
                    layout.classList.remove('viewing');
                }
            });
        });
    }
    if (!S.user) {
        const sidebar = $('.pm-sidebar');
        const view = $('#pmView');
        if (sidebar) sidebar.innerHTML = '<div class="pm-empty"><div class="pm-empty-inner"><p>برای دیدن پیام‌ها وارد شو</p></div></div>';
        if (view) view.innerHTML = '<div class="pm-empty"><div class="pm-empty-inner"><p>ابتدا وارد شو</p></div></div>';
        return;
    }
    renderPMChatList();
    if (S.pmActiveUser) renderPMConversation(S.pmActiveUser);
}

function renderPMChatList() {
    const list = $('#pmChatList');
    if (!list) return;
    if (S.pmTab === 'groups') {
        list.innerHTML = '<div class="pm-empty-state">پیام‌های گروهی<br><span style="font-size:11px;opacity:.7;">به‌زودی</span></div>';
        return;
    }
    const users = DB.getUsers();
    const myId = S.user.id;
    const allMessages = DB.getPM();
    const conversations = new Map();
    if (S.pmTab === 'received') {
        allMessages.forEach(m => {
            if (m.to === myId && m.from !== myId && m.from !== 'system' && !m.deleted) {
                if (!conversations.has(m.from)) conversations.set(m.from, { userId: m.from, messages: [] });
                conversations.get(m.from).messages.push(m);
            }
        });
    } else if (S.pmTab === 'sent') {
        allMessages.forEach(m => {
            if (m.from === myId && m.to !== myId && m.to !== 'system' && !m.deleted) {
                if (!conversations.has(m.to)) conversations.set(m.to, { userId: m.to, messages: [] });
                conversations.get(m.to).messages.push(m);
            }
        });
    }
    const arr = Array.from(conversations.values()).map(c => {
        const last = c.messages.length ? c.messages[c.messages.length - 1] : null;
        const unread = c.messages.filter(m => m.to === myId && !m.read).length;
        return { ...c, last, unread, other: users.find(u => u.id === c.userId) };
    }).sort((a, b) => {
        const ta = a.last ? a.last.ts : 0, tb = b.last ? b.last.ts : 0;
        if (a.unread && !b.unread) return -1;
        if (!a.unread && b.unread) return 1;
        return tb - ta;
    });
    if (!arr.length) {
        list.innerHTML = '<div class="pm-empty-state">' + (S.pmTab === 'received' ? 'هیچ پیام دریافتی‌ای نداری' : 'هنوز به کسی پیام ندادی') + '</div>';
        return;
    }
    list.innerHTML = arr.map(c => {
        if (!c.other) return '';
        const u = c.other;
        const init = (u.displayName || 'U')[0].toUpperCase();
        let preview = 'گفت‌وگو رو شروع کن';
        if (c.last) {
            if (c.last.file && !c.last.text) {
                const typeMap = { image: '[عکس]', video: '[ویدیو]', audio: '[صدا]', file: '[فایل]' };
                preview = (c.last.from === myId ? 'شما: ' : '') + (typeMap[c.last.file.type] || '[فایل]');
            } else preview = (c.last.from === myId ? 'شما: ' : '') + stripHtml(c.last.text || '').slice(0, 35);
        }
        const isActive = S.pmActiveUser === u.id;
        return '<div class="pm-chat-item ' + (isActive ? 'active' : '') + '" data-pm-user="' + escAttr(u.id) + '">' +
            '<div class="user-avatar">' + (u.avatar ? '<img src="' + escAttr(u.avatar) + '" alt="">' : esc(init)) + '</div>' +
            '<div class="pm-chat-item-info">' +
                '<strong>' + esc(u.displayName) + badgesHtml(u) + '</strong>' +
                '<p>' + esc(preview) + '</p>' +
            '</div>' +
            '<div class="pm-chat-item-meta">' +
                (c.last ? '<span class="time">' + timeAgo(c.last.ts) + '</span>' : '') +
                (c.unread ? '<span class="unread">' + faNum(c.unread) + '</span>' : '') +
            '</div></div>';
    }).join('');
    list.querySelectorAll('[data-pm-user]').forEach(el => {
        el.addEventListener('click', () => {
            S.pmActiveUser = el.dataset.pmUser;
            const layout = $('#pmLayout');
            if (layout) layout.classList.add('viewing');
            const pms = DB.getPM();
            pms.forEach(m => { if (m.from === S.pmActiveUser && m.to === S.user.id) m.read = true; });
            DB.setPM(pms);
            updateBadges();
            renderPMChatList();
            renderPMConversation(S.pmActiveUser);
        });
    });
}

function renderPMConversation(userId) {
    const view = $('#pmView');
    if (!view) return;
    if (!userId) return;
    const user = getUserById(userId);
    if (!user) { view.innerHTML = ''; return; }
    const myId = S.user.id;
    const msgs = DB.getPM().filter(m =>
        ((m.from === myId && m.to === userId) || (m.from === userId && m.to === myId))
    ).filter(m => !m.deleted);
    const init = (user.displayName || 'U')[0].toUpperCase();
    let messagesHtml = '';
    let lastDate = null;
    const dayMs = 86400000;
    msgs.forEach(m => {
        const d = new Date(m.ts);
        const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        if (lastDate !== dayStart) {
            lastDate = dayStart;
            const today = new Date();
            const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
            const yesterdayStart = todayStart - dayMs;
            let dateLabel = '';
            if (dayStart === todayStart) dateLabel = 'امروز';
            else if (dayStart === yesterdayStart) dateLabel = 'دیروز';
            else { try { dateLabel = new Date(dayStart).toLocaleDateString('fa-IR'); } catch (e) {} }
            messagesHtml += '<div class="pm-msg-date-sep">' + dateLabel + '</div>';
        }
        messagesHtml += renderPMBubble(m, myId, user);
    });
    if (!msgs.length) {
        messagesHtml = '<div class="pm-empty" style="flex:1;"><div class="pm-empty-inner">' +
            '<p>هنوز پیامی رد و بدل نشده</p>' +
            '<p style="font-size:12px;margin-top:8px;opacity:.7;">اولین پیام رو بفرست</p></div></div>';
    }
    view.innerHTML =
        '<div class="pm-view-header">' +
            '<button class="pm-back-btn" id="pmBackBtn" type="button" aria-label="بازگشت">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>' +
            '</button>' +
            '<div class="user-avatar" style="cursor:pointer;" data-user-id="' + escAttr(user.id) + '">' +
                (user.avatar ? '<img src="' + escAttr(user.avatar) + '" alt="">' : esc(init)) + '</div>' +
            '<div class="pm-view-header-info">' +
                '<strong>' + esc(user.displayName) + badgesHtml(user) + '</strong>' +
                '<small>@' + esc(user.username) + '</small>' +
            '</div>' +
            '<div class="pm-view-header-actions">' +
                '<button class="icon-btn" data-user-id="' + escAttr(user.id) + '" aria-label="پروفایل">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>' +
                '</button></div>' +
        '</div>' +
        '<div class="pm-messages" id="pmMessages">' + messagesHtml + '</div>' +
        '<div class="pm-input-area" style="position:relative;">' +
            '<div class="pm-input-row">' +
                '<button class="pm-input-btn" id="pmAttachBtn" type="button" aria-label="ضمیمه">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>' +
                '</button>' +
                '<div class="pm-input" id="pmInput" contenteditable="true" data-placeholder="پیام..."></div>' +
                '<div class="pm-input-actions">' +
                    '<button class="pm-input-btn send" id="pmSendBtn" type="button" aria-label="ارسال">' +
                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>' +
                    '</button></div>' +
            '</div></div>';
    
    loadPMFileAttachments();
    
    const backBtn = $('#pmBackBtn');
    if (backBtn) backBtn.addEventListener('click', () => {
        const l = $('#pmLayout');
        if (l) l.classList.remove('viewing');
        S.pmActiveUser = null;
        renderPMChatList();
        renderPMConversation(null);
    });
    view.querySelectorAll('[data-user-id]').forEach(el => {
        el.addEventListener('click', e => {
            if (e.target.closest('button')) return;
            showPage('profile', el.dataset.userId);
        });
    });
    
    const input = $('#pmInput');
    const sendBtn = $('#pmSendBtn');
    if (sendBtn) sendBtn.addEventListener('click', () => {
        const html = input ? input.innerHTML.trim() : '';
        if (!html || !input.textContent.trim()) return;
        sendPM(user.id, html);
        input.innerHTML = '';
    });
    if (input && !input._bound) {
        input._bound = true;
        attachZWSPCleanup(input);
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn.click(); }
        });
    }
    const attachBtn = $('#pmAttachBtn');
    if (attachBtn && !attachBtn._bound) {
        attachBtn._bound = true;
        attachBtn.addEventListener('click', e => {
            e.stopPropagation();
            openPMAttachPopover(attachBtn, user.id);
        });
    }
    bindPMBubbleActions(view);
}

function bindPMBubbleActions(view) {
    if (!view || view._bubbleBound) return;
    view._bubbleBound = true;
    view.addEventListener('click', e => {
        const delBtn = e.target.closest('[data-pm-del]');
        if (delBtn) {
            e.stopPropagation();
            if (!confirm('این پیام حذف بشه؟')) return;
            const pms = DB.getPM();
            const p = pms.find(m => m.id === delBtn.dataset.pmDel);
            if (p) { p.deleted = true; DB.setPM(pms); }
            if (S.pmActiveUser) renderPMConversation(S.pmActiveUser);
            return;
        }
        const copyBtn = e.target.closest('[data-pm-copy]');
        if (copyBtn) {
            e.stopPropagation();
            const pms = DB.getPM();
            const p = pms.find(m => m.id === copyBtn.dataset.pmCopy);
            if (p && p.text) {
                const txt = stripHtml(p.text);
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(txt).then(() => toast('کپی شد'), () => toast('کپی نشد'));
                } else toast('کپی نشد');
            }
            return;
        }
        const imgEl = e.target.closest('.pm-msg-image[data-lightbox]');
        if (imgEl) openLightbox(imgEl.src);
    });
}

function openPMAttachPopover(anchorBtn, userId) {
    const existing = $('.pm-attach-popover');
    if (existing) existing.remove();
    const pop = document.createElement('div');
    pop.className = 'pm-attach-popover';
    pop.innerHTML =
        '<button type="button" data-attach="image">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>عکس</button>' +
        '<button type="button" data-attach="video">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m23 7-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>ویدیو</button>' +
        '<button type="button" data-attach="audio">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>صدا</button>' +
        '<button type="button" data-attach="file">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>فایل</button>';
    const inputArea = anchorBtn.closest('.pm-input-area');
    if (inputArea) inputArea.appendChild(pop);
    pop.addEventListener('click', e => {
        const btn = e.target.closest('[data-attach]');
        if (!btn) return;
        const kind = btn.dataset.attach;
        pop.remove();
        triggerPMFileInput(kind, userId);
    });
    setTimeout(() => {
        const outsideHandler = ev => {
            if (!pop.contains(ev.target) && ev.target !== anchorBtn) {
                pop.remove();
                document.removeEventListener('click', outsideHandler);
            }
        };
        document.addEventListener('click', outsideHandler);
    }, 100);
}

function triggerPMFileInput(kind, userId) {
    const inp = document.createElement('input');
    inp.type = 'file';
    if (kind === 'image') inp.accept = 'image/*';
    else if (kind === 'video') inp.accept = 'video/*';
    else if (kind === 'audio') inp.accept = 'audio/*';
    else inp.accept = '*/*';
    inp.onchange = async () => {
        const file = inp.files[0];
        if (!file) return;
        if (file.size > 15 * 1024 * 1024) { toast('حجم فایل بیش از ۱۵ مگابایت است'); return; }
        const fileId = uid('f_');
        try {
            await FileStore.put(fileId, file, { name: file.name, type: file.type, size: file.size, kind });
            sendPMFile(userId, fileId, kind, file.name, file.type, file.size);
        } catch (err) { toast('خطا در ذخیره فایل'); }
    };
    inp.click();
}

function sendPM(toId, html) {
    if (!S.user) return;
    if (toId === S.user.id) return;
    const pms = DB.getPM();
    pms.push({
        id: uid('pm_'), from: S.user.id, to: toId,
        text: parseMentions(html), file: null, ts: Date.now(),
        read: false, edited: false, deleted: false
    });
    DB.setPM(pms);
    const notifs = DB.getNotifs();
    notifs.push({
        id: uid('n_'), userId: toId, type: 'message',
        text: S.user.displayName + ' بهت پیام داد', ts: Date.now(), read: false
    });
    DB.setNotifs(notifs);
    renderPMChatList();
    renderPMConversation(toId);
    
    // Seed Engine — واکنش به PM
    if (SEED_SET.has(toId)) {
        SeedEngine.onUserPM(toId, stripHtml(html));
    }
}

function sendPMFile(toId, fileId, kind, name, type, size) {
    if (!S.user) return;
    const pms = DB.getPM();
    pms.push({
        id: uid('pm_'), from: S.user.id, to: toId,
        text: '', file: { id: fileId, type: kind, name, mime: type, size },
        ts: Date.now(), read: false, edited: false, deleted: false
    });
    DB.setPM(pms);
    renderPMChatList();
    renderPMConversation(toId);
    
    // Seed واکنش
    if (SEED_SET.has(toId)) {
        SeedEngine.onUserPM(toId, '[' + kind + ']');
    }
}

function renderPMBubble(msg, myId, otherUser) {
    const isMine = msg.from === myId;
    const time = new Date(msg.ts);
    const hh = String(time.getHours()).padStart(2, '0');
    const mm = String(time.getMinutes()).padStart(2, '0');
    const timeStr = faNum(hh + ':' + mm);
    const editedTag = msg.edited ? ' <span style="opacity:.6;">(ویرایش)</span>' : '';
    const delBtn = isMine ? '<button data-pm-del="' + escAttr(msg.id) + '" title="حذف"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>' : '';
    const copyBtn = '<button data-pm-copy="' + escAttr(msg.id) + '" title="کپی"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>';
    const ticks = isMine ? '<span class="pm-msg-tick" title="خوانده شد"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 13l4 4L14 8"/><path d="M9 13l4 4L22 8"/></svg></span>' : '';
    let bodyContent = '';
    if (msg.file) {
        bodyContent = '<div class="pm-msg-attachment" data-file-id="' + escAttr(msg.file.id) + '" data-file-kind="' + escAttr(msg.file.type) + '">' +
            '<div style="opacity:.7;font-size:12px;">در حال بارگذاری…</div></div>';
    }
    if (msg.text) bodyContent += '<div class="pm-msg-body">' + msg.text + '</div>';
    
    return '<div class="pm-msg ' + (isMine ? 'own' : 'other') + '" data-msg-id="' + escAttr(msg.id) + '">' +
        '<div class="pm-msg-actions">' + copyBtn + delBtn + '</div>' +
        bodyContent +
        '<div class="pm-msg-footer">' + ticks + '<span class="time">' + timeStr + '</span>' + editedTag + '</div></div>';
}

async function loadPMFileAttachments() {
    const containers = $$('.pm-msg-attachment[data-file-id]');
    for (const c of containers) {
        const fileId = c.dataset.fileId;
        if (c._loaded) continue;
        c._loaded = true;
        const rec = await FileStore.get(fileId);
        if (!rec || !rec.blob) { c.innerHTML = '<div style="opacity:.5;font-size:12px;">فایل حذف شده</div>'; continue; }
        const url = await getFileURL(fileId);
        if (!url) { c.innerHTML = '<div style="opacity:.5;">فایل قابل نمایش نیست</div>'; continue; }
        const kind = rec.meta.kind;
        const sizeKB = Math.round((rec.meta.size || 0) / 1024);
        const sizeStr = sizeKB > 1024 ? (sizeKB / 1024).toFixed(1) + ' MB' : sizeKB + ' KB';
        if (kind === 'image') c.innerHTML = '<img src="' + escAttr(url) + '" class="pm-msg-image" data-lightbox="1" alt="' + escAttr(rec.meta.name || '') + '">';
        else if (kind === 'video') c.innerHTML = '<video src="' + escAttr(url) + '" class="pm-msg-video" controls preload="metadata"></video>';
        else if (kind === 'audio') c.innerHTML = '<audio src="' + escAttr(url) + '" class="pm-msg-audio" controls preload="metadata"></audio>';
        else c.innerHTML = '<a href="' + escAttr(url) + '" download="' + escAttr(rec.meta.name || 'file') + '" class="pm-msg-file">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>' +
            '<div class="pm-msg-file-info"><strong>' + esc(rec.meta.name || 'file') + '</strong><small>' + esc(sizeStr) + '</small></div></a>';
    }
}

/* ══════════════════════════════════════════════════════════════
   ۱۸. Users / Profile
   ══════════════════════════════════════════════════════════════ */
function renderUsersPage() {
    const grid = $('#usersGrid');
    if (!grid) return;
    const users = DB.getUsers();
    grid.innerHTML = '';
    users.forEach(u => {
        if (S.user && hasBlockedMe(S.user.id, u.id)) return;
        const card = document.createElement('div');
        card.className = 'user-card';
        const coverHtml = u.cover
            ? '<div class="user-card-cover"><img src="' + escAttr(u.cover) + '" alt="" loading="lazy"></div>'
            : '<div class="user-card-cover"></div>';
        card.innerHTML = coverHtml +
            '<div class="user-avatar">' + (u.avatar ? '<img src="' + escAttr(u.avatar) + '" alt="">' : esc(u.displayName[0].toUpperCase())) + '</div>' +
            '<h3>' + esc(u.displayName) + badgesHtml(u) + '</h3>' +
            '<p>@' + esc(u.username) + '</p>';
        card.addEventListener('click', () => showPage('profile', u.id));
        grid.appendChild(card);
    });
}

function renderProfilePage(userId) {
    const box = $('#userProfileContent');
    if (!box) return;
    const u = getUserById(userId);
    if (!u) { box.innerHTML = '<div class="empty-state"><h3>کاربر پیدا نشد</h3></div>'; return; }
    if (S.user && S.user.id !== userId && hasBlockedMe(S.user.id, userId)) {
        box.innerHTML = '<div class="profile-blocked-message"><h3>کاربر بلاکت کرده</h3><p>نمی‌تونی پروفایلش رو ببینی</p></div>';
        return;
    }
    const isMe = S.user && S.user.id === userId;
    const isFriend = S.user && (S.user.friends || []).indexOf(userId) > -1;
    const hasPending = S.user && (S.user.friendRequests || []).indexOf(userId) > -1;
    const iBlocked = S.user && isBlocked(S.user.id, userId);
    const coverHtml = u.cover ? '<div class="profile-cover"><img src="' + escAttr(u.cover) + '" alt="" loading="lazy"></div>' : '<div class="profile-cover"></div>';
    let actionsHtml = '';
    if (!isMe && S.user) {
        let friendBtn = '';
        if (isFriend) friendBtn = '<button class="btn-ghost small" data-action="unfriend" type="button">لغو دوستی</button>';
        else if (hasPending) friendBtn = '<button class="btn-ghost small" disabled type="button">درخواست ارسال شد</button>';
        else friendBtn = '<button class="btn-primary small" data-action="add-friend" type="button">درخواست دوستی</button>';
        const blockBtn = iBlocked
            ? '<button class="btn-ghost small" data-action="unblock" type="button">رفع بلاک</button>'
            : '<button class="btn-ghost small danger" data-action="block" type="button">بلاک کردن</button>';
        actionsHtml = '<div class="profile-actions">' + friendBtn +
            '<button class="btn-ghost small" data-action="private-msg" type="button">پیام خصوصی</button>' + blockBtn + '</div>';
    } else if (isMe) {
        actionsHtml = '<div class="profile-actions"><button class="btn-primary small" id="editMyProfileBtn" type="button">ویرایش پروفایل</button></div>';
    }
    const posts = DB.getPosts().filter(p => p.authorId === userId);
    const commentsCount = DB.getPosts().reduce((sum, p) =>
        sum + (p.comments || []).filter(c => c.userId === userId).length, 0);
    const platformLabel = { ps5: 'PlayStation 5', xbox: 'Xbox', switch: 'Nintendo Switch', pc: 'PC', mobile: 'موبایل' }[u.platform] || 'PC';
    
    box.innerHTML = coverHtml +
        '<div class="profile-header">' +
            '<div class="profile-avatar">' + (u.avatar ? '<img src="' + escAttr(u.avatar) + '" alt="">' : esc(u.displayName[0].toUpperCase())) + '</div>' +
            '<div class="profile-info">' +
                '<h1>' + esc(u.displayName) + badgesHtml(u) + '</h1>' +
                '<div class="username">@' + esc(u.username) + '</div>' +
                (u.title ? '<div class="title">' + esc(u.title) + '</div>' : '') +
            '</div>' + actionsHtml +
        '</div>' +
        '<div class="profile-stats">' +
            '<div class="profile-stat"><strong>' + faNum(u.xp || 0) + '</strong><span>امتیاز</span></div>' +
            '<div class="profile-stat"><strong>' + faNum(posts.length) + '</strong><span>پست</span></div>' +
            '<div class="profile-stat"><strong>' + faNum(commentsCount) + '</strong><span>نظر</span></div>' +
            '<div class="profile-stat"><strong>' + faNum((u.friends || []).length) + '</strong><span>دوست</span></div>' +
        '</div>' +
        (u.bio ? '<div class="profile-bio"><h3>درباره من</h3><p>' + esc(u.bio) + '</p></div>' : '') +
        '<div class="profile-bio"><h3>اطلاعات</h3>' +
            '<div class="profile-details-grid">' +
                '<div class="profile-detail-item"><div class="label">پلتفرم</div><div class="value">' + esc(platformLabel) + '</div></div>' +
                (u.birthday ? '<div class="profile-detail-item"><div class="label">تاریخ تولد</div><div class="value">' + esc(u.birthday) + '</div></div>' : '') +
                (u.website ? '<div class="profile-detail-item"><div class="label">وبسایت</div><div class="value" style="direction:ltr;">' + esc(u.website) + '</div></div>' : '') +
                (u.favGames ? '<div class="profile-detail-item"><div class="label">بازی‌های مورد علاقه</div><div class="value">' + esc(u.favGames) + '</div></div>' : '') +
                (u.favMovies ? '<div class="profile-detail-item"><div class="label">فیلم‌های مورد علاقه</div><div class="value">' + esc(u.favMovies) + '</div></div>' : '') +
                (u.instagram ? '<div class="profile-detail-item"><div class="label">اینستاگرام</div><div class="value" style="direction:ltr;">' + esc(u.instagram) + '</div></div>' : '') +
                (u.telegram ? '<div class="profile-detail-item"><div class="label">تلگرام</div><div class="value" style="direction:ltr;">' + esc(u.telegram) + '</div></div>' : '') +
                (u.discord ? '<div class="profile-detail-item"><div class="label">دیسکورد</div><div class="value" style="direction:ltr;">' + esc(u.discord) + '</div></div>' : '') +
            '</div>' +
        '</div>';
    
    box.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            const act = btn.dataset.action;
            if (act === 'add-friend') sendFriendRequest(userId);
            if (act === 'unfriend') { unfriend(userId); renderProfilePage(userId); }
            if (act === 'block') { if (confirm('بلاک بشه؟')) { blockUser(userId); renderProfilePage(userId); } }
            if (act === 'unblock') { unblockUser(userId); renderProfilePage(userId); }
            if (act === 'private-msg') {
                S.pmActiveUser = userId;
                showPage('pm');
                const layout = $('#pmLayout');
                if (layout) layout.classList.add('viewing');
            }
        });
    });
    const editMe = $('#editMyProfileBtn');
    if (editMe) editMe.addEventListener('click', () => openUserPanel('profile'));
}

function unfriend(userId) {
    if (!S.user) return;
    const users = DB.getUsers();
    const me = users.find(u => u.id === S.user.id);
    const other = users.find(u => u.id === userId);
    if (!me || !other) return;
    me.friends = (me.friends || []).filter(id => id !== userId);
    other.friends = (other.friends || []).filter(id => id !== me.id);
    DB.setUsers(users);
    S.user = me;
    updateBadges();
    toast('لغو دوستی شد');
}

function sendFriendRequest(targetId) {
    if (!S.user) { toast('اول وارد شو'); return; }
    if (targetId === S.user.id) return;
    const users = DB.getUsers();
    const me = users.find(u => u.id === S.user.id);
    const target = users.find(u => u.id === targetId);
    if (!me || !target) return;
    if ((me.friends || []).indexOf(targetId) > -1) { toast('قبلا دوستته'); return; }
    if ((target.friendRequests || []).indexOf(me.id) > -1) { toast('قبلا درخواست دادی'); return; }
    target.friendRequests = target.friendRequests || [];
    target.friendRequests.push(me.id);
    DB.setUsers(users);
    S.user = me;
    const notifs = DB.getNotifs();
    notifs.push({
        id: uid('n_'), userId: targetId, type: 'friend_request',
        text: me.displayName + ' بهت درخواست دوستی داد', ts: Date.now(), read: false
    });
    DB.setNotifs(notifs);
    toast('درخواست فرستاده شد');
}

/* ══════════════════════════════════════════════════════════════
   ۱۹. User Panel
   ══════════════════════════════════════════════════════════════ */
function openUserPanel(tab) {
    if (!S.user) { openModal('authOverlay'); return; }
    const panel = $('#userPanel');
    if (!panel) return;
    const defaultTab = tab || 'activity';
    $$('.up-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === defaultTab));
    renderUserPanelBody(defaultTab);
    panel.classList.add('on');
    document.body.classList.add('locked');
}

function closeUserPanel() {
    const panel = $('#userPanel');
    if (panel) panel.classList.remove('on');
    if (!document.querySelector('.modal-overlay.on') &&
        !document.querySelector('.side-modal:not([hidden])') &&
        !document.querySelector('.reply-modal-overlay.on')) {
        document.body.classList.remove('locked');
    }
}

function renderUserPanelBody(tab) {
    const body = $('#userPanelBody');
    if (!body || !S.user) return;
    if (tab === 'activity') body.innerHTML = renderActivityTab();
    else if (tab === 'profile') body.innerHTML = renderProfileTab();
    else if (tab === 'notifications') body.innerHTML = renderNotifsTab();
    else if (tab === 'messages') body.innerHTML = renderMessagesTab();
    else if (tab === 'friends') body.innerHTML = renderFriendsTab();
    else if (tab === 'groups') body.innerHTML = renderGroupsTab();
    else if (tab === 'blocked') body.innerHTML = renderBlockedTab();
    initUserPanelEvents(tab);
}

function renderActivityTab() {
    const u = S.user;
    const posts = DB.getPosts().filter(p => p.authorId === u.id);
    let cc = 0;
    DB.getPosts().forEach(p => (p.comments || []).forEach(c => { if (c.userId === u.id) cc++; }));
    let roleLabel = 'کاربر عادی';
    if (u.role === 'admin') roleLabel = 'مدیر سایت';
    else if (u.role === 'editor') roleLabel = 'سردبیر';
    else if (u.role === 'author') roleLabel = 'نویسنده';
    return '<div class="up-content active">' +
        '<div class="panel-stats-grid">' +
            '<div class="panel-stat-box"><strong>' + faNum(u.xp || 0) + '</strong><span>امتیاز</span></div>' +
            '<div class="panel-stat-box"><strong>' + faNum(u.level || 1) + '</strong><span>سطح</span></div>' +
            '<div class="panel-stat-box"><strong>' + faNum(posts.length) + '</strong><span>پست</span></div>' +
            '<div class="panel-stat-box"><strong>' + faNum(cc) + '</strong><span>نظر</span></div>' +
            '<div class="panel-stat-box"><strong>' + faNum((u.friends || []).length) + '</strong><span>دوست</span></div>' +
            '<div class="panel-stat-box"><strong>' + faNum((u.groups || []).length) + '</strong><span>گروه</span></div>' +
        '</div>' +
        '<div style="padding:14px;border-radius:14px;background:var(--surface-2);">' +
            '<div style="font-size:12px;color:var(--text-mute);margin-bottom:6px;">وضعیت حساب</div>' +
            '<div style="font-size:14px;font-weight:700;">' + esc(roleLabel) + '</div>' +
        '</div>' +
        '<button class="btn-ghost full" id="logoutBtn" type="button" style="margin-top:16px;color:var(--danger);">خروج از حساب</button></div>';
}

function renderProfileTab() {
    const u = S.user;
    const initial = (u.displayName || 'U')[0].toUpperCase();
    return '<div class="up-content active"><div class="profile-form">' +
        '<div class="profile-cover-section">' +
            '<div class="profile-cover-preview">' + (u.cover ? '<img src="' + escAttr(u.cover) + '" alt="">' : '') + '</div>' +
            '<button class="btn-ghost small" id="changeCoverBtn" type="button">تغییر کاور</button>' +
            '<input type="file" id="coverFile" accept="image/*" hidden></div>' +
        '<div class="profile-avatar-section">' +
            '<div class="user-avatar">' + (u.avatar ? '<img src="' + escAttr(u.avatar) + '" alt="">' : esc(initial)) + '</div>' +
            '<button class="btn-ghost small" id="changeAvatarBtn" type="button">تغییر آواتار</button>' +
            '<input type="file" id="avatarFile" accept="image/*" hidden></div>' +
        '<div class="form-group"><label>لقب</label><input type="text" id="pTitle" value="' + escAttr(u.title || '') + '"></div>' +
        '<div class="form-row">' +
            '<div class="form-group"><label>نام</label><input type="text" id="pFirstName" value="' + escAttr(u.firstName || '') + '"></div>' +
            '<div class="form-group"><label>نام خانوادگی</label><input type="text" id="pLastName" value="' + escAttr(u.lastName || '') + '"></div></div>' +
        '<div class="form-group"><label>نام نمایشی</label><input type="text" id="pDisplayName" value="' + escAttr(u.displayName) + '"></div>' +
        '<div class="form-group"><label>تاریخ تولد</label><input type="text" id="pBirthday" value="' + escAttr(u.birthday || '') + '"></div>' +
        '<div class="form-group"><label>پلتفرم</label><select id="pPlatform">' +
            '<option value="ps5"' + (u.platform === 'ps5' ? ' selected' : '') + '>PlayStation 5</option>' +
            '<option value="xbox"' + (u.platform === 'xbox' ? ' selected' : '') + '>Xbox</option>' +
            '<option value="switch"' + (u.platform === 'switch' ? ' selected' : '') + '>Nintendo Switch</option>' +
            '<option value="pc"' + (u.platform === 'pc' ? ' selected' : '') + '>PC</option>' +
            '<option value="mobile"' + (u.platform === 'mobile' ? ' selected' : '') + '>موبایل</option>' +
        '</select></div>' +
        '<div class="form-group"><label>وبسایت</label><input type="text" id="pWebsite" value="' + escAttr(u.website || '') + '" dir="ltr"></div>' +
        '<div class="form-group"><label>بیوگرافی</label><textarea id="pBio">' + esc(u.bio || '') + '</textarea></div>' +
        '<div class="form-group"><label>بازی‌های مورد علاقه</label><input type="text" id="pFavGames" value="' + escAttr(u.favGames || '') + '"></div>' +
        '<div class="form-group"><label>فیلم‌های مورد علاقه</label><input type="text" id="pFavMovies" value="' + escAttr(u.favMovies || '') + '"></div>' +
        '<div class="form-group"><label>اینستاگرام</label><input type="text" id="pInstagram" value="' + escAttr(u.instagram || '') + '" dir="ltr"></div>' +
        '<div class="form-group"><label>تلگرام</label><input type="text" id="pTelegram" value="' + escAttr(u.telegram || '') + '" dir="ltr"></div>' +
        '<div class="form-group"><label>دیسکورد</label><input type="text" id="pDiscord" value="' + escAttr(u.discord || '') + '" dir="ltr"></div>' +
        '<button class="btn-primary full" id="saveProfileBtn" type="button">ذخیره پروفایل</button></div></div>';
}

function renderNotifsTab() {
    const notifs = DB.getNotifs().filter(n => n.userId === S.user.id).reverse();
    const unread = notifs.filter(n => !n.read);
    if (!notifs.length) return '<div class="empty-state"><h3>اعلانی نداری</h3></div>';
    const icons = { comment: 'ن', friend_request: 'د', message: 'پ', group_request: 'گ', pending_comment: 'ت' };
    let html = '<div class="up-content active">';
    if (unread.length) {
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
            '<span style="font-size:12px;font-weight:700;color:var(--text-mute);">' + faNum(unread.length) + ' خوانده‌نشده</span>' +
            '<button class="btn-ghost small" id="markAllRead" type="button">خواندن همه</button></div>';
    }
    notifs.forEach(n => {
        html += '<div class="notif-item ' + (n.read ? '' : 'unread') + '" data-notif-id="' + escAttr(n.id) + '"' +
            (n.link ? ' data-notif-link="' + escAttr(n.link) + '"' : '') + '>' +
            '<div class="notif-icon">' + esc(icons[n.type] || '؟') + '</div>' +
            '<div class="notif-body"><p>' + esc(n.text) + '</p><small>' + timeAgo(n.ts) + '</small></div></div>';
    });
    html += '</div>';
    return html;
}

function renderMessagesTab() {
    const msgs = DB.getPM().filter(m => (m.to === S.user.id || m.from === S.user.id) && !m.deleted).reverse();
    if (!msgs.length) return '<div class="empty-state"><h3>پیامی نداری</h3><button class="btn-primary small" id="goToPM" type="button" style="margin-top:14px;">رفتن به پیام‌ها</button></div>';
    let html = '<div class="up-content active">';
    html += '<button class="btn-primary full" id="goToPM" type="button" style="margin-bottom:14px;">رفتن به پیام‌ها</button>';
    msgs.slice(0, 20).forEach(m => {
        const isMine = m.from === S.user.id;
        const otherId = isMine ? m.to : m.from;
        const other = getUserById(otherId);
        const preview = m.file && !m.text ? '[فایل]' : stripHtml(m.text || '').slice(0, 60);
        html += '<div class="notif-item" data-pm-from="' + escAttr(otherId) + '">' +
            '<div class="user-avatar" style="width:36px;height:36px;">' +
                (other && other.avatar ? '<img src="' + escAttr(other.avatar) + '" alt="">' : esc(other ? other.displayName[0] : 'U')) + '</div>' +
            '<div class="notif-body"><p><strong>' + (isMine ? 'شما' : esc(other ? other.displayName : 'کاربر')) + ':</strong> ' + esc(preview) + '</p>' +
            '<small>' + timeAgo(m.ts) + '</small></div></div>';
    });
    html += '</div>';
    return html;
}

function renderFriendsTab() {
    const u = S.user;
    const friends = u.friends || [];
    const requests = u.friendRequests || [];
    let html = '<div class="up-content active">';
    if (requests.length) {
        html += '<h4 style="font-size:14px;font-weight:800;margin-bottom:10px;">درخواست‌ها (' + faNum(requests.length) + ')</h4>';
        const users = DB.getUsers();
        requests.forEach(rid => {
            const r = users.find(x => x.id === rid);
            if (!r) return;
            html += '<div class="notif-item">' +
                '<div class="user-avatar" style="width:36px;height:36px;">' +
                    (r.avatar ? '<img src="' + escAttr(r.avatar) + '" alt="">' : esc(r.displayName[0])) + '</div>' +
                '<div class="notif-body"><p><strong>' + esc(r.displayName) + '</strong> @' + esc(r.username) + '</p>' +
                '<div style="display:flex;gap:6px;margin-top:6px;">' +
                    '<button class="btn-primary small" data-accept-friend="' + escAttr(rid) + '" type="button">قبول</button>' +
                    '<button class="btn-ghost small" data-reject-friend="' + escAttr(rid) + '" type="button">رد</button>' +
                '</div></div></div>';
        });
    }
    html += '<h4 style="font-size:14px;font-weight:800;margin:16px 0 10px;">دوستان (' + faNum(friends.length) + ')</h4>';
    if (!friends.length) html += '<p style="text-align:right;color:var(--text-mute);padding:20px;font-size:13px;">هنوز دوستی نداری</p>';
    else {
        const users = DB.getUsers();
        friends.forEach(fid => {
            const f = users.find(x => x.id === fid);
            if (!f) return;
            html += '<div class="notif-item">' +
                '<div class="user-avatar" style="width:36px;height:36px;">' +
                    (f.avatar ? '<img src="' + escAttr(f.avatar) + '" alt="">' : esc(f.displayName[0])) + '</div>' +
                '<div class="notif-body"><p><strong>' + esc(f.displayName) + '</strong></p>' +
                '<small>@' + esc(f.username) + '</small></div>' +
                '<button class="btn-ghost small" data-chat-friend="' + escAttr(fid) + '" type="button">پیام</button></div>';
        });
    }
    html += '</div>';
    return html;
}

function renderGroupsTab() {
    const u = S.user;
    const groups = DB.getGroups().filter(g => (u.groups || []).indexOf(g.id) > -1);
    if (!groups.length) return '<div class="empty-state"><h3>توی هیچ گروهی نیستی</h3></div>';
    let html = '<div class="up-content active">';
    groups.forEach(g => {
        html += '<div class="notif-item" data-group-link="' + escAttr(g.id) + '" style="cursor:pointer;">' +
            '<div class="user-avatar" style="width:36px;height:36px;font-size:14px;">' +
                (g.avatar ? '<img src="' + escAttr(g.avatar) + '" alt="">' : esc((g.name[0] || 'G').toUpperCase())) + '</div>' +
            '<div class="notif-body"><p><strong>' + esc(g.name) + '</strong></p>' +
            '<small>' + faNum((g.members || []).length) + ' عضو</small></div></div>';
    });
    html += '</div>';
    return html;
}

function renderBlockedTab() {
    const b = DB.getBlocks();
    const myBlocked = b[S.user.id] || [];
    if (!myBlocked.length) return '<div class="empty-state"><h3>کسی رو بلاک نکردی</h3></div>';
    const users = DB.getUsers();
    let html = '<div class="up-content active">';
    myBlocked.forEach(bid => {
        const u = users.find(x => x.id === bid);
        if (!u) return;
        html += '<div class="notif-item">' +
            '<div class="user-avatar" style="width:36px;height:36px;">' +
                (u.avatar ? '<img src="' + escAttr(u.avatar) + '" alt="">' : esc(u.displayName[0])) + '</div>' +
            '<div class="notif-body"><p><strong>' + esc(u.displayName) + '</strong></p>' +
            '<small>@' + esc(u.username) + '</small></div>' +
            '<button class="btn-ghost small" data-unblock-user="' + escAttr(bid) + '" type="button">رفع بلاک</button></div>';
    });
    html += '</div>';
    return html;
}

function initUserPanelEvents(tab) {
    if (tab === 'activity') {
        const b = $('#logoutBtn');
        if (b) b.addEventListener('click', logoutUser);
    }
    if (tab === 'profile') {
        const chAv = $('#changeAvatarBtn'); const avInp = $('#avatarFile');
        if (chAv && avInp) {
            chAv.addEventListener('click', () => avInp.click());
            avInp.addEventListener('change', e => {
                const f = e.target.files[0];
                if (f) openCrop(f, 'avatar-user', S.user.id);
            });
        }
        const chCv = $('#changeCoverBtn'); const cvInp = $('#coverFile');
        if (chCv && cvInp) {
            chCv.addEventListener('click', () => cvInp.click());
            cvInp.addEventListener('change', e => {
                const f = e.target.files[0];
                if (f) openCrop(f, 'cover-user', S.user.id);
            });
        }
        const sv = $('#saveProfileBtn');
        if (sv) sv.addEventListener('click', () => {
            const users = DB.getUsers();
            const me = users.find(u => u.id === S.user.id);
            if (!me) return;
            me.title = $('#pTitle').value.trim();
            me.firstName = $('#pFirstName').value.trim();
            me.lastName = $('#pLastName').value.trim();
            me.displayName = $('#pDisplayName').value.trim() || me.displayName;
            me.birthday = $('#pBirthday').value.trim();
            me.platform = $('#pPlatform').value;
            me.website = $('#pWebsite').value.trim();
            me.bio = $('#pBio').value.trim();
            me.favGames = $('#pFavGames').value.trim();
            me.favMovies = $('#pFavMovies').value.trim();
            me.instagram = $('#pInstagram').value.trim();
            me.telegram = $('#pTelegram').value.trim();
            me.discord = $('#pDiscord').value.trim();
            DB.setUsers(users);
            S.user = me;
            updateAuthUI();
            toast('ذخیره شد');
        });
    }
    if (tab === 'notifications') {
        const mar = $('#markAllRead');
        if (mar) mar.addEventListener('click', () => {
            const notifs = DB.getNotifs();
            notifs.forEach(n => { if (n.userId === S.user.id) n.read = true; });
            DB.setNotifs(notifs);
            updateBadges();
            renderUserPanelBody('notifications');
        });
        $$('[data-notif-id]').forEach(el => {
            el.addEventListener('click', () => {
                const notifs = DB.getNotifs();
                const n = notifs.find(x => x.id === el.dataset.notifId);
                if (n) n.read = true;
                DB.setNotifs(notifs);
                updateBadges();
                const link = el.dataset.notifLink;
                if (link) {
                    const parts = link.split(':');
                    if (parts[0] === 'post') { closeUserPanel(); showPage('post', parts[1]); }
                    else if (parts[0] === 'group') { closeUserPanel(); showPage('group', parts[1]); }
                } else renderUserPanelBody('notifications');
            });
        });
    }
    if (tab === 'messages') {
        const gpm = $('#goToPM');
        if (gpm) gpm.addEventListener('click', () => { closeUserPanel(); showPage('pm'); });
        $$('[data-pm-from]').forEach(el => el.addEventListener('click', () => {
            S.pmActiveUser = el.dataset.pmFrom;
            closeUserPanel();
            showPage('pm');
            const layout = $('#pmLayout');
            if (layout) layout.classList.add('viewing');
        }));
    }
    if (tab === 'friends') {
        $$('[data-accept-friend]').forEach(b => b.addEventListener('click', () => acceptFriend(b.dataset.acceptFriend)));
        $$('[data-reject-friend]').forEach(b => b.addEventListener('click', () => rejectFriend(b.dataset.rejectFriend)));
        $$('[data-chat-friend]').forEach(b => b.addEventListener('click', () => {
            S.pmActiveUser = b.dataset.chatFriend;
            closeUserPanel();
            showPage('pm');
            const layout = $('#pmLayout');
            if (layout) layout.classList.add('viewing');
        }));
    }
    if (tab === 'groups') {
        $$('[data-group-link]').forEach(el => el.addEventListener('click', () => {
            closeUserPanel();
            showPage('group', el.dataset.groupLink);
        }));
    }
    if (tab === 'blocked') {
        $$('[data-unblock-user]').forEach(b => b.addEventListener('click', () => {
            unblockUser(b.dataset.unblockUser);
            renderUserPanelBody('blocked');
        }));
    }
}

function acceptFriend(fromId) {
    const users = DB.getUsers();
    const me = users.find(u => u.id === S.user.id);
    const other = users.find(u => u.id === fromId);
    if (!me || !other) return;
    me.friendRequests = (me.friendRequests || []).filter(id => id !== fromId);
    me.friends = me.friends || []; other.friends = other.friends || [];
    if (me.friends.indexOf(fromId) === -1) me.friends.push(fromId);
    if (other.friends.indexOf(me.id) === -1) other.friends.push(me.id);
    DB.setUsers(users);
    S.user = me;
    updateBadges();
    renderUserPanelBody('friends');
    toast('حالا دوستید');
}

function rejectFriend(fromId) {
    const users = DB.getUsers();
    const me = users.find(u => u.id === S.user.id);
    if (!me) return;
    me.friendRequests = (me.friendRequests || []).filter(id => id !== fromId);
    DB.setUsers(users);
    S.user = me;
    updateBadges();
    renderUserPanelBody('friends');
}

/* ══════════════════════════════════════════════════════════════
   ۲۰. Modals
   ══════════════════════════════════════════════════════════════ */
function openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.hidden = false;
    requestAnimationFrame(() => {
        el.classList.add('on');
        if (window.innerWidth > 768) {
            const firstInput = el.querySelector('input:not([type="hidden"]):not([type="color"]), textarea, [contenteditable="true"]');
            if (firstInput) firstInput.focus({ preventScroll: true });
        }
    });
    document.body.classList.add('locked');
}
function closeModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('on');
    setTimeout(() => {
        el.hidden = true;
        if (!document.querySelector('.modal-overlay.on') &&
            !document.querySelector('.side-modal:not([hidden])') &&
            !document.querySelector('.user-panel.on') &&
            !document.querySelector('.reply-modal-overlay.on')) {
            document.body.classList.remove('locked');
        }
    }, 220);
}
function closeAllModals() {
    ['authOverlay', 'newGroupOverlay', 'groupSettingsOverlay', 'searchOverlay', 'cropOverlay'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.hidden) closeModal(id);
    });
    ['adminPanel', 'editorPanel', 'authorPanel'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.hidden) el.hidden = true;
    });
    closeReplyModal();
    closeUserPanel();
    closeDrawer();
    closeLightbox();
}

/* ══════════════════════════════════════════════════════════════
   ۲۱. Auth
   ══════════════════════════════════════════════════════════════ */
function initAuth() {
    $$('.auth-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.authTab;
            $$('.auth-tab').forEach(t => t.classList.toggle('active', t === tab));
            const lf = $('#loginForm'); const rf = $('#registerForm');
            if (lf) { lf.classList.toggle('active', target === 'login'); lf.hidden = target !== 'login'; }
            if (rf) { rf.classList.toggle('active', target === 'register'); rf.hidden = target !== 'register'; }
        });
    });
    const lf = $('#loginForm');
    if (lf) lf.addEventListener('submit', e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const username = String(fd.get('username') || '').toLowerCase().trim();
        const password = String(fd.get('password') || '');
        const users = DB.getUsers();
        const user = users.find(u => u.username === username);
        if (!user) { toast('کاربری با این نام پیدا نشد'); return; }
        if (user.passHash !== hashPass(password)) { toast('رمز اشتباهه'); return; }
        user.lastSeen = Date.now();
        DB.setUsers(users);
        DB.setSession({ userId: user.id, ts: Date.now() });
        S.user = user;
        updateAuthUI();
        closeModal('authOverlay');
        e.target.reset();
        toast('خوش اومدی ' + user.displayName);
        // PM اول از سمت یه seed
        setTimeout(() => SeedEngine.tryInitiatePM(), 5000);
    });
    const rf = $('#registerForm');
    if (rf) rf.addEventListener('submit', e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const username = String(fd.get('username') || '').toLowerCase().trim();
        const displayName = String(fd.get('displayName') || '').trim();
        const password = String(fd.get('password') || '');
        const platform = fd.get('platform') || 'pc';
        if (!/^[a-z][a-z0-9_]{2,19}$/.test(username)) { toast('نام کاربری فقط با حروف انگلیسی'); return; }
        const users = DB.getUsers();
        if (users.some(u => u.username === username)) { toast('این نام کاربری گرفته شده'); return; }
        if (password.length < 6) { toast('رمز باید حداقل ۶ کاراکتر باشه'); return; }
        const user = {
            id: uid('u_'), username, displayName: displayName || username,
            passHash: hashPass(password), platform,
            avatar: null, cover: null, bio: '', title: '',
            firstName: '', lastName: '', birthday: '', website: '',
            favGames: '', favMovies: '', instagram: '', telegram: '', discord: '',
            role: 'user', tick: null, verified: false, level: 1, xp: 0,
            joinedAt: Date.now(), lastSeen: Date.now(),
            friends: [], friendRequests: [], blocked: [], groups: []
        };
        users.push(user);
        DB.setUsers(users);
        DB.setSession({ userId: user.id, ts: Date.now() });
        S.user = user;
        updateAuthUI();
        closeModal('authOverlay');
        e.target.reset();
        toast('خوش اومدی ' + user.displayName);
        setTimeout(() => SeedEngine.tryInitiatePM(), 5000);
    });
}

/* ══════════════════════════════════════════════════════════════
   ۲۲. Drawer
   ══════════════════════════════════════════════════════════════ */
function openDrawer() {
    const d = $('#drawer');
    if (!d) return;
    d.hidden = false;
    document.body.classList.add('locked');
}
function closeDrawer() {
    const d = $('#drawer');
    if (!d) return;
    d.hidden = true;
    if (!document.querySelector('.modal-overlay.on') &&
        !document.querySelector('.side-modal:not([hidden])') &&
        !document.querySelector('.user-panel.on')) {
        document.body.classList.remove('locked');
    }
}

/* ══════════════════════════════════════════════════════════════
   ۲۳. Panels (Admin/Editor/Author)
   ══════════════════════════════════════════════════════════════ */
function openAdminPanel() { const p = $('#adminPanel'); if (p) { p.hidden = false; renderAdminTab('stats'); } }
function openEditorPanel() { const p = $('#editorPanel'); if (p) { p.hidden = false; renderEditorTab('myposts'); } }
function openAuthorPanel() { const p = $('#authorPanel'); if (p) { p.hidden = false; renderAuthorTab('myposts'); } }

function renderAdminTab(tab) {
    S.adminTab = tab;
    const body = $('#adminBody');
    if (!body) return;
    $$('.sm-tab[data-admin-tab]').forEach(t => t.classList.toggle('active', t.dataset.adminTab === tab));
    const users = DB.getUsers();
    const posts = DB.getPosts();
    const groups = DB.getGroups();
    const pending = DB.getPending();
    if (tab === 'stats') {
        const totalViews = posts.reduce((s, p) => s + (p.views || 0), 0);
        const totalLikes = posts.reduce((s, p) => s + (p.comments || []).reduce((ss, c) => ss + (c.likes || []).length, 0), 0);
        const totalComments = posts.reduce((s, p) => s + (p.comments || []).length, 0);
        body.innerHTML = '<div class="admin-stats-grid">' +
            '<div class="admin-stat-card"><strong>' + faNum(users.length) + '</strong><span>کاربران</span></div>' +
            '<div class="admin-stat-card green"><strong>' + faNum(posts.length) + '</strong><span>پست‌ها</span></div>' +
            '<div class="admin-stat-card pink"><strong>' + faNum(totalViews) + '</strong><span>بازدید کل</span></div>' +
            '<div class="admin-stat-card orange"><strong>' + faNum(totalLikes) + '</strong><span>لایک کل</span></div>' +
            '<div class="admin-stat-card"><strong>' + faNum(totalComments) + '</strong><span>کامنت کل</span></div>' +
            '<div class="admin-stat-card green"><strong>' + faNum(groups.length) + '</strong><span>گروه‌ها</span></div>' +
            '<div class="admin-stat-card orange"><strong>' + faNum(pending.length) + '</strong><span>در انتظار</span></div>' +
            '<div class="admin-stat-card pink"><strong>' + faNum(DB.getActivity().length) + '</strong><span>فعالیت‌ها</span></div></div>';
    } else if (tab === 'users') {
        body.innerHTML = users.map(u =>
            '<div class="admin-user-row">' +
                '<div class="admin-user-info">' +
                    '<div class="user-avatar" style="width:36px;height:36px;">' +
                        (u.avatar ? '<img src="' + escAttr(u.avatar) + '" alt="">' : esc(u.displayName[0])) + '</div>' +
                    '<div><strong style="font-size:13px;">' + esc(u.displayName) + '</strong>' + badgesHtml(u) +
                        '<div style="font-size:11px;color:var(--text-mute);">@' + esc(u.username) + ' · ' + esc(u.role) + '</div></div>' +
                '</div>' +
                '<div class="admin-user-actions">' +
                    '<select data-role="' + escAttr(u.id) + '" style="padding:5px 8px;border-radius:6px;background:var(--field);font-size:11px;">' +
                        '<option value="user"' + (u.role === 'user' ? ' selected' : '') + '>کاربر</option>' +
                        '<option value="author"' + (u.role === 'author' ? ' selected' : '') + '>نویسنده</option>' +
                        '<option value="editor"' + (u.role === 'editor' ? ' selected' : '') + '>سردبیر</option>' +
                        '<option value="admin"' + (u.role === 'admin' ? ' selected' : '') + '>مدیر</option>' +
                    '</select>' +
                    '<button class="btn-ghost small" data-tick-blue="' + escAttr(u.id) + '" type="button">آبی</button>' +
                    '<button class="btn-ghost small" data-tick-gold="' + escAttr(u.id) + '" type="button">طلایی</button>' +
                    '<button class="btn-ghost small" data-tick-none="' + escAttr(u.id) + '" type="button">حذف تیک</button>' +
                    '<button class="btn-ghost small danger" data-delete-user="' + escAttr(u.id) + '" type="button">حذف</button>' +
                '</div></div>').join('');
    } else if (tab === 'posts') {
        body.innerHTML = posts.length ? posts.map(p =>
            '<div class="admin-user-row">' +
                '<div class="admin-user-info"><div><strong style="font-size:13px;">' + esc(p.title) + '</strong>' +
                    '<div style="font-size:11px;color:var(--text-mute);">' + esc(p.authorName || '') + ' · ' + timeAgo(p.createdAt) + '</div></div></div>' +
                '<div class="admin-user-actions">' +
                    '<button class="btn-ghost small" data-edit-post="' + escAttr(p.id) + '" type="button">ویرایش</button>' +
                    '<button class="btn-ghost small danger" data-delete-post="' + escAttr(p.id) + '" type="button">حذف</button>' +
                '</div></div>').join('') : '<div class="empty-state"><h3>پستی نیست</h3></div>';
    } else if (tab === 'comments') {
        if (!pending.length) body.innerHTML = '<div class="empty-state"><h3>کامنت در انتظاری نیست</h3></div>';
        else {
            body.innerHTML = pending.map(item => {
                const u = getUserById(item.comment.userId);
                return '<div class="pending-item">' +
                    '<div class="pending-item-head">' +
                        '<div class="user-avatar" style="width:32px;height:32px;">' +
                            (u && u.avatar ? '<img src="' + escAttr(u.avatar) + '" alt="">' : esc(u ? u.displayName[0] : '؟')) + '</div>' +
                        '<div><strong>' + esc(u ? u.displayName : 'ناشناس') + '</strong>' +
                        '<div style="font-size:11px;color:var(--text-mute);">' + timeAgo(item.addedAt) + '</div></div></div>' +
                    '<div class="pending-item-body">' + item.comment.content + '</div>' +
                    '<div class="pending-actions">' +
                        '<button class="btn-primary small" data-approve-comment="' + escAttr(item.comment.id) + '" type="button">تأیید</button>' +
                        '<button class="btn-ghost small danger" data-reject-comment="' + escAttr(item.comment.id) + '" type="button">رد</button>' +
                    '</div></div>';
            }).join('');
        }
    } else if (tab === 'groups') {
        body.innerHTML = groups.length ? groups.map(g =>
            '<div class="admin-user-row">' +
                '<div class="admin-user-info">' +
                    '<div class="user-avatar" style="width:36px;height:36px;font-size:14px;">' +
                        (g.avatar ? '<img src="' + escAttr(g.avatar) + '" alt="">' : esc((g.name[0] || 'G').toUpperCase())) + '</div>' +
                    '<div><strong style="font-size:13px;">' + esc(g.name) + '</strong>' +
                        '<div style="font-size:11px;color:var(--text-mute);">' + esc(g.type === 'public' ? 'عمومی' : 'خصوصی') + ' · ' + faNum((g.members || []).length) + ' عضو</div></div></div>' +
                '<div class="admin-user-actions">' +
                    '<button class="btn-ghost small" data-view-group="' + escAttr(g.id) + '" type="button">مشاهده</button>' +
                    '<button class="btn-ghost small danger" data-delete-group="' + escAttr(g.id) + '" type="button">حذف</button>' +
                '</div></div>').join('') : '<div class="empty-state"><h3>گروهی نیست</h3></div>';
    } else if (tab === 'roles') {
        const authors = users.filter(u => u.role === 'author' || u.role === 'editor' || u.role === 'admin');
        body.innerHTML = '<h4 style="font-size:14px;font-weight:800;margin-bottom:14px;">تیم تحریریه و مدیریت</h4>' +
            (authors.length ? authors.map(u =>
                '<div class="admin-user-row"><div class="admin-user-info">' +
                    '<div class="user-avatar" style="width:36px;height:36px;">' +
                        (u.avatar ? '<img src="' + escAttr(u.avatar) + '" alt="">' : esc(u.displayName[0])) + '</div>' +
                    '<div><strong>' + esc(u.displayName) + '</strong>' + badgesHtml(u) +
                        '<div style="font-size:11px;color:var(--text-mute);">' + esc(u.role) + '</div></div></div></div>'
            ).join('') : '<div class="empty-state"><h3>تیم تحریریه خالیه</h3></div>');
    } else if (tab === 'broadcast') {
        body.innerHTML = renderBroadcastPanel();
        bindBroadcastPanel();
    } else if (tab === 'backup') {
        body.innerHTML = '<div style="padding:20px;border-radius:14px;background:var(--surface-2);margin-bottom:14px;">' +
            '<h4 style="font-size:14px;font-weight:800;margin-bottom:10px;">خروجی</h4>' +
            '<button class="btn-primary full" id="exportDataBtn" type="button">دانلود پشتیبان JSON</button></div>' +
            '<div style="padding:20px;border-radius:14px;background:var(--surface-2);">' +
            '<h4 style="font-size:14px;font-weight:800;margin-bottom:10px;">ورودی</h4>' +
            '<button class="btn-ghost full" id="importDataBtn" type="button">بازیابی از فایل</button>' +
            '<input type="file" id="importDataInput" accept=".json" hidden></div>';
    }
}

function renderEditorTab(tab) {
    S.editorTab = tab;
    const body = $('#editorBody');
    if (!body) return;
    $$('.sm-tab[data-editor-tab]').forEach(t => t.classList.toggle('active', t.dataset.editorTab === tab));
    const posts = DB.getPosts().filter(p => p.authorId === S.user.id);
    const pending = DB.getPending();
    if (tab === 'myposts') {
        body.innerHTML = posts.length ? posts.map(p =>
            '<div class="admin-user-row"><div class="admin-user-info">' +
                '<div><strong style="font-size:13px;">' + esc(p.title) + '</strong>' +
                '<div style="font-size:11px;color:var(--text-mute);">' + timeAgo(p.createdAt) + ' · ' + faNum(p.views || 0) + ' بازدید</div></div></div>' +
                '<div class="admin-user-actions">' +
                    '<button class="btn-ghost small" data-edit-post="' + escAttr(p.id) + '" type="button">ویرایش</button></div></div>'
        ).join('') : '<div class="empty-state"><h3>هنوز پستی نداری</h3></div>';
    } else if (tab === 'featured') {
        const published = DB.getPosts().filter(p => p.status === 'published');
        body.innerHTML = '<h4 style="font-size:14px;font-weight:800;margin-bottom:14px;">انتخاب سردبیر</h4>' +
            (published.length ? published.map(p =>
                '<div class="admin-user-row"><div class="admin-user-info">' +
                    '<div><strong style="font-size:13px;">' + esc(p.title) + '</strong>' +
                    '<div style="font-size:11px;color:var(--text-mute);">' + esc(p.authorName || '') + '</div></div></div>' +
                    '<div class="admin-user-actions"><button class="btn-ghost small" data-feature-post="' + escAttr(p.id) + '" type="button">' +
                        (p.editorChoice ? 'حذف انتخاب' : 'انتخاب سردبیر') + '</button></div></div>'
            ).join('') : '<div class="empty-state"><h3>پستی نیست</h3></div>');
    } else if (tab === 'comments') {
        if (!pending.length) body.innerHTML = '<div class="empty-state"><h3>کامنت در انتظاری نیست</h3></div>';
        else {
            body.innerHTML = pending.map(item => {
                const u = getUserById(item.comment.userId);
                return '<div class="pending-item"><div class="pending-item-head">' +
                    '<div class="user-avatar" style="width:32px;height:32px;">' +
                        (u && u.avatar ? '<img src="' + escAttr(u.avatar) + '" alt="">' : esc(u ? u.displayName[0] : '؟')) + '</div>' +
                    '<div><strong>' + esc(u ? u.displayName : 'ناشناس') + '</strong></div></div>' +
                    '<div class="pending-item-body">' + item.comment.content + '</div>' +
                    '<div class="pending-actions">' +
                        '<button class="btn-primary small" data-approve-comment="' + escAttr(item.comment.id) + '" type="button">تأیید</button>' +
                        '<button class="btn-ghost small danger" data-reject-comment="' + escAttr(item.comment.id) + '" type="button">رد</button>' +
                    '</div></div>';
            }).join('');
        }
    } else if (tab === 'ticks') {
        const users = DB.getUsers().filter(u => u.role !== 'admin');
        body.innerHTML = '<h4 style="font-size:14px;font-weight:800;margin-bottom:14px;">مدیریت تیک‌ها</h4>' +
            (users.length ? users.map(u =>
                '<div class="admin-user-row"><div class="admin-user-info">' +
                    '<div class="user-avatar" style="width:36px;height:36px;">' +
                        (u.avatar ? '<img src="' + escAttr(u.avatar) + '" alt="">' : esc(u.displayName[0])) + '</div>' +
                    '<div><strong>' + esc(u.displayName) + '</strong>' + badgesHtml(u) + '</div></div>' +
                    '<div class="admin-user-actions">' +
                        '<button class="btn-ghost small" data-tick-blue="' + escAttr(u.id) + '" type="button">آبی</button>' +
                        '<button class="btn-ghost small" data-tick-gold="' + escAttr(u.id) + '" type="button">طلایی</button>' +
                        '<button class="btn-ghost small" data-tick-none="' + escAttr(u.id) + '" type="button">حذف</button>' +
                    '</div></div>').join('') : '<div class="empty-state"><h3>کاربری نیست</h3></div>');
    } else if (tab === 'broadcast') {
        body.innerHTML = renderBroadcastPanel();
        bindBroadcastPanel();
    }
}

function renderAuthorTab(tab) {
    S.authorTab = tab;
    const body = $('#authorBody');
    if (!body) return;
    $$('.sm-tab[data-author-tab]').forEach(t => t.classList.toggle('active', t.dataset.authorTab === tab));
    const posts = DB.getPosts().filter(p => p.authorId === S.user.id);
    if (tab === 'myposts') {
        const published = posts.filter(p => p.status === 'published');
        body.innerHTML = published.length ? published.map(p =>
            '<div class="admin-user-row"><div class="admin-user-info">' +
                '<div><strong style="font-size:13px;">' + esc(p.title) + '</strong>' +
                '<div style="font-size:11px;color:var(--text-mute);">' + faNum(p.views || 0) + ' بازدید · ' + timeAgo(p.createdAt) + '</div></div></div>' +
                '<div class="admin-user-actions">' +
                    '<button class="btn-ghost small" data-edit-post="' + escAttr(p.id) + '" type="button">ویرایش</button></div></div>'
        ).join('') : '<div class="empty-state"><h3>هنوز پستی نداری</h3></div>';
    } else if (tab === 'drafts') {
        const drafts = posts.filter(p => p.status === 'draft');
        body.innerHTML = drafts.length ? drafts.map(p =>
            '<div class="admin-user-row"><div class="admin-user-info">' +
                '<div><strong style="font-size:13px;">' + esc(p.title) + '</strong>' +
                '<div style="font-size:11px;color:var(--text-mute);">' + timeAgo(p.createdAt) + '</div></div></div>' +
                '<div class="admin-user-actions">' +
                    '<button class="btn-ghost small" data-edit-post="' + escAttr(p.id) + '" type="button">ویرایش</button></div></div>'
        ).join('') : '<div class="empty-state"><h3>پیش‌نویسی نداری</h3></div>';
    }
}

/* ══════════════════════════════════════════════════════════════
   ۲۴. Broadcast
   ══════════════════════════════════════════════════════════════ */
function renderBroadcast() {
    const banner = $('#broadcastBanner');
    if (!banner) return;
    const bc = DB.getBroadcast();
    const isActive = bc && bc.active;
    if (!isActive) { banner.hidden = true; document.body.classList.remove('has-broadcast'); return; }
    const dismissedBy = bc.dismissedBy || [];
    if (S.user && dismissedBy.indexOf(S.user.id) > -1) { banner.hidden = true; document.body.classList.remove('has-broadcast'); return; }
    if (!S.user && store.get('nova.bc.guestDismissed', '') === bc.id) { banner.hidden = true; document.body.classList.remove('has-broadcast'); return; }
    const textEl = $('#broadcastText');
    if (textEl) textEl.innerHTML = '<strong>' + esc(bc.authorName || 'مدیر') + ':</strong> ' + esc(bc.text);
    banner.hidden = false;
    document.body.classList.add('has-broadcast');
    updateBroadcastHeight();
}
function updateBroadcastHeight() {
    const banner = $('#broadcastBanner');
    if (!banner || banner.hidden) return;
    requestAnimationFrame(() => {
        const h = banner.offsetHeight;
        const navH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 60;
        document.documentElement.style.setProperty('--bc-h', (navH + h + 'px'));
    });
}
window.addEventListener('resize', () => { clearTimeout(window._bcResize); window._bcResize = setTimeout(updateBroadcastHeight, 120); });

function dismissBroadcast() {
    const bc = DB.getBroadcast();
    if (!bc) return;
    if (S.user) {
        bc.dismissedBy = bc.dismissedBy || [];
        if (bc.dismissedBy.indexOf(S.user.id) === -1) bc.dismissedBy.push(S.user.id);
        DB.setBroadcast(bc);
    } else store.set('nova.bc.guestDismissed', bc.id);
    const banner = $('#broadcastBanner');
    if (banner) banner.hidden = true;
    document.body.classList.remove('has-broadcast');
}

function renderBroadcastPanel() {
    const bc = DB.getBroadcast();
    const hasActive = bc && bc.active;
    return '<h4 style="font-size:14px;font-weight:800;margin-bottom:14px;">پیام سراسری</h4>' +
        (hasActive ? '<div style="padding:16px;border-radius:14px;background:var(--surface-2);margin-bottom:16px;">' +
            '<div style="font-size:11px;color:var(--text-mute);margin-bottom:6px;">پیام فعال</div>' +
            '<div style="font-size:13px;line-height:1.8;margin-bottom:12px;word-break:break-word;">' + esc(bc.text) + '</div>' +
            '<div style="font-size:11px;color:var(--text-mute);margin-bottom:12px;">توسط ' + esc(bc.authorName) + ' · ' + timeAgo(bc.createdAt) + '</div>' +
            '<button class="btn-ghost small danger full" id="bcDeactivate" type="button">حذف پیام</button></div>' : '') +
        '<div class="form-group" style="margin-bottom:14px;">' +
            '<label>پیام جدید</label>' +
            '<textarea id="bcText" rows="4" placeholder="متن پیام سراسری..."></textarea>' +
            '<small style="font-size:11px;color:var(--text-mute);margin-top:6px;display:block;">این پیام به همه کاربران نمایش داده می‌شود</small></div>' +
        '<button class="btn-primary full" id="bcPublish" type="button">ارسال به همه</button>';
}
function bindBroadcastPanel() {
    const pub = $('#bcPublish');
    if (pub) pub.addEventListener('click', () => {
        const text = $('#bcText').value.trim();
        if (!text) { toast('متن خالیه'); return; }
        if (!S.user) return;
        const bc = { id: uid('bc_'), text, authorId: S.user.id, authorName: S.user.displayName, createdAt: Date.now(), active: true, dismissedBy: [] };
        DB.setBroadcast(bc);
        store.del('nova.bc.guestDismissed');
        renderBroadcast();
        toast('پیام ارسال شد');
        if (S.adminTab === 'broadcast') renderAdminTab('broadcast');
        if (S.editorTab === 'broadcast') renderEditorTab('broadcast');
    });
    const deact = $('#bcDeactivate');
    if (deact) deact.addEventListener('click', () => {
        if (!confirm('پیام حذف بشه؟')) return;
        const bc = DB.getBroadcast();
        if (bc) { bc.active = false; DB.setBroadcast(bc); }
        renderBroadcast();
        toast('پیام حذف شد');
        if (S.adminTab === 'broadcast') renderAdminTab('broadcast');
        if (S.editorTab === 'broadcast') renderEditorTab('broadcast');
    });
}

/* ══════════════════════════════════════════════════════════════
   ۲۵. Editor
   ══════════════════════════════════════════════════════════════ */
function openEditor(postId) {
    const u = S.user;
    if (!u) { openModal('authOverlay'); return; }
    if (u.role !== 'admin' && u.role !== 'editor' && u.role !== 'author') { toast('اجازه نداری'); return; }
    S.editingPostId = postId || null;
    const modal = $('#editorFullscreen');
    const titleEl = $('#editorTitle');
    const contentEl = $('#editorContent');
    const titleText = $('#editorTitleText');
    if (postId) {
        const post = DB.getPosts().find(p => p.id === postId);
        if (!post) { toast('پست پیدا نشد'); S.editingPostId = null; postId = null; }
        else {
            titleEl.value = post.title;
            contentEl.innerHTML = post.content;
            $('#editorCategory').value = post.category;
            $('#editorPlatform').value = post.platform || 'all';
            $('#editorTags').value = (post.tags || []).join('، ');
            $('#editorCover').value = post.cover || '';
            $('#editorExcerpt').value = post.excerpt || '';
            $('#editorScore').value = post.score || '';
            $('#editorChoice').value = post.editorChoice ? 'true' : 'false';
            $('#editorPinned').value = post.pinned ? 'true' : 'false';
            if (titleText) titleText.textContent = 'ویرایش پست';
        }
    }
    if (!postId) {
        titleEl.value = ''; contentEl.innerHTML = '';
        $('#editorCategory').value = 'news';
        $('#editorPlatform').value = 'all';
        $('#editorTags').value = '';
        $('#editorCover').value = '';
        $('#editorExcerpt').value = '';
        $('#editorScore').value = '';
        $('#editorChoice').value = 'false';
        $('#editorPinned').value = 'false';
        if (titleText) titleText.textContent = 'پست جدید';
        const draftTs = +store.get('nova.draft.ts', 0);
        if (draftTs && (Date.now() - draftTs) < 86400000) {
            const draftContent = store.get('nova.draft.content', '');
            const draftTitle = store.get('nova.draft.title', '');
            if (draftContent && confirm('پیش‌نویس ذخیره‌نشده پیدا شد. بازیابی کنم؟')) {
                contentEl.innerHTML = draftContent;
                titleEl.value = draftTitle;
            } else {
                store.del('nova.draft.content');
                store.del('nova.draft.title');
                store.del('nova.draft.ts');
            }
        }
    }
    modal.hidden = false;
    document.body.classList.add('locked');
}

function closeEditor() {
    const modal = $('#editorFullscreen');
    if (modal) modal.hidden = true;
    if (!document.querySelector('.modal-overlay.on') &&
        !document.querySelector('.side-modal:not([hidden])') &&
        !document.querySelector('.user-panel.on')) {
        document.body.classList.remove('locked');
    }
}

function savePost(isDraft) {
    const title = $('#editorTitle').value.trim();
    const content = $('#editorContent').innerHTML;
    if (!title || !content) { toast('عنوان و محتوا لازمه'); return; }
    const u = S.user;
    const posts = DB.getPosts();
    const existing = S.editingPostId ? posts.find(p => p.id === S.editingPostId) : null;
    const data = {
        id: S.editingPostId || uid('p_'),
        title, content,
        category: $('#editorCategory').value,
        platform: $('#editorPlatform').value,
        tags: $('#editorTags').value.split('،').map(t => t.trim()).filter(Boolean),
        cover: $('#editorCover').value.trim() || null,
        excerpt: $('#editorExcerpt').value.trim(),
        score: $('#editorScore').value ? +$('#editorScore').value : null,
        editorChoice: $('#editorChoice').value === 'true',
        pinned: $('#editorPinned').value === 'true',
        status: isDraft ? 'draft' : 'published',
        authorId: u.id, authorName: u.displayName, authorAvatar: u.avatar,
        createdAt: existing ? existing.createdAt : Date.now(),
        updatedAt: Date.now(),
        edited: !!existing,
        views: existing ? (existing.views || 0) : 0,
        comments: existing ? (existing.comments || []) : []
    };
    const idx = posts.findIndex(p => p.id === data.id);
    if (idx > -1) posts[idx] = data;
    else posts.unshift(data);
    DB.setPosts(posts);
    if (!S.editingPostId) {
        addActivity('post', u.displayName + ' پست «' + title + '» رو ' + (isDraft ? 'ذخیره' : 'منتشر') + ' کرد', u.id);
        const users = DB.getUsers();
        const me = users.find(x => x.id === u.id);
        if (me) { me.xp = (me.xp || 0) + 15; me.level = Math.floor(me.xp / 100) + 1; DB.setUsers(users); S.user = me; }
        // Seed Engine — واکنش به پست جدید
        if (!isDraft) {
            setTimeout(() => SeedEngine.onPostPublished(data), 2000);
        }
    }
    store.del('nova.draft.content');
    store.del('nova.draft.title');
    store.del('nova.draft.ts');
    toast(isDraft ? 'پیش‌نویس ذخیره شد' : (S.editingPostId ? 'ویرایش شد' : 'منتشر شد'));
    closeEditor();
    renderHome();
    if (S.page === 'post') renderPostPage(data.id);
    S.editingPostId = null;
}

function initEditor() {
    const editor = $('#editorContent');
    if (editor && !editor._bound) {
        editor._bound = true;
        attachZWSPCleanup(editor);
        const saveDraft = () => {
            try {
                store.set('nova.draft.content', editor.innerHTML);
                const t = $('#editorTitle');
                if (t) store.set('nova.draft.title', t.value);
                store.set('nova.draft.ts', Date.now());
            } catch (e) {}
        };
        editor.addEventListener('input', () => {
            clearTimeout(editor._draftTimer);
            editor._draftTimer = setTimeout(saveDraft, 800);
        });
        const et = $('#editorTitle');
        if (et) et.addEventListener('input', saveDraft);
    }
    $$('.editor-toolbar button[data-cmd]').forEach(btn => {
        btn.addEventListener('mousedown', e => e.preventDefault());
        btn.addEventListener('click', e => {
            e.preventDefault();
            const cmd = btn.dataset.cmd;
            if (cmd === 'bold') Ed.bold();
            else if (cmd === 'italic') Ed.italic();
            else if (cmd === 'underline') Ed.underline();
            else if (cmd === 'insertUnorderedList') document.execCommand('insertUnorderedList', false, null);
            else if (cmd === 'insertOrderedList') document.execCommand('insertOrderedList', false, null);
            else if (cmd === 'formatBlock') document.execCommand('formatBlock', false, '<' + (btn.dataset.val || 'p') + '>');
            editor.focus();
        });
    });
    const tImg = $('#tbImg');
    if (tImg) tImg.addEventListener('click', () => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'image/*';
        inp.onchange = async () => {
            try {
                const b64 = await fileToBase64(inp.files[0]);
                document.execCommand('insertImage', false, b64);
            } catch (err) { toast(err); }
        };
        inp.click();
    });
    const tCode = $('#tbCode');
    if (tCode) { tCode.addEventListener('mousedown', e => e.preventDefault()); tCode.addEventListener('click', e => { e.preventDefault(); Ed.code(); editor.focus(); }); }
    const tSpoiler = $('#tbSpoiler');
    if (tSpoiler) { tSpoiler.addEventListener('mousedown', e => e.preventDefault()); tSpoiler.addEventListener('click', e => { e.preventDefault(); Ed.spoiler(); editor.focus(); }); }
    const tRainbow = $('#tbRainbow');
    if (tRainbow) { tRainbow.addEventListener('mousedown', e => e.preventDefault()); tRainbow.addEventListener('click', e => { e.preventDefault(); Ed.rainbow(); editor.focus(); }); }
    const tColor = $('#tbColor');
    if (tColor) {
        tColor.addEventListener('mousedown', e => e.preventDefault());
        tColor.addEventListener('click', e => {
            e.preventDefault();
            const p = $('#editorColorPicker');
            if (p) p.hidden = !p.hidden;
        });
    }
    const cc = $('#editorColorCustom');
    if (cc) { cc.addEventListener('mousedown', e => e.preventDefault()); cc.addEventListener('input', () => Ed.color(cc.value)); }
    $$('#editorColorPicker .color-dot').forEach(d => {
        d.addEventListener('mousedown', e => e.preventDefault());
        d.addEventListener('click', e => {
            e.preventDefault();
            Ed.color(d.dataset.color);
            const p = $('#editorColorPicker');
            if (p) p.hidden = true;
            editor.focus();
        });
    });
    const tCallout = $('#tbCallout');
    if (tCallout) {
        tCallout.addEventListener('mousedown', e => e.preventDefault());
        tCallout.addEventListener('click', e => {
            e.preventDefault();
            const t = prompt('متن کادر مهم:');
            if (t) {
                const div = document.createElement('div');
                div.className = 'callout';
                div.textContent = t;
                const sel = window.getSelection();
                if (sel && sel.rangeCount) {
                    sel.getRangeAt(0).insertNode(div);
                    const br = document.createElement('br');
                    div.parentNode.insertBefore(br, div.nextSibling);
                }
            }
        });
    }
    const saveDraft = $('#editorDraftBtn');
    if (saveDraft) saveDraft.addEventListener('click', () => savePost(true));
    const publish = $('#editorPublishBtn');
    if (publish) publish.addEventListener('click', () => savePost(false));
    const closeBtn = $('#editorCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeEditor);
    const uploadCover = $('#editorUploadCover');
    if (uploadCover) uploadCover.addEventListener('click', () => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'image/*';
        inp.onchange = async () => {
            try {
                const b64 = await fileToBase64(inp.files[0]);
                $('#editorCover').value = b64;
                toast('آپلود شد');
            } catch (err) { toast(err); }
        };
        inp.click();
    });
}

/* ══════════════════════════════════════════════════════════════
   ۲۶. Crop
   ══════════════════════════════════════════════════════════════ */
function openCrop(file, mode, targetId) {
    const reader = new FileReader();
    reader.onload = () => {
        const img = new Image();
        img.onload = () => {
            S.cropMode = mode; S.cropTarget = targetId; S.cropImg = img;
            S.cropZoom = 1; S.cropRotate = 0;
            const z = $('#cropZoom'); const r = $('#cropRotate');
            if (z) z.value = 100;
            if (r) r.value = 0;
            const frame = $('#cropFrame');
            const area = $('.crop-area');
            if (frame && area) {
                if (mode.indexOf('cover') > -1) {
                    area.style.aspectRatio = '3 / 1';
                    frame.style.top = '25%'; frame.style.left = '5%';
                    frame.style.width = '90%'; frame.style.height = '50%';
                    frame.style.borderRadius = '8px';
                } else {
                    area.style.aspectRatio = '1';
                    frame.style.top = '10%'; frame.style.left = '10%';
                    frame.style.width = '80%'; frame.style.height = '80%';
                    frame.style.borderRadius = '50%';
                }
            }
            drawCropCanvas();
            openModal('cropOverlay');
        };
        img.src = reader.result;
    };
    reader.readAsDataURL(file);
}

function drawCropCanvas() {
    const canvas = $('#cropCanvas');
    if (!canvas || !S.cropImg) return;
    const ctx = canvas.getContext('2d');
    const isCover = S.cropMode.indexOf('cover') > -1;
    const w = isCover ? 600 : 300;
    const h = isCover ? 200 : 300;
    canvas.width = w; canvas.height = h;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(S.cropRotate * Math.PI / 180);
    ctx.scale(S.cropZoom, S.cropZoom);
    const scale = Math.min(w / S.cropImg.width, h / S.cropImg.height);
    const dw = S.cropImg.width * scale;
    const dh = S.cropImg.height * scale;
    ctx.drawImage(S.cropImg, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
}

function applyCrop() {
    const canvas = $('#cropCanvas');
    if (!canvas) return;
    const isCover = S.cropMode.indexOf('cover') > -1;
    const out = document.createElement('canvas');
    if (isCover) {
        out.width = 1200; out.height = 400;
        const ctx = out.getContext('2d');
        const srcAspect = canvas.width / canvas.height;
        const dstAspect = 3;
        let sx = 0, sy = 0, sw = canvas.width, sh = canvas.height;
        if (srcAspect > dstAspect) { sw = canvas.height * dstAspect; sx = (canvas.width - sw) / 2; }
        else { sh = canvas.width / dstAspect; sy = (canvas.height - sh) / 2; }
        ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, 1200, 400);
    } else {
        out.width = 500; out.height = 500;
        const ctx = out.getContext('2d');
        ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, 500, 500);
    }
    const b64 = out.toDataURL('image/jpeg', 0.85);
    if (S.cropMode === 'avatar-user' || S.cropMode === 'cover-user') {
        const users = DB.getUsers();
        const me = users.find(u => u.id === S.cropTarget);
        if (me) {
            if (S.cropMode === 'avatar-user') me.avatar = b64;
            else me.cover = b64;
            DB.setUsers(users);
            S.user = me;
            updateAuthUI();
            const prevScroll = ($('#userPanelBody') || {}).scrollTop || 0;
            renderUserPanelBody('profile');
            const body = $('#userPanelBody');
            if (body) body.scrollTop = prevScroll;
        }
    } else if (S.cropMode === 'avatar-group' || S.cropMode === 'cover-group') {
        const groups = DB.getGroups();
        const g = groups.find(x => x.id === S.cropTarget);
        if (g) {
            if (S.cropMode === 'avatar-group') g.avatar = b64;
            else g.cover = b64;
            DB.setGroups(groups);
        }
        closeModal('cropOverlay');
        renderGroupPage(S.cropTarget);
    }
    closeModal('cropOverlay');
    toast('ذخیره شد');
}

/* ══════════════════════════════════════════════════════════════
   ۲۷. Search + Secret Codes
   ══════════════════════════════════════════════════════════════ */
const SECRET_CODES = {
    '@adminkol': { role: 'admin', label: 'مدیر کل' },
    '@karimikoskhole': { role: 'editor', label: 'سردبیر' },
    '@khodetobokosh': { role: 'author', label: 'نویسنده' }
};

function trySecretCode(value) {
    const code = value.trim().toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(SECRET_CODES, code)) return false;
    if (!S.user) { toast('اول وارد شو'); return true; }
    const def = SECRET_CODES[code];
    const users = DB.getUsers();
    const me = users.find(u => u.id === S.user.id);
    if (!me) return true;
    me.role = def.role;
    me.verified = true;
    DB.setUsers(users);
    S.user = me;
    updateAuthUI();
    toast('حالا ' + def.label + ' هستی');
    closeModal('searchOverlay');
    return true;
}

function initSearch() {
    const input = $('#searchInput');
    const results = $('#searchResults');
    if (!input || !results) return;
    let searchTimer;
    input.addEventListener('input', e => {
        const raw = e.target.value;
        if (Object.prototype.hasOwnProperty.call(SECRET_CODES, raw.trim().toLowerCase())) {
            if (trySecretCode(raw)) { input.value = ''; return; }
        }
        clearTimeout(searchTimer);
        const q = raw.trim().toLowerCase();
        if (q.length < 2) { results.innerHTML = '<p class="search-hint">شروع به تایپ کن</p>'; return; }
        searchTimer = setTimeout(() => doSearch(q), 150);
    });
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const raw = input.value;
            if (trySecretCode(raw)) { input.value = ''; return; }
            doSearch(input.value.trim().toLowerCase());
        }
    });
    function doSearch(q) {
        const posts = DB.getPosts().filter(p => p.status === 'published' &&
            ((p.title || '').toLowerCase().indexOf(q) > -1 || stripHtml(p.content).toLowerCase().indexOf(q) > -1)).slice(0, 5);
        const users = DB.getUsers().filter(u =>
            u.username.indexOf(q) > -1 || (u.displayName || '').toLowerCase().indexOf(q) > -1).slice(0, 5);
        const groups = DB.getGroups().filter(g => g.type === 'public' &&
            (g.name || '').toLowerCase().indexOf(q) > -1).slice(0, 3);
        let html = '';
        if (posts.length) {
            html += '<div class="search-result-section">پست‌ها</div>';
            posts.forEach(p => {
                html += '<div class="search-result-item" data-open-post="' + escAttr(p.id) + '">' +
                    '<div class="search-result-icon">پ</div>' +
                    '<div class="search-result-info"><strong>' + esc(p.title) + '</strong>' +
                    '<small>' + faNum(p.views || 0) + ' بازدید</small></div></div>';
            });
        }
        if (users.length) {
            html += '<div class="search-result-section">کاربران</div>';
            users.forEach(u => {
                html += '<div class="search-result-item" data-open-user="' + escAttr(u.id) + '">' +
                    '<div class="search-result-icon">' + (u.avatar ? '<img src="' + escAttr(u.avatar) + '" alt="">' : esc(u.displayName[0])) + '</div>' +
                    '<div class="search-result-info"><strong>' + esc(u.displayName) + '</strong>' +
                    '<small>@' + esc(u.username) + '</small></div></div>';
            });
        }
        if (groups.length) {
            html += '<div class="search-result-section">گروه‌ها</div>';
            groups.forEach(g => {
                html += '<div class="search-result-item" data-open-group="' + escAttr(g.id) + '">' +
                    '<div class="search-result-icon">' + (g.avatar ? '<img src="' + escAttr(g.avatar) + '" alt="">' : esc((g.name[0] || 'G').toUpperCase())) + '</div>' +
                    '<div class="search-result-info"><strong>' + esc(g.name) + '</strong>' +
                    '<small>' + faNum((g.members || []).length) + ' عضو</small></div></div>';
            });
        }
        if (!html) html = '<p class="search-hint">نتیجه‌ای پیدا نشد</p>';
        results.innerHTML = html;
        results.querySelectorAll('[data-open-post]').forEach(el => el.addEventListener('click', () => { closeModal('searchOverlay'); showPage('post', el.dataset.openPost); }));
        results.querySelectorAll('[data-open-user]').forEach(el => el.addEventListener('click', () => { closeModal('searchOverlay'); showPage('profile', el.dataset.openUser); }));
        results.querySelectorAll('[data-open-group]').forEach(el => el.addEventListener('click', () => { closeModal('searchOverlay'); showPage('group', el.dataset.openGroup); }));
    }
}

/* ══════════════════════════════════════════════════════════════
   ۲۸. Lightbox + Context Menu
   ══════════════════════════════════════════════════════════════ */
let _longPressTimer = null;
let _currentCtxMenu = null;

function openLightbox(src) {
    const lb = $('#lightbox');
    const content = $('#lightboxContent');
    if (!lb || !content) return;
    if (/\.(mp4|webm|ogg)$/i.test(src) || src.startsWith('blob:') && src.includes('video')) {
        content.innerHTML = '<video src="' + escAttr(src) + '" controls autoplay></video>';
    } else content.innerHTML = '<img src="' + escAttr(src) + '" alt="">';
    lb.hidden = false;
    requestAnimationFrame(() => lb.classList.add('on'));
    document.body.classList.add('locked');
}
function closeLightbox() {
    const lb = $('#lightbox');
    if (!lb) return;
    lb.classList.remove('on');
    setTimeout(() => {
        lb.hidden = true;
        const content = $('#lightboxContent');
        if (content) content.innerHTML = '';
        if (!document.querySelector('.modal-overlay.on') &&
            !document.querySelector('.side-modal:not([hidden])') &&
            !document.querySelector('.user-panel.on')) {
            document.body.classList.remove('locked');
        }
    }, 300);
}
function closeContextMenu() {
    if (_currentCtxMenu) { _currentCtxMenu.remove(); _currentCtxMenu = null; }
}
function openImageContextMenu(x, y, src) {
    closeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.innerHTML =
        '<button type="button" data-act="report">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>گزارش تصویر</button>' +
        '<button type="button" data-act="download">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>دانلود تصویر</button>' +
        '<button type="button" data-act="copy">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>کپی لینک تصویر</button>';
    const mw = 220, mh = 160;
    const vw = window.innerWidth, vh = window.innerHeight;
    const left = Math.min(x, vw - mw - 8);
    const top = Math.min(y, vh - mh - 8);
    menu.style.left = Math.max(8, left) + 'px';
    menu.style.top = Math.max(8, top) + 'px';
    document.body.appendChild(menu);
    _currentCtxMenu = menu;
    menu.addEventListener('click', e => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const act = btn.dataset.act;
        if (act === 'report') { toast('گزارش ارسال شد'); addActivity('report', (S.user ? S.user.displayName : 'کاربر') + ' یه تصویر رو گزارش کرد', S.user ? S.user.id : null); }
        else if (act === 'download') { const a = document.createElement('a'); a.href = src; a.download = 'nova-image-' + Date.now() + '.jpg'; a.click(); toast('دانلود شد'); }
        else if (act === 'copy') {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(src).then(() => toast('لینک کپی شد'), () => toast('کپی نشد'));
            } else toast('کپی نشد');
        }
        closeContextMenu();
    });
    setTimeout(() => {
        document.addEventListener('click', function onOut(ev) {
            if (!menu.contains(ev.target)) { closeContextMenu(); document.removeEventListener('click', onOut); }
        });
    }, 100);
}
function attachImageInteractions(img) {
    if (!img || img._interactions) return;
    img._interactions = true;
    img.addEventListener('click', e => { if (e.detail === 1) openLightbox(img.src); });
    img.addEventListener('touchstart', e => {
        _longPressTimer = setTimeout(() => {
            const t = e.touches[0];
            openImageContextMenu(t.clientX, t.clientY, img.src);
        }, 500);
    }, { passive: true });
    img.addEventListener('touchend', () => clearTimeout(_longPressTimer));
    img.addEventListener('touchmove', () => clearTimeout(_longPressTimer));
    img.addEventListener('contextmenu', e => { e.preventDefault(); openImageContextMenu(e.clientX, e.clientY, img.src); });
}

/* ══════════════════════════════════════════════════════════════
   ۲۹. Scroll UI
   ══════════════════════════════════════════════════════════════ */
function initScrollUI() {
    const bar = $('#scrollProgress');
    const nav = $('#navShell');
    const toTop = $('#toTop');
    let raf = null;
    window.addEventListener('scroll', () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
            const y = scrollY;
            const total = document.documentElement.scrollHeight - innerHeight;
            if (bar) bar.style.width = (total > 0 ? (y / total) * 100 : 0) + '%';
            if (nav) nav.classList.toggle('scrolled', y > 40);
            if (toTop) toTop.classList.toggle('show', y > 500);
            raf = null;
        });
    }, { passive: true });
    if (toTop) toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

/* ══════════════════════════════════════════════════════════════
   ۳۰. Pending Auto-approve
   ══════════════════════════════════════════════════════════════ */
function checkPendingAutoApprove() {
    const pend = DB.getPending();
    if (!pend.length) return;
    const now = Date.now();
    const HOUR = 3600000;
    const posts = DB.getPosts();
    let changed = false;
    for (let i = pend.length - 1; i >= 0; i--) {
        if (now - pend[i].addedAt >= HOUR) {
            const post = posts.find(p => p.id === pend[i].postId);
            if (post) {
                post.comments = post.comments || [];
                pend[i].comment.status = 'approved';
                post.comments.push(pend[i].comment);
            }
            pend.splice(i, 1);
            changed = true;
        }
    }
    if (changed) { DB.setPosts(posts); DB.setPending(pend); }
}

/* ══════════════════════════════════════════════════════════════
   ۳۱. Event Bindings
   ══════════════════════════════════════════════════════════════ */
function bindAllEvents() {
    const menuBtn = $('#menuBtn');
    if (menuBtn) menuBtn.addEventListener('click', openDrawer);
    const drawerClose = $('#drawerClose');
    if (drawerClose) drawerClose.addEventListener('click', closeDrawer);
    const drawerBackdrop = $('#drawerBackdrop');
    if (drawerBackdrop) drawerBackdrop.addEventListener('click', closeDrawer);
    
    document.querySelectorAll('[data-nav]').forEach(el => {
        el.addEventListener('click', e => {
            e.preventDefault();
            const page = el.dataset.nav;
            closeDrawer();
            closeUserPanel();
            showPage(page);
        });
    });
    const brandHome = $('#brandHome');
    if (brandHome) brandHome.addEventListener('click', e => { e.preventDefault(); closeDrawer(); closeUserPanel(); showPage('home'); });
    const themeBtn = $('#themeBtn');
    if (themeBtn) themeBtn.addEventListener('click', flipTheme);
    const loginBtn = $('#loginBtn');
    if (loginBtn) loginBtn.addEventListener('click', () => openModal('authOverlay'));
    const drawerLoginBtn = $('#drawerLoginBtn');
    if (drawerLoginBtn) drawerLoginBtn.addEventListener('click', () => { closeDrawer(); openModal('authOverlay'); });
    const userBtn = $('#userBtn');
    if (userBtn) userBtn.addEventListener('click', () => openUserPanel());
    const drawerNewPost = $('#drawerNewPost');
    if (drawerNewPost) drawerNewPost.addEventListener('click', () => { closeDrawer(); openEditor(); });
    const heroNewPost = $('#heroNewPost');
    if (heroNewPost) heroNewPost.addEventListener('click', () => openEditor());
    const drawerAdminBtn = $('#drawerAdminBtn');
    if (drawerAdminBtn) drawerAdminBtn.addEventListener('click', () => { closeDrawer(); openAdminPanel(); });
    const drawerEditorBtn = $('#drawerEditorBtn');
    if (drawerEditorBtn) drawerEditorBtn.addEventListener('click', () => { closeDrawer(); openEditorPanel(); });
    const drawerAuthorBtn = $('#drawerAuthorBtn');
    if (drawerAuthorBtn) drawerAuthorBtn.addEventListener('click', () => { closeDrawer(); openAuthorPanel(); });
    const searchBtn = $('#searchBtn');
    if (searchBtn) searchBtn.addEventListener('click', () => {
        openModal('searchOverlay');
        setTimeout(() => { const si = $('#searchInput'); if (si) si.focus(); }, 250);
    });
    const bcClose = $('#broadcastClose');
    if (bcClose) bcClose.addEventListener('click', dismissBroadcast);
    const createGroupBtn = $('#createGroupBtn');
    if (createGroupBtn) createGroupBtn.addEventListener('click', () => {
        if (!S.user || S.user.role !== 'admin') { toast('فقط مدیر'); return; }
        openModal('newGroupOverlay');
    });
    const newGroupForm = $('#newGroupForm');
    if (newGroupForm) newGroupForm.addEventListener('submit', e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const name = String(fd.get('name') || '').trim();
        const description = String(fd.get('description') || '').trim();
        const type = fd.get('type') || 'public';
        if (!name) return;
        const groups = DB.getGroups();
        const g = {
            id: uid('g_'), name, description, type,
            ownerId: S.user.id,
            members: [S.user.id], admins: [], mods: [], banned: [],
            joinRequests: [], messages: [],
            avatar: null, cover: null, createdAt: Date.now()
        };
        groups.push(g);
        DB.setGroups(groups);
        const users = DB.getUsers();
        const me = users.find(u => u.id === S.user.id);
        me.groups = me.groups || [];
        me.groups.push(g.id);
        DB.setUsers(users);
        S.user = me;
        addActivity('group', S.user.displayName + ' گروه «' + name + '» رو ساخت', S.user.id);
        toast('گروه ساخته شد');
        closeModal('newGroupOverlay');
        e.target.reset();
        showPage('group', g.id);
    });
    const loadMoreBtn = $('#loadMorePostsBtn');
    if (loadMoreBtn) loadMoreBtn.addEventListener('click', loadMorePosts);
    document.querySelectorAll('#postFilters .filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('#postFilters .filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            S.postFilter = chip.dataset.filter;
            S.postsVisible = 5;
            renderPosts();
        });
    });
    document.querySelectorAll('#timeFilter .time-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('#timeFilter .time-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            S.timeFilter = chip.dataset.time;
            renderTrending();
        });
    });
    document.querySelectorAll('.group-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.group-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            S.groupFilter = tab.dataset.groupsTab;
            renderGroupsPage();
        });
    });
    document.querySelectorAll('.up-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.up-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            renderUserPanelBody(tab.dataset.tab);
        });
    });
    document.querySelectorAll('.sm-tab[data-admin-tab]').forEach(tab => {
        tab.addEventListener('click', () => renderAdminTab(tab.dataset.adminTab));
    });
    document.querySelectorAll('.sm-tab[data-editor-tab]').forEach(tab => {
        tab.addEventListener('click', () => renderEditorTab(tab.dataset.editorTab));
    });
    document.querySelectorAll('.sm-tab[data-author-tab]').forEach(tab => {
        tab.addEventListener('click', () => renderAuthorTab(tab.dataset.authorTab));
    });
    const userPanelClose = $('#userPanelClose');
    if (userPanelClose) userPanelClose.addEventListener('click', closeUserPanel);
    const lbClose = $('#lightboxClose');
    if (lbClose) lbClose.addEventListener('click', e => { e.stopPropagation(); closeLightbox(); });
    const lb = $('#lightbox');
    if (lb) lb.addEventListener('click', e => {
        if (e.target.id === 'lightbox' || e.target.id === 'lightboxClose') closeLightbox();
    });
    
    // Delegation سراسری
    document.addEventListener('click', e => {
        const closeBtn = e.target.closest('[data-close]');
        if (closeBtn) {
            const t = closeBtn.dataset.close;
            const map = { auth: 'authOverlay', newGroup: 'newGroupOverlay', groupSettings: 'groupSettingsOverlay', search: 'searchOverlay', crop: 'cropOverlay' };
            if (map[t]) closeModal(map[t]);
            else if (t === 'admin') { const p = $('#adminPanel'); if (p) p.hidden = true; }
            else if (t === 'editor-panel') { const p = $('#editorPanel'); if (p) p.hidden = true; }
            else if (t === 'author-panel') { const p = $('#authorPanel'); if (p) p.hidden = true; }
            return;
        }
        const actLike = e.target.closest('[data-act-like]');
        if (actLike) { toggleActivityLike(actLike.dataset.actLike); return; }
        const actComment = e.target.closest('[data-act-comment]');
        if (actComment) { addActivityComment(actComment.dataset.actComment); return; }
        const replyAct = e.target.closest('[data-reply-activity]');
        if (replyAct) { replyToActivityComment(replyAct.dataset.replyActivity); return; }
        const tickBlue = e.target.closest('[data-tick-blue]');
        if (tickBlue) { const users = DB.getUsers(); const u = users.find(x => x.id === tickBlue.dataset.tickBlue); if (u) { u.tick = 'blue'; DB.setUsers(users); toast('تیک آبی'); renderAdminTab(S.adminTab); } }
        const tickGold = e.target.closest('[data-tick-gold]');
        if (tickGold) { const users = DB.getUsers(); const u = users.find(x => x.id === tickGold.dataset.tickGold); if (u) { u.tick = 'gold'; DB.setUsers(users); toast('تیک طلایی'); renderAdminTab(S.adminTab); } }
        const tickNone = e.target.closest('[data-tick-none]');
        if (tickNone) { const users = DB.getUsers(); const u = users.find(x => x.id === tickNone.dataset.tickNone); if (u) { u.tick = null; DB.setUsers(users); toast('تیک حذف'); renderAdminTab(S.adminTab); } }
        const delUser = e.target.closest('[data-delete-user]');
        if (delUser) { if (!confirm('کاربر حذف بشه؟')) return; DB.setUsers(DB.getUsers().filter(x => x.id !== delUser.dataset.deleteUser)); toast('حذف شد'); renderAdminTab(S.adminTab); }
        const editPost = e.target.closest('[data-edit-post]');
        if (editPost) {
            const p = $('#adminPanel'); if (p) p.hidden = true;
            const ep = $('#editorPanel'); if (ep) ep.hidden = true;
            const ap = $('#authorPanel'); if (ap) ap.hidden = true;
            openEditor(editPost.dataset.editPost);
        }
        const delPost = e.target.closest('[data-delete-post]');
        if (delPost) { if (!confirm('پست حذف بشه؟')) return; DB.setPosts(DB.getPosts().filter(p => p.id !== delPost.dataset.deletePost)); toast('حذف شد'); renderAdminTab(S.adminTab); }
        const featurePost = e.target.closest('[data-feature-post]');
        if (featurePost) { const posts = DB.getPosts(); const p = posts.find(x => x.id === featurePost.dataset.featurePost); if (p) { p.editorChoice = !p.editorChoice; DB.setPosts(posts); toast('تغییر کرد'); renderEditorTab('featured'); } }
        const approveC = e.target.closest('[data-approve-comment]');
        if (approveC) {
            const pending = DB.getPending();
            const item = pending.find(x => x.comment.id === approveC.dataset.approveComment);
            if (item) {
                const posts = DB.getPosts();
                const post = posts.find(p => p.id === item.postId);
                if (post) { post.comments = post.comments || []; item.comment.status = 'approved'; post.comments.push(item.comment); DB.setPosts(posts); }
                DB.setPending(pending.filter(x => x.comment.id !== item.comment.id));
                toast('تأیید شد');
                renderAdminTab(S.adminTab);
            }
        }
        const rejectC = e.target.closest('[data-reject-comment]');
        if (rejectC) { DB.setPending(DB.getPending().filter(x => x.comment.id !== rejectC.dataset.rejectComment)); toast('رد شد'); renderAdminTab(S.adminTab); }
        const delGroup = e.target.closest('[data-delete-group]');
        if (delGroup) { if (!confirm('گروه حذف بشه؟')) return; DB.setGroups(DB.getGroups().filter(g => g.id !== delGroup.dataset.deleteGroup)); toast('گروه حذف شد'); renderAdminTab(S.adminTab); }
        const viewGroup = e.target.closest('[data-view-group]');
        if (viewGroup) { const p = $('#adminPanel'); if (p) p.hidden = true; showPage('group', viewGroup.dataset.viewGroup); }
        if (e.target.id === 'exportDataBtn') {
            const data = {
                users: DB.getUsers(), posts: DB.getPosts(), groups: DB.getGroups(),
                pm: DB.getPM(), notifs: DB.getNotifs(),
                activity: DB.getActivity(), blocks: DB.getBlocks(), pending: DB.getPending(),
                actLikes: DB.getActivityLikes(), actComments: DB.getActivityComments(),
                broadcast: DB.getBroadcast(), seedState: DB.getSeedState(),
                exportedAt: Date.now()
            };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'nova-backup-' + Date.now() + '.json';
            a.click(); URL.revokeObjectURL(url);
            toast('دانلود شد');
        }
        if (e.target.id === 'importDataBtn') {
            const inp = $('#importDataInput'); if (inp) inp.click();
        }
    });
    
    document.addEventListener('change', e => {
        const roleSel = e.target.closest('select[data-role]');
        if (roleSel) {
            const users = DB.getUsers();
            const u = users.find(x => x.id === roleSel.dataset.role);
            if (u) { u.role = roleSel.value; DB.setUsers(users); toast('نقش تغییر کرد'); }
        }
        const importInput = e.target.closest('#importDataInput');
        if (importInput && importInput.files && importInput.files[0]) {
            const f = importInput.files[0];
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const data = JSON.parse(reader.result);
                    if (data.users) DB.setUsers(data.users);
                    if (data.posts) DB.setPosts(data.posts);
                    if (data.groups) DB.setGroups(data.groups);
                    if (data.pm) DB.setPM(data.pm);
                    if (data.notifs) DB.setNotifs(data.notifs);
                    if (data.activity) DB.setActivity(data.activity);
                    if (data.blocks) DB.setBlocks(data.blocks);
                    if (data.pending) DB.setPending(data.pending);
                    if (data.actLikes) DB.setActivityLikes(data.actLikes);
                    if (data.actComments) DB.setActivityComments(data.actComments);
                    if (data.broadcast !== undefined) DB.setBroadcast(data.broadcast);
                    if (data.seedState) DB.setSeedState(data.seedState);
                    toast('بازیابی شد');
                    renderAdminTab(S.adminTab);
                    renderHome();
                    renderBroadcast();
                } catch (err) { toast('فایل نامعتبر'); }
            };
            reader.readAsText(f);
        }
    });
    
    const cropZoom = $('#cropZoom');
    if (cropZoom) cropZoom.addEventListener('input', e => { S.cropZoom = +e.target.value / 100; drawCropCanvas(); });
    const cropRotate = $('#cropRotate');
    if (cropRotate) cropRotate.addEventListener('input', e => { S.cropRotate = +e.target.value; drawCropCanvas(); });
    const cropCancel = $('#cropCancel');
    if (cropCancel) cropCancel.addEventListener('click', () => closeModal('cropOverlay'));
    const cropApply = $('#cropApply');
    if (cropApply) cropApply.addEventListener('click', applyCrop);
    
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeAllModals();
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openModal('searchOverlay'); }
    });
    
    // visibility change — throttle SeedEngine
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) SeedEngine.stop();
        else if (S.page === 'group' && S.pageData === 'g_seed_free') SeedEngine.startGroup('g_seed_free');
    });
}

/* ══════════════════════════════════════════════════════════════
   ۳۲. Boot
   ══════════════════════════════════════════════════════════════ */
function boot() {
    try { console.log('%c🎮 نووا گیم v8.0', 'color:#5B6FA8;font-size:14px;font-weight:bold'); } catch (e) {}
    seedUsers();
    seedFreeGroup();
    SeedEngine.loadState();
    applyTheme(S.theme);
    document.documentElement.dataset.perf = detectPerf();
    S.user = getCurrentUser();
    updateAuthUI();
    initScrollUI();
    initAuth();
    initSearch();
    initEditor();
    initReplyModal();
    bindAllEvents();
    renderHome();
    renderBroadcast();
    checkPendingAutoApprove();
    setInterval(checkPendingAutoApprove, 60000);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
                                          }
