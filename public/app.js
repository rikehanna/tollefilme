// Kino-Abend – Frontend (Vanilla JS, alle Daten kommen vom Server)

// >>> HIER deine Kontakt-Mail für den Datenschutz-Bereich eintragen <<<
const KONTAKT_EMAIL = 'rikeundhannaskleineseite@gmail.com';

const RATINGS = [['story', 'Storytelling'], ['acting', 'Schauspiel'], ['chem', 'Chemistry'],
  ['side', 'Side Story'], ['music', 'Musik'], ['trash', 'Trashigkeit']];
const TEXTS = [['rike', 'Rikes Gedanken'], ['hanna', 'Hannas Gedanken'],
  ['parents_dead', 'Wie viele Eltern sind tot? (vor Beginn des Films)'],
  ['stay_together', 'Bleiben sie danach zusammen?'], ['insider', 'Insider aus dem Film']];

// ---------- Helfer ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => String(n).replace('.', ',');           // 7.5 -> "7,5"
const fill = (v, i) => Math.max(0, Math.min(1, v - i)) * 100; // Füllgrad von Stern i (0-basiert)
const poster = (id, t) => id ? `<img src="/api/images/${id}" alt="${esc(t)}" loading="lazy">` : 'Kein Bild';
const TEST_REVIEW_ID = 1;

async function api(url, opts) {
  const r = await fetch(url, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Etwas ist schiefgelaufen.');
  return data;
}
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

// Vorschau für Bild-Uploads
function bindPreview(input) {
  const box = $('.drop-box', input.parentElement);
  input.addEventListener('change', () => {
    const f = input.files[0];
    box.innerHTML = f ? `<img src="${URL.createObjectURL(f)}" alt="Vorschau">` : box.dataset.empty;
  });
}
document.querySelectorAll('.drop input').forEach(bindPreview);

// Kontakt-Mail eintragen
$('#kontakt').href = 'mailto:' + KONTAKT_EMAIL; $('#kontakt').textContent = KONTAKT_EMAIL;

// ---------- Navigation ----------
function showTab(tab) {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('#tab-reviews').hidden = tab !== 'reviews';
  $('#tab-watchlist').hidden = tab !== 'watchlist';
  history.replaceState(null, '', tab === 'reviews' ? location.pathname : '#watchlist');
  (tab === 'reviews' ? loadReviews : loadWatchlist)();
}
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ---------- Modals ----------
document.querySelectorAll('dialog').forEach(d => {
  d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
});

// ---------- Sterne ----------
const starsHtml = v => `<span class="stars ro">${Array.from({ length: 10 }, (_, i) =>
  `<span class="star"><b class="shape" style="--fill:${fill(v, i)}%"></b></span>`).join('')}</span>`;

const starInputs = [];
function starInput(key) {
  const el = document.createElement('div');
  el.className = 'rating-input';
  el.innerHTML = `<div class="stars">${Array.from({ length: 10 }, (_, i) =>
    `<span class="star"><b class="shape"></b><i data-v="${i + .5}"></i><i data-v="${i + 1}"></i></span>`).join('')}</div>
    <output>0 / 10</output><input type="hidden" name="r_${key}" value="0">`;
  const hidden = $('input', el), out = $('output', el), shapes = el.querySelectorAll('.shape');
  el.set = v => {
    hidden.value = v; out.textContent = `${fmt(v)} / 10`;
    shapes.forEach((s, i) => s.style.setProperty('--fill', fill(v, i) + '%'));
  };
  el.addEventListener('click', e => {
    const hit = e.target.closest('i[data-v]'); if (!hit) return;
    const v = +hit.dataset.v;
    el.set(v === +hidden.value ? 0 : v); // gleichen Wert nochmal tippen = zurücksetzen
  });
  el.set(0); starInputs.push(el);
  return el;
}

// Formular aufbauen
$('#textFields').innerHTML = TEXTS.map(([k, l]) =>
  `<label for="f_${k}">${l}</label><textarea id="f_${k}" name="${k}" rows="2"></textarea>`).join('');
RATINGS.forEach(([k, l]) => {
  const row = document.createElement('div');
  row.className = 'rating-row';
  row.innerHTML = `<label>${l}</label>`;
  row.append(starInput(k));
  $('#ratingFields').append(row);
});

// Budget als Textfeld statt Sterne
const budgetRow = document.createElement('div');
budgetRow.className = 'rating-row';
budgetRow.innerHTML = `
  <label for="f_budget">Budget</label>
  <textarea id="f_budget" name="budget_rike" rows="3"
    placeholder="Was denkt ihr über das Budget des Films?"></textarea>
`;
$('#ratingFields').append(budgetRow);

$('#newReview').addEventListener('click', () => $('#formModal').showModal());

$('#reviewForm').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target, btn = $('#saveBtn'), err = $('#formErr');
  const fd = new FormData(form);
  if (!form.image.files[0]) fd.delete('image');
  err.textContent = ''; btn.disabled = true; btn.textContent = 'Speichere …';
  try {
    await api('/api/reviews', { method: 'POST', body: fd });
    form.reset(); starInputs.forEach(s => s.set(0));
    form.image.dispatchEvent(new Event('change')); // Vorschau zurücksetzen
    $('#formModal').close(); toast('Bewertung gespeichert'); loadReviews();
  } catch (ex) { err.textContent = ex.message; }
  btn.disabled = false; btn.textContent = 'Bewertung speichern';
});

// ---------- Bewertungen anzeigen ----------
async function loadReviews() {
  const grid = $('#reviewGrid');
  try {
    const list = await api('/api/reviews');
    grid.innerHTML = list.length ? list.map(r =>
      `<button class="card" data-id="${r.id}"><span class="poster">${poster(r.image_id, r.title)}</span>
       <span class="stub">${esc(r.title)}</span></button>`).join('')
      : `<div class="empty"><strong>Noch keine Bewertungen.</strong>Schaut euren ersten Film!</div>`;
  } catch (ex) { grid.innerHTML = `<div class="empty">${esc(ex.message)}</div>`; }
}
$('#reviewGrid').addEventListener('click', async e => {
  const card = e.target.closest('.card'); if (!card) return;
  try { openDetail(await api('/api/reviews/' + card.dataset.id)); } catch (ex) { toast(ex.message); }
});

function openDetail(m) {
  const block = (l, v) => `<section class="block"><h3>${l}</h3><p>${v ? esc(v) : '<span class="muted">—</span>'}</p></section>`;
  $('#detailBody').innerHTML = `
    <div class="detail-top">
      <div class="poster">${poster(m.image_id, m.title)}</div>
      <div><h2 id="detailTitle">${esc(m.title)}</h2>
        <p class="desc">${m.description ? esc(m.description) : '<span class="muted">Keine Beschreibung</span>'}</p></div>
    </div>
    ${TEXTS.map(([k, l]) => block(l, m[k])).join('')}
    <h3 class="sec">Overall Rating</h3>
    <ul class="scores">${RATINGS.map(([k, l]) => `<li><span>${l}</span>${starsHtml(m['r_' + k])}
      <strong>${fmt(m['r_' + k])} / 10</strong>
      ${k === 'budget' ? `<div class="note"><p><b>Rike:</b> ${esc(m.budget_rike) || '—'}</p><p><b>Hanna:</b> ${esc(m.budget_hanna) || '—'}</p></div>` : ''}
      </li>`).join('')}</ul>`;
  // Löschbutton nur bei der Test-Bewertung anzeigen
  if (Number(m.id) === TEST_REVIEW_ID) {
    const deleteBtn = document.createElement('button');

    deleteBtn.className = 'btn';
    deleteBtn.textContent = 'Test-Bewertung löschen';

    deleteBtn.addEventListener('click', async () => {
      if (!confirm('Möchtest du diese Test-Bewertung wirklich löschen?')) {
        return;
      }

      try {
        await api('/api/reviews/' + TEST_REVIEW_ID, {
          method: 'DELETE'
        });

        $('#detailModal').close();
        toast('Test-Bewertung gelöscht');
        loadReviews();
      } catch (ex) {
        toast(ex.message);
      }
    });

    $('#detailBody').append(deleteBtn);
  }
  $('#detailBody').scrollTop = 0;
  $('#detailModal').showModal();
}

// ---------- Watchlist ----------
async function loadWatchlist() {
  const grid = $('#watchGrid');
  try {
    const list = await api('/api/watchlist');
    grid.innerHTML = list.length ? list.map(w => `
      <figure class="card ${w.seen ? 'seen' : ''}"><div class="poster">${poster(w.image_id, w.title)}</div>
        <figcaption class="stub">${esc(w.title)}
          <button class="btn ghost small" data-id="${w.id}" data-seen="${w.seen ? 0 : 1}">${w.seen ? 'Doch nicht gesehen' : 'Gesehen'}</button>
        </figcaption></figure>`).join('')
      : `<div class="empty"><strong>Die Watchlist ist leer.</strong>Welchen Film wollt ihr als Nächstes schauen?</div>`;
  } catch (ex) { grid.innerHTML = `<div class="empty">${esc(ex.message)}</div>`; }
}
$('#watchGrid').addEventListener('click', async e => {
  const b = e.target.closest('button[data-id]'); if (!b) return;
  try {
    await api(`/api/watchlist/${b.dataset.id}/seen`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seen: b.dataset.seen === '1' }) });
    loadWatchlist();
  } catch (ex) { toast(ex.message); }
});
$('#watchForm').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target, err = $('#watchErr'), fd = new FormData(form);
  if (!form.image.files[0]) fd.delete('image');
  err.textContent = '';
  try {
    await api('/api/watchlist', { method: 'POST', body: fd });
    form.reset(); form.image.dispatchEvent(new Event('change'));
    toast('Zur Watchlist hinzugefügt'); loadWatchlist();
  } catch (ex) { err.textContent = ex.message; }
});

showTab(location.hash === '#watchlist' ? 'watchlist' : 'reviews');
