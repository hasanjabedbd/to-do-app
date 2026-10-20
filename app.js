/* ==========================================================================
   app.js — UI logic for Stash (vanilla JS, ES modules)

   Card shape (same in localStorage and Firestore):
   {
     id, type: "note" | "todo", title, text, items: [{ id, text, done }],
     color: "yellow" | "blue" | "green" | "pink" | "lavender" | "plain",
     tags: ["urgent" | "work" | "personal"], createdAt, updatedAt
   }
   ========================================================================== */

import { store as primaryStore, localStore } from "./firebase-config.js";
import { extractTasks } from "./ai.js";

/* ---------- Constants & helpers ---------- */
const TAGS = ["urgent", "work", "personal"];
const COLORS = ["yellow", "blue", "green", "pink", "lavender"];
const SAVE_DELAY = 400;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const uid = () =>
  crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const icon = (name, cls = "icon icon--sm") => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;

/* ---------- State ---------- */
let store = primaryStore;
const state = {
  cards: [],
  view: "notes",     // "notes" | "todo"
  tag: "all",
  query: "",
  editingId: null,
  newId: null,       // id of a just-created card (plays the entrance animation once)
};

const el = {
  main: $(".main"),
  grids: { note: $("#notes-grid"), todo: $("#todo-grid") },
  empty: { note: $("#notes-empty"), todo: $("#todo-empty") },
  views: { notes: $("#view-notes"), todo: $("#view-todo") },
  tabs: $$(".tab"),
  pills: $("#tag-filters"),
  search: $("#search-input"),
  searchClear: $("#search-clear"),
  fab: $("#fab"),
  themeToggle: $("#theme-toggle"),
  toast: $("#toast"),
};

const findCard = (id) => state.cards.find((c) => c.id === id);
// Pinned cards first, then newest first
const byOrder = (a, b) => (Number(!!b.pinned) - Number(!!a.pinned)) || (b.createdAt - a.createdAt);
const cardEl = (id) => el.main.querySelector(`.card[data-id="${id}"]`);

/* ==========================================================================
   Persistence (debounced per card)
   ========================================================================== */
const timers = new Map();

function queueSave(card) {
  clearTimeout(timers.get(card.id));
  timers.set(card.id, setTimeout(() => saveNow(card), SAVE_DELAY));
}

function saveNow(card) {
  clearTimeout(timers.get(card.id));
  timers.delete(card.id);
  card.updatedAt = Date.now();
  return Promise.resolve(store.save(card)).catch((err) => {
    console.error(err);
    toast("Couldn't save: " + (err.code || err.message), { duration: 12000 });
  });
}

function flushPending() {
  for (const id of [...timers.keys()]) {
    const card = findCard(id);
    if (card) saveNow(card);
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushPending();
});
window.addEventListener("pagehide", flushPending);

/* Remote changes (Firestore snapshot or first local load) */
function onRemote(cards) {
  if (timers.size) return; // don't clobber unsaved local edits
  state.cards = [...cards].sort(byOrder);
  if (document.activeElement?.closest?.(".card")) return; // don't steal focus mid-edit
  render();
}

/* ==========================================================================
   Rendering
   ========================================================================== */
function matches(card) {
  if (state.tag !== "all" && !card.tags.includes(state.tag)) return false;
  const q = state.query.trim().toLowerCase();
  if (!q) return true;
  const hay = [card.title, card.text, ...card.items.map((i) => i.text), ...card.tags]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

function taskHTML(item, editing) {
  const editable = editing || !item.text;
  return `
    <li class="task${item.done ? " is-done" : ""}" data-item="${item.id}">
      <label class="task__label">
        <input class="task__check" type="checkbox"${item.done ? " checked" : ""}>
        <span class="task__text" contenteditable="${editable}">${esc(item.text)}</span>
      </label>
    </li>`;
}

function cardHTML(c) {
  const editing = state.editingId === c.id;
  const isTodo = c.type === "todo";
  const done = c.items.filter((i) => i.done).length;

  const body = isTodo
    ? `<ul class="tasks">${c.items.map((i) => taskHTML(i, editing)).join("")}</ul>
       <button class="add-item" type="button" data-action="add-item">+ Add item</button>`
    : `<textarea class="note__text" rows="3" placeholder="Write something…" aria-label="Note text">${esc(c.text)}</textarea>`;

  const badges = editing
    ? TAGS.map((t) => `<button type="button" class="badge badge--toggle${c.tags.includes(t) ? " is-on" : ""}" data-tag="${t}" data-toggle-tag="${t}" aria-pressed="${c.tags.includes(t)}">${cap(t)}</button>`).join("")
    : c.tags.map((t) => `<span class="badge" data-tag="${t}">${cap(t)}</span>`).join("");

  const extra = isTodo
    ? `<span class="progress">${done}/${c.items.length}</span>`
    : "";

  return `
    <article class="card card--${c.type}${editing ? " is-editing" : ""}${c.pinned ? " is-pinned" : ""}${state.newId === c.id ? " is-new" : ""}" data-id="${c.id}" data-color="${c.color}">
      <header class="card__head">
        <h2 class="card__title" contenteditable="${editing}">${esc(c.title) || (editing ? "" : "Untitled")}</h2>
        <div class="card__actions">
          <button class="icon-btn icon-btn--sm" type="button" data-action="pin" aria-pressed="${Boolean(c.pinned)}" aria-label="${c.pinned ? "Unpin" : "Pin to top"}">${icon("pin")}</button>
          <div class="palette-wrap">
            <button class="icon-btn icon-btn--sm" type="button" data-action="palette" aria-label="Change color" aria-haspopup="true">${icon("palette")}</button>
            <div class="palette" role="group" aria-label="Card colors">
              ${[...COLORS, "plain"].map((col) => `<button type="button" class="swatch" data-color="${col}" aria-label="${col}"></button>`).join("")}
            </div>
          </div>
          <button class="icon-btn icon-btn--sm" type="button" data-action="edit" aria-pressed="${editing}" aria-label="${editing ? "Finish editing" : "Edit card"}">${icon(editing ? "check" : "edit")}</button>
          <button class="icon-btn icon-btn--sm" type="button" data-action="delete" aria-label="Delete card">${icon("trash")}</button>
        </div>
      </header>
      ${body}
      <footer class="card__foot">
        <div class="badges">${badges}</div>
        ${extra}
      </footer>
    </article>`;
}

function autoGrow(ta) {
  ta.style.height = "auto";
  ta.style.height = `${ta.scrollHeight}px`;
}

function render() {
  for (const type of ["note", "todo"]) {
    const list = state.cards.filter((c) => c.type === type && matches(c));
    el.grids[type].innerHTML = list.map(cardHTML).join("");
    el.empty[type].hidden = list.length > 0;
    $$("textarea.note__text", el.grids[type]).forEach(autoGrow);
  }
  state.newId = null;
}

function rerenderCard(id) {
  const old = cardEl(id);
  const card = findCard(id);
  if (!old || !card) return render();
  const tpl = document.createElement("template");
  tpl.innerHTML = cardHTML(card).trim();
  const fresh = tpl.content.firstElementChild;
  old.replaceWith(fresh);
  const ta = $("textarea.note__text", fresh);
  if (ta) autoGrow(ta);
}

/* ==========================================================================
   Card actions
   ========================================================================== */
function createCard(type, data = {}, { edit = true } = {}) {
  const now = Date.now();
  const card = {
    id: uid(),
    type,
    title: "",
    text: "",
    items: [],
    color: COLORS[state.cards.length % COLORS.length],
    tags: state.tag !== "all" ? [state.tag] : [],
    createdAt: now,
    updatedAt: now,
    ...data,
  };

  // Make sure the new card is visible
  state.query = "";
  el.search.value = "";
  el.searchClear.hidden = true;

  state.cards.unshift(card);
  state.cards.sort(byOrder);
  state.newId = card.id;
  state.editingId = edit ? card.id : state.editingId;
  saveNow(card);
  render();

  if (edit) {
    const t = $(".card__title", cardEl(card.id));
    t?.focus();
  }
  return card;
}

function setEditing(id) {
  const prev = state.editingId;
  state.editingId = id;
  if (prev && prev !== id) {
    const p = findCard(prev);
    if (p) { saveNow(p); rerenderCard(prev); }
  }
  if (id) {
    rerenderCard(id);
    $(".card__title", cardEl(id))?.focus();
  }
}

function deleteCard(id) {
  const idx = state.cards.findIndex((c) => c.id === id);
  if (idx < 0) return;
  const [card] = state.cards.splice(idx, 1);
  clearTimeout(timers.get(id));
  timers.delete(id);
  if (state.editingId === id) state.editingId = null;

  const node = cardEl(id);
  node?.classList.add("is-leaving");
  setTimeout(render, node ? 220 : 0);

  Promise.resolve(store.remove(id)).catch(console.error);
  toast("Card deleted", {
    actionLabel: "Undo",
    onAction: () => {
      state.cards.push(card);
      state.cards.sort(byOrder);
      saveNow(card);
      render();
    },
  });
}

function setColor(card, node, color) {
  card.color = color;
  node.dataset.color = color;
  $(".palette-wrap", node)?.classList.remove("is-open");
  document.activeElement?.blur?.();
  queueSave(card);
}

function togglePin(card) {
  card.pinned = !card.pinned;
  state.cards.sort(byOrder);
  saveNow(card);
  render();
  toast(card.pinned ? "Pinned to top" : "Unpinned");
}

function toggleTag(card, tag) {
  card.tags = card.tags.includes(tag) ? card.tags.filter((t) => t !== tag) : [...card.tags, tag];
  queueSave(card);
}

/* ----- To-do items ----- */
function updateProgress(card, node) {
  const p = $(".progress", node);
  if (p) p.textContent = `${card.items.filter((i) => i.done).length}/${card.items.length}`;
}

function insertItem(card, node, index = card.items.length) {
  const item = { id: uid(), text: "", done: false };
  card.items.splice(index, 0, item);

  const ul = $(".tasks", node);
  const html = taskHTML(item, state.editingId === card.id);
  const prev = ul.children[index - 1];
  if (prev) prev.insertAdjacentHTML("afterend", html);
  else ul.insertAdjacentHTML("afterbegin", html);

  $(`.task[data-item="${item.id}"] .task__text`, ul).focus();
  updateProgress(card, node);
  queueSave(card);
}

function removeItem(card, node, itemId, { focusPrev = false } = {}) {
  const idx = card.items.findIndex((i) => i.id === itemId);
  if (idx < 0) return;
  card.items.splice(idx, 1);
  const li = $(`.task[data-item="${itemId}"]`, node);
  const prevText = li?.previousElementSibling && $(".task__text", li.previousElementSibling);
  li?.remove();
  if (focusPrev && prevText) {
    prevText.contentEditable = "true";
    prevText.focus();
    const range = document.createRange();
    range.selectNodeContents(prevText);
    range.collapse(false);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  updateProgress(card, node);
  queueSave(card);
}

/* ----- AI: note → to-do ----- */
async function runExtract(card, btn) {
  if (!card.text.trim()) return toast("Write something in the note first");
  btn.classList.add("is-loading");
  try {
    const { title, items } = await extractTasks(card);
    createCard(
      "todo",
      {
        title,
        items: items.map((text) => ({ id: uid(), text, done: false })),
        tags: [...card.tags],
        color: "blue",
      },
      { edit: false }
    );
    setView("todo");
    toast(`Created ${items.length} tasks`);
  } catch (err) {
    console.error(err);
    toast(err.message || "Couldn't extract tasks");
  } finally {
    btn.classList.remove("is-loading");
  }
}

/* ==========================================================================
   Event delegation (one set of listeners for both grids)
   ========================================================================== */
el.main.addEventListener("click", (e) => {
  const node = e.target.closest(".card");
  if (!node) return;
  const card = findCard(node.dataset.id);
  if (!card) return;
  const t = e.target;

  const swatch = t.closest(".swatch");
  if (swatch) return setColor(card, node, swatch.dataset.color);

  const tagBtn = t.closest("[data-toggle-tag]");
  if (tagBtn) {
    toggleTag(card, tagBtn.dataset.toggleTag);
    tagBtn.classList.toggle("is-on");
    tagBtn.setAttribute("aria-pressed", tagBtn.classList.contains("is-on"));
    return;
  }

  const btn = t.closest("[data-action]");
  if (btn) {
    switch (btn.dataset.action) {
      case "palette": {
        const wrap = btn.closest(".palette-wrap");
        $$(".palette-wrap.is-open").forEach((w) => w !== wrap && w.classList.remove("is-open"));
        wrap.classList.toggle("is-open");
        break;
      }
      case "edit":
        setEditing(state.editingId === card.id ? null : card.id);
        break;
      case "delete":
        deleteCard(card.id);
        break;
      case "pin":
        togglePin(card);
        break;
      case "add-item":
        insertItem(card, node);
        break;
      case "extract":
        runExtract(card, btn);
        break;
    }
    return;
  }

  // While editing, clicking item text should edit it, not tick the box
  if (state.editingId === card.id && t.closest(".task__text")) e.preventDefault();
});

// Close any open color palette when clicking elsewhere
document.addEventListener("click", (e) => {
  if (!e.target.closest(".palette-wrap")) $$(".palette-wrap.is-open").forEach((w) => w.classList.remove("is-open"));
});

el.main.addEventListener("change", (e) => {
  if (!e.target.matches(".task__check")) return;
  const node = e.target.closest(".card");
  const card = findCard(node.dataset.id);
  const li = e.target.closest(".task");
  const item = card?.items.find((i) => i.id === li.dataset.item);
  if (!item) return;
  item.done = e.target.checked;
  li.classList.toggle("is-done", item.done);
  updateProgress(card, node);
  queueSave(card);
});

el.main.addEventListener("input", (e) => {
  const t = e.target;
  const node = t.closest(".card");
  const card = node && findCard(node.dataset.id);
  if (!card) return;

  if (t.matches(".note__text")) {
    card.text = t.value;
    autoGrow(t);
  } else if (t.matches(".card__title")) {
    card.title = t.textContent;
  } else if (t.matches(".task__text")) {
    const item = card.items.find((i) => i.id === t.closest(".task").dataset.item);
    if (item) item.text = t.textContent;
  } else return;

  queueSave(card);
});

el.main.addEventListener("keydown", (e) => {
  const t = e.target;
  if (t.matches(".card__title") && e.key === "Enter") {
    e.preventDefault();
    t.blur();
    return;
  }
  if (!t.matches(".task__text")) return;

  const node = t.closest(".card");
  const card = findCard(node.dataset.id);
  const li = t.closest(".task");
  const idx = card.items.findIndex((i) => i.id === li.dataset.item);

  if (e.key === "Enter") {
    e.preventDefault();
    if (t.textContent.trim()) insertItem(card, node, idx + 1);
  } else if (e.key === "Backspace" && !t.textContent) {
    e.preventDefault();
    removeItem(card, node, li.dataset.item, { focusPrev: true });
  }
});

// Paste as plain text only (keeps contenteditable clean)
el.main.addEventListener("paste", (e) => {
  if (!e.target.matches(".task__text, .card__title")) return;
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData("text").replace(/\s*\n\s*/g, " ");
  document.execCommand("insertText", false, text);
});

// Tidy up: trim titles, drop empty items on blur
el.main.addEventListener("focusout", (e) => {
  const t = e.target;
  const node = t.closest?.(".card");
  const card = node && findCard(node.dataset.id);
  if (!card) return;

  if (t.matches(".card__title")) {
    card.title = t.textContent.trim();
    queueSave(card);
  } else if (t.matches(".task__text") && !t.textContent.trim()) {
    const li = t.closest(".task");
    if (li?.isConnected) removeItem(card, node, li.dataset.item);
  }
});

/* ==========================================================================
   Tabs, filters, search, theme
   ========================================================================== */
function setView(view) {
  state.view = view;
  el.tabs.forEach((tab) => {
    const on = tab.dataset.view === view;
    tab.classList.toggle("is-active", on);
    tab.setAttribute("aria-selected", on);
  });
  el.views.notes.classList.toggle("is-active", view === "notes");
  el.views.todo.classList.toggle("is-active", view === "todo");
  el.fab.setAttribute("aria-label", view === "notes" ? "New note" : "New to-do list");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

el.tabs.forEach((tab) => tab.addEventListener("click", () => setView(tab.dataset.view)));

el.fab.addEventListener("click", () => createCard(state.view === "notes" ? "note" : "todo"));

el.pills.addEventListener("click", (e) => {
  const pill = e.target.closest(".pill");
  if (!pill) return;
  state.tag = pill.dataset.tag;
  $$(".pill", el.pills).forEach((p) => p.classList.toggle("is-active", p === pill));
  render();
});

el.search.addEventListener("input", () => {
  state.query = el.search.value;
  el.searchClear.hidden = !state.query;
  render();
});
el.searchClear.addEventListener("click", () => {
  el.search.value = "";
  state.query = "";
  el.searchClear.hidden = true;
  render();
  el.search.focus();
});

/* ----- Theme (system default, manual override remembered) ----- */
const root = document.documentElement;
const themeMeta = $('meta[name="theme-color"]');
const prefersDark = () => matchMedia("(prefers-color-scheme: dark)").matches;

function applyThemeMeta() {
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : prefersDark();
  themeMeta?.setAttribute("content", dark ? "#14161d" : "#f5f6f8");
}

function initTheme() {
  try {
    const saved = localStorage.getItem("stash.theme");
    if (saved) root.dataset.theme = saved;
  } catch { /* storage blocked: fall back to system theme */ }
  applyThemeMeta();
}

el.themeToggle.addEventListener("click", () => {
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : prefersDark();
  const next = dark ? "light" : "dark";
  root.dataset.theme = next;
  try { localStorage.setItem("stash.theme", next); } catch { /* ignore */ }
  applyThemeMeta();
});

/* ==========================================================================
   Toast
   ========================================================================== */
let toastTimer;
function toast(message, { actionLabel, onAction, duration } = {}) {
  clearTimeout(toastTimer);
  el.toast.innerHTML = `<span>${esc(message)}</span>`;
  el.toast.classList.toggle("has-action", Boolean(actionLabel));
  if (actionLabel) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "toast__btn";
    b.textContent = actionLabel;
    b.addEventListener("click", () => {
      onAction?.();
      el.toast.classList.remove("is-visible");
    });
    el.toast.append(b);
  }
  el.toast.classList.add("is-visible");
  toastTimer = setTimeout(() => el.toast.classList.remove("is-visible"), duration ?? (actionLabel ? 5000 : 2600));
}

/* ==========================================================================
   Google sign-in gate
   ========================================================================== */
function requireLogin() {
  const overlay = $("#login");
  const btn = $("#login-btn");
  const errBox = $("#login-error");
  overlay.hidden = false;

  return new Promise((resolve) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      errBox.textContent = "";
      try {
        await store.signIn();
        overlay.hidden = true;
        resolve();
      } catch (err) {
        console.error(err);
        errBox.textContent = "Sign-in failed: " + (err.code || err.message);
        btn.disabled = false;
      }
    });
  });
}

/* ==========================================================================
   Boot
   ========================================================================== */
async function boot() {
  initTheme();
  render(); // clears the static sample cards from index.html

  try {
    await store.init();
  } catch (err) {
    console.warn("Firebase unavailable, falling back to local storage:", err);
    store = localStore;
    await store.init();
    toast("Cloud sync unavailable (" + (err.code || err.message) + "). Saving on this device only.", { duration: 15000 });
  }
  if (store.mode === "firebase" && !store.signedIn) await requireLogin();
  store.subscribe(onRemote, (err) => toast("Cloud error: " + (err.code || err.message), { duration: 15000 }));
}

boot();
