// Shared by every panel: the read-only notice, hiding what read-only mode forbids, and the status line.
// Elements with the class "write" send or remove messages.
window.applyProtection = function (state) {
  const banner = document.getElementById('banner');
  banner.textContent = state.readOnly ? 'Read-only mode: sending, receiving and moving messages are disabled' : '';
  banner.classList.toggle('hidden', !state.readOnly);
  document.body.classList.toggle('read-only', !!state.readOnly);
};

// An error is shown as a box; `detail` is what the service answered, shown smaller under the explanation.
window.setStatus = function (text, isError, detail) {
  const status = document.getElementById('status');
  status.textContent = text || '';
  status.classList.toggle('error', !!isError);
  if (text && detail) {
    const small = document.createElement('div');
    small.className = 'detail';
    small.textContent = detail;
    status.appendChild(small);
  }
};
