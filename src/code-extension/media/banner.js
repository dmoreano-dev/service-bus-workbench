// Shared by every panel: the read-only notice, and hiding what read-only mode forbids.
// Elements with the class "write" send or remove messages.
window.applyProtection = function (state) {
  const banner = document.getElementById('banner');
  banner.textContent = state.readOnly ? 'Read-only mode: sending, receiving and moving messages are disabled' : '';
  banner.classList.toggle('hidden', !state.readOnly);
  document.body.classList.toggle('read-only', !!state.readOnly);
};
