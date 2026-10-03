const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
const toastElement = document.querySelector('#toast');
let toastTimer;
function toast(message) {
  if (!toastElement) return;
  clearTimeout(toastTimer);
  toastElement.textContent = message;
  toastElement.hidden = false;
  toastTimer = setTimeout(() => {
    toastElement.hidden = true;
  }, 3500);
}

document.querySelectorAll('[data-open]').forEach((button) => {
  button.addEventListener('click', () => document.getElementById(button.dataset.open)?.showModal());
});
document.querySelectorAll('[data-close]').forEach((button) => {
  button.addEventListener('click', () => button.closest('dialog')?.close());
});
document.querySelectorAll('dialog').forEach((dialog) => {
  dialog.addEventListener('click', (event) => {
    const rect = dialog.getBoundingClientRect();
    if (
      event.target === dialog &&
      (event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom)
    )
      dialog.close();
  });
});
document.querySelectorAll('[data-confirm]').forEach((form) => {
  form.addEventListener('submit', (event) => {
    if (!window.confirm(form.dataset.confirm)) event.preventDefault();
  });
});
document
  .querySelectorAll('[data-dismiss]')
  .forEach((button) => button.addEventListener('click', () => button.closest('.notice').remove()));
document
  .querySelectorAll('[data-auto-submit]')
  .forEach((select) => select.addEventListener('change', () => select.form.requestSubmit()));
document.querySelector('[data-password-toggle]')?.addEventListener('click', (event) => {
  const button = event.currentTarget;
  const field = document.getElementById(button.getAttribute('aria-controls'));
  const visible = field.type === 'password';
  field.type = visible ? 'text' : 'password';
  button.textContent = visible ? 'Hide' : 'Show';
  button.setAttribute('aria-pressed', String(visible));
});
function closeSidebar() {
  document.body.classList.remove('nav-open');
  document.querySelector('[data-sidebar-open]')?.setAttribute('aria-expanded', 'false');
  syncSidebar();
}
const sidebar = document.querySelector('#sidebar');
const mobileMedia = window.matchMedia('(max-width: 700px)');
function syncSidebar() {
  if (sidebar) sidebar.inert = mobileMedia.matches && !document.body.classList.contains('nav-open');
}
mobileMedia.addEventListener('change', () => {
  closeSidebar();
});
syncSidebar();
document.querySelector('[data-sidebar-open]')?.addEventListener('click', (event) => {
  document.body.classList.add('nav-open');
  event.currentTarget.setAttribute('aria-expanded', 'true');
  syncSidebar();
  document.querySelector('[data-sidebar-close]')?.focus();
});
document
  .querySelectorAll('[data-sidebar-close]')
  .forEach((button) => button.addEventListener('click', closeSidebar));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Tab' && document.body.classList.contains('nav-open')) {
    const focusable = [
      ...sidebar.querySelectorAll('a[href], button, input:not([type="hidden"])'),
    ].filter((element) => !element.disabled);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  if (event.key === 'Escape' && document.body.classList.contains('nav-open')) {
    closeSidebar();
    document.querySelector('[data-sidebar-open]')?.focus();
  }
  if (
    event.key === '/' &&
    !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) &&
    !document.querySelector('dialog[open]')
  ) {
    const search = document.querySelector('#search');
    if (search) {
      event.preventDefault();
      search.focus();
    }
  }
});

document.querySelectorAll('[data-copy]').forEach((button) => {
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      toast('Link copied. A little invitation, ready to go.');
    } catch {
      toast('Select the link and copy it manually.');
      button.closest('.share-card')?.querySelector('input').select();
    }
  });
});

document.querySelectorAll('[data-star]').forEach((form) => {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      const response = await fetch(form.action, {
        method: 'POST',
        headers: { 'x-csrf-token': csrf, accept: 'application/json' },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Please try again.');
      button.classList.toggle('is-starred', data.starred);
      button.setAttribute('aria-pressed', String(data.starred));
      button.setAttribute(
        'aria-label',
        button
          .getAttribute('aria-label')
          .replace(/^(Unstar|Star)/, data.starred ? 'Unstar' : 'Star'),
      );
      toast(data.starred ? 'Saved to your starred files.' : 'Removed from starred files.');
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  });
});

const uploadForm = document.querySelector('#upload-form');
const fileInput = document.querySelector('#file-input');
const dropZone = document.querySelector('#drop-zone');
function updateSelected() {
  const file = fileInput.files[0];
  document.querySelector('#selected-file').textContent = file
    ? `${file.name} · ${(file.size / 1024).toFixed(1)} KB`
    : '';
  document.querySelector('#upload-status').textContent = '';
}
fileInput?.addEventListener('change', updateSelected);
if (dropZone) {
  ['dragenter', 'dragover'].forEach((name) =>
    dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      dropZone.classList.add('drag-over');
    }),
  );
  ['dragleave', 'drop'].forEach((name) =>
    dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      dropZone.classList.remove('drag-over');
    }),
  );
  dropZone.addEventListener('drop', (event) => {
    if (event.dataTransfer.files.length !== 1) {
      document.querySelector('#upload-status').textContent = 'Choose one file at a time.';
      return;
    }
    fileInput.files = event.dataTransfer.files;
    updateSelected();
  });
}
uploadForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const button = document.querySelector('#upload-submit');
  const status = document.querySelector('#upload-status');
  button.disabled = true;
  status.textContent = 'Uploading your file…';
  const xhr = new XMLHttpRequest();
  xhr.open('POST', uploadForm.action);
  xhr.setRequestHeader('x-csrf-token', csrf);
  xhr.setRequestHeader('Accept', 'application/json');
  xhr.timeout = 120000;
  xhr.upload.addEventListener('progress', (event) => {
    if (event.lengthComputable)
      status.textContent =
        event.loaded === event.total
          ? 'Saving your file…'
          : `Uploading… ${Math.round((event.loaded / event.total) * 100)}%`;
  });
  xhr.addEventListener('load', () => {
    button.disabled = false;
    let result;
    try {
      result = JSON.parse(xhr.responseText);
    } catch {
      result = { error: 'Upload failed. Please try again.' };
    }
    if (xhr.status >= 200 && xhr.status < 300) window.location.reload();
    else status.textContent = result.error || 'Upload failed. Please try again.';
  });
  function failed() {
    button.disabled = false;
    status.textContent = 'Could not complete the upload. Check your connection and try again.';
  }
  xhr.addEventListener('error', failed);
  xhr.addEventListener('timeout', failed);
  xhr.send(new FormData(uploadForm));
});
