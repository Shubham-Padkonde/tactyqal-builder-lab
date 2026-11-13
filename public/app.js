const $ = selector => document.querySelector(selector);
const form = $('#post-form');
let key = '', editingId = null, deleteId = null, query = '', offset = 0;
const pageSize = 6;
async function api(path, options = {}, editor = false) {
  const response = await fetch(path, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(editor ? { 'X-Editor-Key': key } : {}) } });
  if (response.status === 204) return null;
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Request failed.');
  return body;
}
function element(tag, text, className) { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; }
async function loadPosts() {
  const container = $('#posts');
  try {
    const data = await api(`/api/posts?limit=${pageSize}&offset=${offset}&q=${encodeURIComponent(query)}`);
    container.replaceChildren();
    if (!data.posts.length) container.append(element('p', query ? 'No field notes match that search. Try another word.' : 'No published field notes yet.'));
    for (const post of data.posts) {
      const card = element('article', null, 'post-card');
      card.append(element('p', post.category, 'eyebrow'), element('h3', post.title), element('p', post.excerpt));
      const button = element('button', 'Read field note →', 'text-link');
      button.addEventListener('click', () => openArticle(post.id)); card.append(button); container.append(card);
    }
    $('#post-count').textContent = data.total ? `${Math.min(offset + 1, data.total)}–${Math.min(offset + pageSize, data.total)} of ${data.total} field notes` : '0 field notes';
    $('#previous').hidden = offset === 0; $('#next').hidden = offset + pageSize >= data.total;
  } catch { container.replaceChildren(element('p', 'The journal could not be loaded. Please try again when the local API is running.')); }
}
async function openArticle(id) {
  try {
    const post = await api(`/api/posts/${id}`);
    $('#article-category').textContent = post.category; $('#article-title').textContent = post.title; $('#article-author').textContent = post.author; $('#article-body').textContent = post.body;
    $('#article-dialog').showModal();
  } catch (error) { $('#post-count').textContent = error.message; }
}
function newPost() { editingId = null; form.reset(); $('#editor-heading').textContent = 'New post'; }
async function loadStudio() {
  const data = await api('/api/posts?all=1&limit=50', {}, true);
  $('#studio-content').hidden = false;
  const list = $('#studio-list'); list.replaceChildren();
  if (!data.posts.length) list.append(element('p', 'Your studio is empty. Create the first post.'));
  for (const post of data.posts) {
    const row = element('div', null, 'studio-row'), info = element('div');
    info.append(element('strong', post.title), element('small', `${post.status.toUpperCase()} · /${post.slug}`));
    const actions = element('div', null, 'row-actions');
    const edit = element('button', 'Edit', 'text-link'); edit.setAttribute('aria-label', `Edit ${post.title}`);
    edit.addEventListener('click', () => { editingId = post.id; for (const name of ['title','slug','category','excerpt','body','author','status']) form.elements[name].value = post[name]; $('#editor-heading').textContent = 'Edit post'; $('#editor-heading').scrollIntoView({ block: 'start' }); });
    const remove = element('button', 'Delete', 'text-link'); remove.setAttribute('aria-label', `Delete ${post.title}`);
    remove.addEventListener('click', () => { deleteId = post.id; $('#delete-dialog').showModal(); });
    actions.append(edit, remove); row.append(info, actions); list.append(row);
  }
  if (data.total > 50) list.append(element('p', 'Showing the 50 most recently updated posts. The API supports pagination for larger libraries.'));
}
$('#search-button').addEventListener('click', () => { query = $('#search').value.trim(); offset = 0; loadPosts(); });
$('#search').addEventListener('keydown', event => { if (event.key === 'Enter') $('#search-button').click(); });
$('#previous').addEventListener('click', () => { offset = Math.max(0, offset - pageSize); loadPosts(); });
$('#next').addEventListener('click', () => { offset += pageSize; loadPosts(); });
$('#open-studio').addEventListener('click', () => $('#studio-dialog').showModal());
for (const button of document.querySelectorAll('.dialog-close')) button.addEventListener('click', () => button.closest('dialog').close());
$('#unlock-form').addEventListener('submit', async event => { event.preventDefault(); key = $('#editor-key').value; try { await loadStudio(); $('#studio-message').textContent = 'Studio unlocked. Your changes persist across server restarts.'; } catch (error) { $('#studio-message').textContent = error.message; $('#studio-content').hidden = true; } });
$('#new-post').addEventListener('click', () => { newPost(); $('#editor-heading').scrollIntoView({ block: 'start' }); form.elements.title.focus(); });
form.addEventListener('submit', async event => {
  event.preventDefault(); const button = form.querySelector('[type=submit]'); button.disabled = true;
  try {
    const data = Object.fromEntries(new FormData(form));
    const saved = await api(editingId ? `/api/posts/${editingId}` : '/api/posts', { method: editingId ? 'PATCH' : 'POST', body: JSON.stringify(data) }, true);
    $('#studio-message').textContent = `Saved “${saved.title}” as ${saved.status}.`;
    newPost(); await loadStudio(); await loadPosts(); $('#studio-message').scrollIntoView({ block: 'center' });
  } catch (error) { $('#studio-message').textContent = error.message; $('#studio-message').scrollIntoView({ block: 'center' }); }
  finally { button.disabled = false; }
});
$('#cancel-delete').addEventListener('click', () => $('#delete-dialog').close());
$('#confirm-delete').addEventListener('click', async () => {
  const button = $('#confirm-delete'); button.disabled = true;
  try { await api(`/api/posts/${deleteId}`, { method: 'DELETE' }, true); $('#delete-dialog').close(); $('#studio-message').textContent = 'Post deleted.'; if (editingId === deleteId) newPost(); await loadStudio(); await loadPosts(); }
  catch (error) { $('#delete-dialog').close(); $('#studio-message').textContent = error.message; }
  finally { button.disabled = false; }
});
loadPosts();
