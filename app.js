// app.js — Firebase Auth + Firestore integration WITHOUT changing your design

// ===== Helpers =====
const $ = id => document.getElementById(id);
const escapeHtml = s => (s||'').toString().replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const parseTags = s => (s||'').split(',').map(t=>t.trim()).filter(Boolean).slice(0,8);

// ===== DOM refs (must match your HTML) =====
const btnSignin = $('btnSignin');
const btnSignout = $('btnSignout');
const btnExport = $('btnExport');
const userEmail = $('userEmail');

const form = $('newTaskForm');
const taskText = $('taskText');
const priority = $('priority');
const due = $('due');
const tags = $('tags');

const listEl = $('list');
const emptyEl = $('empty');
const statsEl = $('stats');

const btnCompleteAll = $('btnCompleteAll');
const btnClearCompleted = $('btnClearCompleted');
const search = $('search');
const tagFilter = $('tagFilter');
const segButtons = Array.from(document.querySelectorAll('.seg-btn'));

const YEAR = $('year'); if (YEAR) YEAR.textContent = new Date().getFullYear();

// ===== Firebase handles (initialized in index.html) =====
const auth = firebase.auth();
const db = firebase.firestore();

// ===== Local fallback (when signed out) =====
const LOCAL_KEY = 'cirrusTasks_local';
let items = [];
let unsub = null;
let uid = null;
let currentFilter = 'all';

const saveLocal = () => localStorage.setItem(LOCAL_KEY, JSON.stringify(items));
const loadLocal = () => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch { return []; } };

// ===== Auth UI =====
btnSignin?.addEventListener('click', async () => {
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await auth.signInWithPopup(provider);
  } catch (e) {
    console.error('Sign-in error', e);
    alert(e.message);
  }
});
btnSignout?.addEventListener('click', () => auth.signOut());

// ===== Auth state =====
auth.onAuthStateChanged(user => {
  uid = user?.uid || null;
  if (userEmail) userEmail.textContent = user?.email || '';

  if (btnSignin) btnSignin.style.display = uid ? 'none' : 'inline-block';
  if (btnSignout) btnSignout.style.display = uid ? 'inline-block' : 'none';

  if (unsub) { unsub(); unsub = null; }

  if (uid) {
    unsub = db.collection('todos')
      .where('userId','==', uid)
      .orderBy('createdAt','desc')
      .onSnapshot(
        snap => { items = snap.docs.map(d => ({ id:d.id, ...d.data() })); render(); },
        err => { console.error(err); alert(err.message); }
      );
  } else {
    items = loadLocal();
    render();
  }
});

// ===== Create task =====
form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = (taskText?.value || '').trim();
  if (!title) return;

  const doc = {
    title,
    done: false,
    priority: priority?.value || 'normal',
    due: due?.value || null,
    tags: parseTags(tags?.value || ''),
    userId: uid || '_local',
    createdAt: uid ? firebase.firestore.FieldValue.serverTimestamp() : Date.now(),
    updatedAt: uid ? firebase.firestore.FieldValue.serverTimestamp() : Date.now()
  };

  if (uid) {
    await db.collection('todos').add(doc);
  } else {
    doc.id = crypto.randomUUID();
    items.unshift(doc);
    saveLocal();
    render();
  }
  form.reset();
});

// ===== Actions =====
async function toggleDone(id, val){
  if (uid) {
    await db.collection('todos').doc(id).update({
      done: val, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } else {
    const i = items.findIndex(x=>x.id===id);
    if (i>-1){ items[i].done = val; saveLocal(); render(); }
  }
}
async function removeTask(id){
  if (!confirm('Delete this task?')) return;
  if (uid) {
    await db.collection('todos').doc(id).delete();
  } else {
    items = items.filter(x=>x.id!==id); saveLocal(); render();
  }
}
async function editTask(id){
  const it = items.find(x=>x.id===id); if(!it) return;
  const newTitle = prompt('Edit task', it.title);
  if (newTitle === null) return;
  const payload = { title: newTitle.trim() || it.title, updatedAt: uid ? firebase.firestore.FieldValue.serverTimestamp() : Date.now() };
  if (uid) {
    await db.collection('todos').doc(id).update(payload);
  } else {
    it.title = payload.title; it.updatedAt = payload.updatedAt; saveLocal(); render();
  }
}

// batch
btnCompleteAll?.addEventListener('click', async ()=>{
  const ids = items.filter(i=>!i.done).map(i=>i.id);
  if (!ids.length) return;
  if (uid) {
    const batch = db.batch();
    ids.forEach(id => batch.update(db.collection('todos').doc(id), { done:true, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }));
    await batch.commit();
  } else {
    items.forEach(i=>i.done=true); saveLocal(); render();
  }
});
btnClearCompleted?.addEventListener('click', async ()=>{
  const done = items.filter(i=>i.done);
  if (!done.length) return;
  if (uid) {
    const batch = db.batch();
    done.forEach(i => batch.delete(db.collection('todos').doc(i.id)));
    await batch.commit();
  } else {
    items = items.filter(i=>!i.done); saveLocal(); render();
  }
});

// export
btnExport?.addEventListener('click', ()=>{
  const rows = [['title','done','priority','due','tags']];
  items.forEach(i => rows.push([i.title, i.done, i.priority, i.due || '', (i.tags||[]).join('|')]));
  const csv = rows.map(r => r.map(x => `"${String(x).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'tasks.csv'; a.click(); URL.revokeObjectURL(a.href);
});

// filters
segButtons.forEach(btn=>{
  btn.addEventListener('click', ()=>{
    segButtons.forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter || 'all';
    render();
  });
});
search?.addEventListener('input', render);
tagFilter?.addEventListener('change', render);

// ===== Render =====
function filtered(){
  const q = (search?.value || '').toLowerCase().trim();
  const tag = tagFilter?.value || '';
  return items.filter(i=>{
    const okFilter = currentFilter==='all' ? true : currentFilter==='active' ? !i.done : i.done;
    const okSearch = !q || (i.title||'').toLowerCase().includes(q);
    const okTag = !tag || (i.tags||[]).includes(tag);
    return okFilter && okSearch && okTag;
  });
}
function refreshTagFilter(){
  if (!tagFilter) return;
  const s = new Set(); items.forEach(i => (i.tags||[]).forEach(t => s.add(t)));
  tagFilter.innerHTML = '<option value="">All tags</option>' + Array.from(s).sort().map(t => `<option>${escapeHtml(t)}</option>`).join('');
}
function render(){
  const data = filtered();
  listEl.innerHTML = '';
  emptyEl.style.display = data.length ? 'none' : 'block';

  data.forEach(i=>{
    const card = document.createElement('div');
    card.className = 'card note';
    card.innerHTML = `
      <strong>${escapeHtml(i.title)}</strong>
      <div class="row" style="justify-content:space-between;margin-top:8px">
        <div>
          ${i.due ? `<span class="muted">Due: ${escapeHtml(i.due)}</span>` : ''}
          <div>${(i.tags||[]).map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join(' ')}</div>
        </div>
        <div class="row">
          <button class="btn done-btn">${i.done ? 'Undone' : 'Done'}</button>
          <button class="btn" data-edit>✏️</button>
          <button class="btn danger" data-del>🗑️</button>
        </div>
      </div>
    `;
    card.querySelector('.done-btn').addEventListener('click', ()=> toggleDone(i.id, !i.done));
    card.querySelector('[data-edit]') .addEventListener('click', ()=> editTask(i.id));
    card.querySelector('[data-del]')  .addEventListener('click', ()=> removeTask(i.id));
    listEl.appendChild(card);
  });

  const done = items.filter(i=>i.done).length;
  statsEl.textContent = `${done}/${items.length} done`;
  refreshTagFilter();
}
