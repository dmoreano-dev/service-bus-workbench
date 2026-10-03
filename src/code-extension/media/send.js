// Webview script for the send form.
(function () {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const TEXT_FIELDS = ['contentType', 'subject', 'messageId', 'correlationId', 'sessionId'];

  function setStatus(text, isError) {
    $('status').textContent = text || '';
    $('status').classList.toggle('error', isError);
  }

  /** Returns the parsed application properties, or throws with a message for the user. */
  function readApplicationProperties() {
    const raw = $('applicationProperties').value.trim();
    if (!raw) {
      return undefined;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('Application properties must be valid JSON.');
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Application properties must be a JSON object, e.g. {"tenant": "acme"}.');
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (!['string', 'number', 'boolean'].includes(typeof value)) {
        throw new Error(`Application property "${key}" must be a string, number or boolean.`);
      }
    }
    return parsed;
  }

  $('form').addEventListener('submit', (event) => {
    event.preventDefault();
    let applicationProperties;
    try {
      applicationProperties = readApplicationProperties();
    } catch (err) {
      setStatus(err.message, true);
      return;
    }
    const message = { body: $('body').value, applicationProperties };
    for (const field of TEXT_FIELDS) {
      const value = $(field).value.trim();
      if (value) {
        message[field] = value;
      }
    }
    vscode.postMessage({ type: 'send', message });
  });

  $('format').addEventListener('click', () => {
    try {
      $('body').value = JSON.stringify(JSON.parse($('body').value), null, 2);
      setStatus('', false);
    } catch {
      setStatus('The body is not valid JSON.', true);
    }
  });

  window.addEventListener('message', (event) => {
    const m = event.data;
    switch (m.type) {
      case 'init': {
        $('target').textContent = m.target;
        $('origin').textContent = m.origin;
        $('origin').classList.toggle('hidden', !m.origin);
        $('body').value = m.message.body || '';
        for (const field of TEXT_FIELDS) {
          $(field).value = m.message[field] || '';
        }
        const props = m.message.applicationProperties;
        $('applicationProperties').value = props && Object.keys(props).length ? JSON.stringify(props, null, 2) : '';
        break;
      }
      case 'busy':
        $('send').disabled = m.busy;
        if (m.busy) {
          setStatus('Sending…', false);
        }
        break;
      case 'result':
        setStatus(m.text, !m.ok);
        break;
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
