// ------------------------------
// 1. التهيئة العامة والمتغيرات
// ------------------------------
let db;
const FILE_STORE = 'files';
const UPLOAD_STORE = 'uploads';
const META_KEY = 'maktabati-meta';
const ADMINSESSIONKEY = 'maktabati-admin-session';
const HASH_ITERATIONS = 100000;
const HASH_ALGORITHM = 'SHA-256';
let meta = {};
let currentEditingItem = null; 
let deferredPrompt; 

function showMessage(msg, type = 'neutral') {
  const container = document.getElementById('message-container');
  container.innerHTML = ''; 
  const msgEl = document.createElement('div');
  msgEl.className = `message ${type} show`;
  msgEl.innerText = msg;
  container.appendChild(msgEl); 
  setTimeout(() => {
    msgEl.classList.remove('show');
    setTimeout(() => msgEl.remove(), 300);
  }, 3000);
}

function openDB() {
  return new Promise((res, rej) => {
    const rq = indexedDB.open('maktabati-db', 1);
    rq.onupgradeneeded = (e) => {
      const db = e.target.result;
      db.createObjectStore(FILE_STORE, { keyPath: 'id' });
      db.createObjectStore(UPLOAD_STORE, { autoIncrement: true });
    };
    rq.onsuccess = (e) => {
      db = e.target.result;
      res();
    };
    rq.onerror = (e) => rej(e.target.error);
  });
}

function getObjectStore(storeName, mode) {
  const tx = db.transaction(storeName, mode);
  return tx.objectStore(storeName);
}

// ------------------------------
// 2. وظائف الملفات (تحسين الأسماء والأنواع)
// ------------------------------
function saveFile(id, file) {
  return new Promise((res, rej) => {
    const store = getObjectStore(FILE_STORE, 'readwrite');
    // نحفظ الملف باسمه الأصلي ونوعه الأصلي
    const rq = store.put({ id, data: file, type: file.type, name: file.name });
    rq.onsuccess = () => res(true);
    rq.onerror = (e) => rej(e.target.error);
  });
}

function getFile(id) {
  return new Promise((res, rej) => {
    const store = getObjectStore(FILE_STORE, 'readonly');
    const rq = store.get(id);
    rq.onsuccess = (e) => res(e.target.result || null);
    rq.onerror = (e) => rej(e.target.error);
  });
}

function deleteFile(id) {
    return new Promise((res, rej) => {
        const store = getObjectStore(FILE_STORE, 'readwrite');
        const rq = store.delete(id);
        rq.onsuccess = () => res(true);
        rq.onerror = (e) => rej(e.target.error);
    });
}

// باقي وظائف IndexedDB للمراسلات كما هي دون تغيير
function saveUpload(uploadData) {
  return new Promise((res, rej) => {
    const store = getObjectStore(UPLOAD_STORE, 'readwrite');
    const rq = store.add(uploadData);
    rq.onsuccess = (e) => res(e.target.result);
    rq.onerror = (e) => rej(e.target.error);
  });
}

function getAllUploads() {
  return new Promise((res, rej) => {
    const store = getObjectStore(UPLOAD_STORE, 'readonly');
    const rq = store.getAll();
    rq.onsuccess = (e) => {
        const uploads = e.target.result;
        const keys = e.target.source.getAllKeys();
        keys.onsuccess = (k) => {
            const results = uploads.map((upload, index) => ({ 
                ...upload, 
                key: k.target.result[index] 
            }));
            res(results);
        };
        keys.onerror = (e) => rej(e.target.error);
    };
    rq.onerror = (e) => rej(e.target.error);
  });
}

function clearUploads() {
  return new Promise((res, rej) => {
    const store = getObjectStore(UPLOAD_STORE, 'readwrite');
    const rq = store.clear();
    rq.onsuccess = () => res(true);
    rq.onerror = (e) => rej(e.target.error);
  });
}

function getAllFileBlobs() {
    return new Promise((res, rej) => {
        const store = getObjectStore(FILE_STORE, 'readonly');
        const rq = store.getAll();
        rq.onsuccess = (e) => res(e.target.result);
        rq.onerror = (e) => rej(e.target.error);
    });
}

function clearAllFiles() {
    return new Promise((res, rej) => {
        const store = getObjectStore(FILE_STORE, 'readwrite');
        const rq = store.clear();
        rq.onsuccess = () => res(true);
        rq.onerror = (e) => rej(e.target.error);
    });
}

// ------------------------------
// 3. وظائف التشفير والأمان (محفوظة)
// ------------------------------
function str2buf(str) { return new TextEncoder().encode(str); }
function generateSalt(length = 16) { return window.crypto.getRandomValues(new Uint8Array(length)); }
function buf2b64(buf) { return btoa(String.fromCharCode.apply(null, new Uint8Array(buf))); }
function b642buf(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey("raw", str2buf(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  const hash = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: salt, iterations: HASH_ITERATIONS, hash: HASH_ALGORITHM }, key, 256);
  return buf2b64(hash);
}

async function verifyPassword(password) {
  if (!meta.password || !meta.password.hash || !meta.password.salt) return false;
  const storedHash = meta.password.hash;
  const salt = b642buf(meta.password.salt);
  const newHash = await hashPassword(password, salt);
  return newHash === storedHash;
}

function readFileAsText(file) { return new Promise((res, rej) => { const reader = new FileReader(); reader.onload = (e) => res(e.target.result); reader.onerror = (e) => rej(e); reader.readAsText(file); }); }

function downloadData(data, filename, mimeType) {
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
}

function generateUUID() { return 'id-' + Date.now().toString(36) + Math.random().toString(36).substring(2); }

// ------------------------------
// 4. إدارة الميتا (Meta)
// ------------------------------
function saveMeta() { localStorage.setItem(META_KEY, JSON.stringify(meta)); }
function loadMeta() { const data = localStorage.getItem(META_KEY); if (data) meta = JSON.parse(data); }

function ensureDefaults() {
  loadMeta();
  if (!meta.types || meta.types.length === 0) {
    meta = { password: null, types: [{ id: 't1', icon: '⚖️', name: 'قانون العمل', items: [{ id: 't1-i1', name: 'المادة (1): أحكام عامة', content: '<h2>نص قانوني تجريبي</h2>', files: [], children: [] }] }], uploads: [] };
    saveMeta();
  }
}

let parentCollection = null; 

function getItemById(id, currentItems = meta.types) {
  for (const item of currentItems) {
    if (item.id === id) { parentCollection = currentItems; return item; }
    if (item.items) { const found = getItemById(id, item.items); if (found) return found; }
    if (item.children) { const found = getItemById(id, item.children); if (found) return found; }
  }
  return null;
}

// ------------------------------
// 5. العرض والبحث العام
// ------------------------------
function renderPublicIndex(activeItemId = null) {
  const container = document.getElementById('public-index');
  container.innerHTML = '';
  const searchTerm = document.getElementById('search').value.toLowerCase();
  const isSearchMode = searchTerm.length > 0;

  meta.types.forEach((type, index) => {
    const typeEl = document.createElement('div');
    typeEl.className = 'index-group-name';
    const isExpanded = index === 0 && !isSearchMode; 
    if (isExpanded) typeEl.classList.add('expanded');
    typeEl.innerText = `${type.icon} ${type.name}`;
    typeEl.onclick = () => {
      typeEl.classList.toggle('expanded');
      container.querySelectorAll(`.child-of-${type.id}`).forEach(el => el.style.display = typeEl.classList.contains('expanded') ? 'block' : 'none');
    };
    container.appendChild(typeEl);

    type.items.forEach(item => {
      const itemEl = document.createElement('div');
      itemEl.className = `index-item child-of-${type.id}`;
      itemEl.style.display = (isExpanded || isSearchMode) ? 'block' : 'none'; 
      itemEl.innerText = item.name;
      itemEl.onclick = () => openItem(item.id);
      container.appendChild(itemEl);
      if (item.children) {
        item.children.forEach(child => {
          const childEl = document.createElement('div');
          childEl.className = `index-item child-of-${type.id}`;
          childEl.style.display = (isExpanded || isSearchMode) ? 'block' : 'none';
          childEl.style.marginRight = '20px';
          childEl.innerText = child.name;
          childEl.onclick = () => openItem(child.id);
          container.appendChild(childEl);
        });
      }
    });
  });
  if (meta.types.length > 0 && meta.types[0].items.length > 0) openItem(activeItemId || meta.types[0].items[0].id);
}

document.getElementById('btn-search').onclick = () => renderPublicIndex();
function highlightSearch(text, term) {
  if (!term) return text;
  return text.replace(new RegExp(`(${term})`, 'gi'), '<mark>$1</mark>');
}

// ------------------------------
// 6. عرض المحتوى والمرفقات (تحسين الورد والأسماء)
// ------------------------------
function openItem(itemId) {
  const item = getItemById(itemId);
  if (!item) return;
  currentEditingItem = item; 
  document.querySelectorAll('.index-item.active').forEach(el => el.classList.remove('active'));
  const currentEl = document.querySelector(`.index-item[onclick*="${itemId}"]`);
  if(currentEl) currentEl.classList.add('active');
  document.getElementById('item-title').innerText = item.name;
  const searchTerm = document.getElementById('search').value.toLowerCase();
  document.getElementById('viewer-content').innerHTML = highlightSearch(item.content, searchTerm);
  renderAttachments(item.files);
}

function renderAttachments(files) {
  const section = document.getElementById('attachments-section');
  const list = document.getElementById('attachments-list');
  if (!files || files.length === 0) { section.style.display = 'none'; list.innerHTML = ''; return; }
  section.style.display = 'block'; list.innerHTML = '';

  files.forEach(file => {
    const container = document.createElement('div');
    container.style = "display: flex; align-items: center; margin-bottom: 8px; gap: 10px;";
    
    const viewTag = document.createElement('a');
    viewTag.className = 'attachment-tag';
    viewTag.href = '#';
    // استخدام الاسم الأصلي المخزن
    viewTag.innerText = `📎 ${file.name} (${(file.size / 1024).toFixed(2)} KB)`;
    
    viewTag.onclick = async (e) => {
      e.preventDefault();
      const fileRecord = await getFile(file.id);
      if (fileRecord) {
        const blob = fileRecord.data;
        const url = URL.createObjectURL(blob);
        // فتح في نافذة جديدة - المتصفح سيحاول العرض أو التحميل حسب نوع الملف
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      }
    };

    const downloadBtn = document.createElement('button');
    downloadBtn.innerText = '⬇️';
    downloadBtn.className = 'icon-btn';
    downloadBtn.onclick = async () => {
      const fileRecord = await getFile(file.id);
      if (fileRecord) downloadData(fileRecord.data, fileRecord.name, fileRecord.type);
    };

    container.appendChild(viewTag);
    container.appendChild(downloadBtn);
    list.appendChild(container);
  });
}

// ------------------------------
// 7. وظائف الإدارة والتحقق (محفوظة)
// ------------------------------
function openAdminModal() {
    if (sessionStorage.getItem(ADMINSESSIONKEY) === 'active') {
        document.getElementById('admin-modal').classList.add('show');
        renderAdminIndexList();
    } else {
        document.getElementById('password-modal').classList.add('show');
        document.getElementById('admin-password-input').value = '';
        document.getElementById('password-info').innerText = meta.password ? 'الرجاء إدخال كلمة المرور.' : 'لم يتم تعيين كلمة مرور.';
    }
}

document.getElementById('btn-admin').onclick = openAdminModal;
document.getElementById('admin-close').onclick = () => document.getElementById('admin-modal').classList.remove('show');
document.getElementById('close-password-modal').onclick = () => document.getElementById('password-modal').classList.remove('show');

document.getElementById('submit-password').onclick = async () => {
    const password = document.getElementById('admin-password-input').value;
    if (!meta.password) {
        sessionStorage.setItem(ADMINSESSIONKEY, 'active');
        document.getElementById('password-modal').classList.remove('show');
        openAdminModal();
        return;
    }
    if (await verifyPassword(password)) {
        sessionStorage.setItem(ADMINSESSIONKEY, 'active');
        document.getElementById('password-modal').classList.remove('show');
        openAdminModal();
    } else {
        document.getElementById('password-info').innerText = 'كلمة المرور غير صحيحة.';
    }
};

function renderAdminIndexList() {
  const list = document.getElementById('admin-index-list');
  list.innerHTML = '';
  meta.types.forEach(type => {
    const el = document.createElement('div');
    el.className = 'index-item';
    el.innerText = `${type.icon} ${type.name}`;
    list.appendChild(el);
  });
}

// ------------------------------
// 8. تحرير الفهرس والمرفقات (تحديث: مع إغلاق الإدارة)
// ------------------------------
function handleShowIndexManager() {
    if (sessionStorage.getItem(ADMINSESSIONKEY) !== 'active') return showMessage('يجب تسجيل الدخول.', 'error');
    
    // التحديث المطلوب: إغلاق نافذة الإدارة عند تفعيل التحرير
    document.getElementById('admin-modal').classList.remove('show');

    const area = document.getElementById('content-manager-area');
    if (area.style.display === 'block') {
        area.style.display = 'none';
        document.querySelector('.layout').style.display = 'flex';
        document.getElementById('btn-show-index-manager').innerText = '🧩 تحرير الفهرس';
        renderPublicIndex();
    } else {
        area.style.display = 'block';
        document.querySelector('.layout').style.display = 'none';
        document.getElementById('btn-show-index-manager').innerText = '❌ إغلاق التحرير';
        renderEditableIndex(); 
    }
}

function renderEditableIndex() {
    const editableIndex = document.getElementById('editable-index');
    editableIndex.innerHTML = '<button class="btn primary" onclick="addNewType()">➕ إضافة تصنيف جديد</button>';
    meta.types.forEach(type => {
        const typeEl = document.createElement('div');
        typeEl.className = 'editable-type';
        typeEl.innerHTML = `<div class="editable-header"><b>${type.icon} ${type.name}</b><div class="editable-actions"><button class="icon-btn" onclick="editItem('${type.id}')">✏️</button><button class="icon-btn" onclick="addNewItem('${type.id}')">➕</button><button class="icon-btn delete" onclick="deleteItemConfirmation('${type.id}')">🗑️</button></div></div><div id="items-${type.id}" class="editable-items"></div>`;
        editableIndex.appendChild(typeEl);
        type.items.forEach(item => {
            const itemEl = document.createElement('div');
            itemEl.className = 'editable-item';
            itemEl.innerHTML = `<div class="editable-header"><span>${item.name}</span><div class="editable-actions"><button class="icon-btn" onclick="editItem('${item.id}')">✏️</button><button class="icon-btn" onclick="addNewItem('${item.id}')">➕</button><button class="icon-btn delete" onclick="deleteItemConfirmation('${item.id}')">🗑️</button></div></div>`;
            document.getElementById(`items-${type.id}`).appendChild(itemEl);
            if (item.children) {
                item.children.forEach(child => {
                    const childEl = document.createElement('div');
                    childEl.className = 'editable-child';
                    childEl.innerHTML = `<div class="editable-header" style="padding-right:20px;"><span>${child.name}</span><div class="editable-actions"><button class="icon-btn" onclick="editItem('${child.id}')">✏️</button><button class="icon-btn delete" onclick="deleteItemConfirmation('${child.id}')">🗑️</button></div></div>`;
                    document.getElementById(`items-${type.id}`).appendChild(childEl);
                });
            }
        });
    });
}

function addNewType() {
    currentEditingItem = { id: generateUUID(), name: 'تصنيف جديد', icon: '🆕', items: [], isNew: true, isType: true };
    openEditorModal(currentEditingItem);
}

function addNewItem(parentId) {
    const parent = getItemById(parentId); 
    if (!parent) return;
    currentEditingItem = { id: generateUUID(), name: 'مادة جديدة', content: '', files: [], children: [], parentId, isNew: true, isType: false };
    openEditorModal(currentEditingItem);
}

function editItem(id) {
    const item = getItemById(id);
    if (!item) return;
    currentEditingItem = item;
    openEditorModal(item);
}

function openEditorModal(item) {
    const isType = !!item.items;
    document.getElementById('editor-name').value = item.name || '';
    document.getElementById('editor-icon').value = item.icon || '';
    document.getElementById('editor-content').value = item.content || '';
    document.getElementById('editor-icon').style.display = isType ? 'block' : 'none';
    document.getElementById('editor-content').style.display = isType ? 'none' : 'block';
    document.getElementById('btn-delete-item').style.display = item.isNew ? 'none' : 'block';
    document.getElementById('btn-view-attachments').innerText = `عرض المرفقات (${item.files ? item.files.length : 0})`;
    document.getElementById('editor-modal').classList.add('show');
}

function saveEditorContent() {
    const item = currentEditingItem;
    item.name = document.getElementById('editor-name').value.trim();
    if (!!item.items) item.icon = document.getElementById('editor-icon').value.trim();
    else item.content = document.getElementById('editor-content').value.trim();
    
    if (item.isNew) {
        if (!!item.items) meta.types.push(item);
        else {
            const parent = getItemById(item.parentId);
            if (parent.items) parent.items.push(item);
            else if (parent.children) parent.children.push(item);
        }
        delete item.isNew;
    }
    saveMeta();
    closeEditorModal();
    renderEditableIndex();
    showMessage('تم الحفظ.');
}

function closeEditorModal() { document.getElementById('editor-modal').classList.remove('show'); currentEditingItem = null; }

function deleteItemConfirmation(id) {
    const item = getItemById(id);
    if (confirm(`حذف: ${item.name}؟`)) deleteCurrentItem(id);
}

async function deleteCurrentItem(id) {
    const item = getItemById(id);
    const parent = parentCollection;
    const index = parent.findIndex(i => i.id === id);
    const fileDeletion = item.files?.map(f => deleteFile(f.id)) || [];
    parent.splice(index, 1);
    await Promise.all(fileDeletion);
    saveMeta();
    renderEditableIndex();
    renderPublicIndex();
    showMessage('تم الحذف.');
}

async function handleAttachFiles() {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true;
    input.onchange = async (e) => {
        if (!currentEditingItem.files) currentEditingItem.files = [];
        for (const f of Array.from(e.target.files)) {
            const id = 'f-' + Date.now() + Math.random().toString(36).substr(2,5);
            // حفظ الملف باسمه الأصلي
            await saveFile(id, f);
            currentEditingItem.files.push({ id, name: f.name, size: f.size, type: f.type });
        }
        saveMeta();
        document.getElementById('btn-view-attachments').innerText = `عرض المرفقات (${currentEditingItem.files.length})`;
        showMessage('تم الرفع بالأسماء الأصلية.');
    };
    input.click();
}

function openViewAttachmentsModal() {
    document.getElementById('view-attachments-modal').classList.add('show');
    const list = document.getElementById('attachments-list-edit');
    list.innerHTML = '';
    if (!currentEditingItem.files?.length) { list.innerHTML = 'لا توجد مرفقات.'; return; }
    currentEditingItem.files.forEach(f => {
        const d = document.createElement('div');
        d.style = "display:flex; justify-content:space-between; margin-bottom:5px; border-bottom:1px solid #444; padding:5px;";
        d.innerHTML = `<span>📎 ${f.name}</span><button class="icon-btn delete" onclick="removeAttachmentFromItem('${f.id}')">🗑️</button>`;
        list.appendChild(d);
    });
}

async function removeAttachmentFromItem(fileId) {
    if (!confirm('حذف المرفق نهائياً؟')) return;
    currentEditingItem.files = currentEditingItem.files.filter(f => f.id !== fileId);
    await deleteFile(fileId);
    saveMeta();
    openViewAttachmentsModal();
    document.getElementById('btn-view-attachments').innerText = `عرض المرفقات (${currentEditingItem.files.length})`;
}

function closeViewAttachmentsModal() { document.getElementById('view-attachments-modal').classList.remove('show'); }

// ------------------------------
// 9. وظائف التواصل والمراسلات (محفوظة)
// ------------------------------
document.getElementById('submit-upload').onclick = async () => {
  const name = document.getElementById('visitor-name').value.trim();
  const message = document.getElementById('visitor-message').value.trim();
  const filesInput = document.getElementById('visitor-files');
  const files = Array.from(filesInput.files);
  if (!message && !files.length) return showMessage('أدخل رسالة أو ملف.', 'error');
  
  let fileDetails = [];
  for (const f of files) {
    const id = `u${Date.now()}-${Math.random().toString(36).substr(2,5)}`;
    await saveFile(id, f);
    fileDetails.push({ id, name: f.name, size: f.size, type: f.type });
  }
  await saveUpload({ name: name || 'زائر', message, files: fileDetails, date: new Date().toISOString() });
  showMessage('تم الإرسال بنجاح.', 'success');
  document.getElementById('visitor-name').value = ''; document.getElementById('visitor-message').value = ''; filesInput.value = '';
};

async function openUploadsModal() {
    if (sessionStorage.getItem(ADMINSESSIONKEY) !== 'active') return;
    document.getElementById('uploads-modal').classList.add('show');
    await renderUploadsList();
}

document.getElementById('uploads-close').onclick = () => {
    document.getElementById('uploads-modal').classList.remove('show');
};

async function renderUploadsList() {
    const list = document.getElementById('uploads-list');
    list.innerHTML = '';
    const uploads = await getAllUploads();
    if (!uploads.length) { list.innerHTML = 'لا توجد مراسلات.'; return; }
    uploads.reverse().forEach(u => {
        const el = document.createElement('div');
        el.className = 'upload-item';
        let fHtml = u.files?.map(f => `<a href="#" class="attachment-tag" onclick="downloadUploadFile(event, '${f.id}', '${f.name}')">📎 ${f.name}</a>`).join('') || '';
        el.innerHTML = `<div class="upload-header"><strong>${u.name}</strong><small>${new Date(u.date).toLocaleString('ar-SA')}</small></div><p>${u.message}</p><div class="upload-files">${fHtml}</div><button class="icon-btn delete" onclick="deleteUpload(${u.key})">🗑️ حذف</button>`;
        list.appendChild(el);
    });
}

async function downloadUploadFile(e, id, name) { 
    e.preventDefault(); 
    const fileRecord = await getFile(id); 
    if (fileRecord) downloadData(fileRecord.data, fileRecord.name, fileRecord.type); 
}

async function deleteUpload(key) {
    if (!confirm('حذف الرسالة؟')) return;
    const store = getObjectStore(UPLOAD_STORE, 'readwrite');
    const u = await new Promise(res => { const r = store.get(key); r.onsuccess = () => res(r.result); });
    if (u.files) for (const f of u.files) await deleteFile(f.id);
    store.delete(key);
    showMessage('تم الحذف.');
    renderUploadsList();
}

async function deleteUploads() {
    if (confirm('مسح الكل؟')) {
        const u = await getAllUploads();
        for (const rs of u) if (rs.files) for (const f of rs.files) await deleteFile(f.id);
        await clearUploads();
        showMessage('تم المسح.');
        document.getElementById('uploads-modal').classList.remove('show');
    }
}

// ------------------------------
// 10. التصدير والاستيراد (محفوظة)
// ------------------------------
async function exportFullData() {
    showMessage('جاري التصدير...');
    const blobs = await getAllFileBlobs();
    const filesData = [];
    for (const b of blobs) {
        filesData.push({ id: b.id, name: b.name, type: b.type, data: buf2b64(await b.data.arrayBuffer()) });
    }
    const data = { version: '1.0', meta, files: filesData, uploads: await getAllUploads() };
    downloadData(JSON.stringify(data), `full_backup_${new Date().toISOString().slice(0,10)}.json`, 'application/json');
    showMessage('تم التصدير بنجاح.', 'success');
}

function startFullImport() { document.getElementById('input-import-full-data').click(); }

async function handleFullImport(e) {
    const f = e.target.files[0];
    if (!f || !confirm('سيتم استبدال البيانات الحالية. هل تريد الاستمرار؟')) return;
    try {
        const d = JSON.parse(await readFileAsText(f));
        await clearAllFiles(); await clearUploads();
        meta = d.meta; saveMeta();
        for (const fd of d.files) await saveFile(fd.id, new Blob([b642buf(fd.data)], { type: fd.type }));
        for (const u of d.uploads) { const { key, ...ud } = u; await saveUpload(ud); }
        showMessage('تم الاستيراد بنجاح. يرجى تحديث الصفحة.', 'success');
        renderPublicIndex();
    } catch (err) { showMessage('خطأ في الاستيراد.', 'error'); }
}

function exportMetaOnly() { downloadData(JSON.stringify(meta), 'meta_backup.json', 'application/json'); }
function importMetaOnly() {
    const i = document.createElement('input'); i.type = 'file';
    i.onchange = async (e) => {
        try {
            meta = JSON.parse(await readFileAsText(e.target.files[0])); saveMeta();
            showMessage('تم استيراد الفهرس.'); renderPublicIndex();
        } catch(err) { showMessage('خطأ.', 'error'); }
    };
    i.click();
}

// ------------------------------
// 11. أزرار الأدوات 
// ------------------------------
document.getElementById('btn-copy-selected').onclick = () => {
    navigator.clipboard.writeText(document.getElementById('viewer-content').innerText).then(() => showMessage('تم النسخ.'));
};

document.getElementById('btn-print-selected').onclick = () => {
    const w = window.open('', '', 'height=600,width=800');
    w.document.write(`<html><body style="direction:rtl; font-family:Tahoma;"><h1>${currentEditingItem.name}</h1>${document.getElementById('viewer-content').innerHTML}</body></html>`);
    w.document.close(); w.print();
};

document.getElementById('btn-share-selected').onclick = async () => {
    const text = `${currentEditingItem.name}\n\n${document.getElementById('viewer-content').innerText.substring(0, 200)}...`;
    if (navigator.share) await navigator.share({ title: currentEditingItem.name, text, url: window.location.href });
    else showMessage('تم نسخ النص للمشاركة.');
};

// ------------------------------
// 12. إصلاح زر التثبيت PWA (تحسين إضافي)
// ------------------------------
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installBtn = document.getElementById('btn-install');
    if (installBtn) installBtn.style.display = 'inline-block';
});

async function installApp() {
    if (!deferredPrompt) {
        showMessage('خاصية التثبيت غير متاحة حالياً في متصفحك.', 'error');
        return;
    }
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') showMessage('شكراً لتثبيت التطبيق!');
    deferredPrompt = null;
    document.getElementById('btn-install').style.display = 'none';
}

// ------------------------------
// 13. تشغيل النظام والربط النهائي
// ------------------------------
window.addEventListener('load', async () => {
  await openDB(); ensureDefaults(); renderPublicIndex();
  
  document.getElementById('btn-admin').onclick = openAdminModal;
  document.getElementById('btn-show-index-manager').onclick = handleShowIndexManager;
  document.getElementById('editor-save').onclick = saveEditorContent;
  document.getElementById('editor-close').onclick = closeEditorModal;
  document.getElementById('btn-delete-item').onclick = () => { deleteItemConfirmation(currentEditingItem.id); closeEditorModal(); };
  document.getElementById('btn-attach-files').onclick = handleAttachFiles;
  document.getElementById('btn-view-attachments').onclick = openViewAttachmentsModal;
  document.getElementById('view-attachments-close').onclick = closeViewAttachmentsModal;
  document.getElementById('btn-show-uploads').onclick = openUploadsModal;
  document.getElementById('btn-delete-uploads').onclick = deleteUploads;
  document.getElementById('btn-export-full-data').onclick = exportFullData;
  document.getElementById('btn-import-full-data').onclick = startFullImport;
  document.getElementById('input-import-full-data').onchange = handleFullImport;
  document.getElementById('admin-export-meta').onclick = exportMetaOnly;
  document.getElementById('admin-import-meta').onclick = importMetaOnly;
  
  const installBtn = document.getElementById('btn-install');
  if (installBtn) installBtn.onclick = installApp;

  document.getElementById('btn-set-password').onclick = async () => {
    const p = prompt('أدخل كلمة المرور الجديدة:');
    if (!p) return;
    const salt = generateSalt();
    meta.password = { hash: await hashPassword(p, salt), salt: buf2b64(salt) };
    saveMeta(); showMessage('تم تعيين كلمة المرور بنجاح.');
  };

  document.getElementById('btn-reset-password').onclick = () => {
    if (confirm('هل أنت متأكد من مسح كلمة المرور؟ سيصبح الدخول متاحاً للجميع.')) {
        meta.password = null;
        saveMeta();
        sessionStorage.removeItem(ADMINSESSIONKEY);
        document.getElementById('admin-modal').classList.remove('show');
        showMessage('تم مسح كلمة المرور بنجاح.');
    }
  };
});
