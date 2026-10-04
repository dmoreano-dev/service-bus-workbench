// Webview script for the messages panel. Message content is untrusted: only ever set it via textContent.
(function () {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);

  let messages = [];
  let selected = -1;
  // Indexes of the rows ticked for a bulk resend.
  const checked = new Set();
  let busy = false;

  const count = () => Math.min(500, Math.max(1, parseInt($('count').value, 10) || 1));

  $('peek').addEventListener('click', () => vscode.postMessage({ type: 'peek', count: count() }));
  $('more').addEventListener('click', () => vscode.postMessage({ type: 'more', count: count() }));
  $('receiveDelete').addEventListener('click', () => vscode.postMessage({ type: 'receiveDelete', count: count() }));
  // With rows ticked, moves those; otherwise the oldest `count`.
  const ticked = () => [...checked].sort((a, b) => a - b);
  $('moveBack').addEventListener('click', () => vscode.postMessage({ type: 'moveBack', count: count(), indexes: ticked() }));
  $('resendSelected').addEventListener('click', () => {
    if (checked.size > 0) {
      vscode.postMessage({ type: 'resendMany', indexes: ticked() });
    }
  });
  $('checkAll').addEventListener('change', () => {
    checked.clear();
    if ($('checkAll').checked) {
      messages.forEach((_, index) => checked.add(index));
    }
    renderRows();
  });
  $('resend').addEventListener('click', () => {
    if (selected >= 0) {
      vscode.postMessage({ type: 'resend', index: selected });
    }
  });

  window.addEventListener('message', (event) => {
    const m = event.data;
    switch (m.type) {
      case 'init':
        $('count').value = m.count;
        $('moveBack').classList.toggle('hidden', !m.deadLetter);
        window.applyProtection(m);
        break;
      case 'protection':
        window.applyProtection(m);
        break;
      case 'messages':
        if (m.append) {
          messages = messages.concat(m.messages);
        } else {
          messages = m.messages;
          selected = -1;
          checked.clear();
        }
        renderRows();
        renderDetails();
        break;
      case 'status':
        setStatus(m.text, false);
        break;
      case 'busy':
        busy = m.busy;
        updateButtons();
        $('loading').classList.toggle('hidden', !m.busy);
        if (m.busy) {
          $('loadingText').textContent = m.text || 'Working…';
          setStatus('', false);
        }
        break;
      case 'error':
        setStatus(m.text, true);
        break;
    }
  });

  function setStatus(text, isError) {
    $('status').textContent = text || '';
    $('status').classList.toggle('error', isError);
  }

  function updateButtons() {
    for (const button of document.querySelectorAll('button')) {
      button.disabled = busy;
    }
    $('resendSelected').disabled = busy || checked.size === 0;
    $('resendSelected').textContent = checked.size > 0 ? `Resend selected (${checked.size})…` : 'Resend selected…';
    $('moveBack').textContent = checked.size > 0 ? `Move back selected (${checked.size})…` : 'Move back…';
    $('checkAll').checked = messages.length > 0 && checked.size === messages.length;
  }

  function checkCell(row, index) {
    const td = document.createElement('td');
    td.className = 'check';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = checked.has(index);
    box.addEventListener('change', () => {
      if (box.checked) {
        checked.add(index);
      } else {
        checked.delete(index);
      }
      updateButtons();
    });
    // Ticking a row must not open its details.
    td.addEventListener('click', (event) => event.stopPropagation());
    td.appendChild(box);
    row.appendChild(td);
  }

  function cell(row, text) {
    const td = document.createElement('td');
    td.textContent = text === undefined || text === null ? '' : String(text);
    td.title = td.textContent;
    row.appendChild(td);
  }

  function formatTime(iso) {
    return iso ? new Date(iso).toLocaleString() : '';
  }

  function renderRows() {
    const rows = $('rows');
    rows.replaceChildren();
    updateButtons();
    if (messages.length === 0) {
      const row = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.className = 'empty';
      td.textContent = 'No messages.';
      row.appendChild(td);
      rows.appendChild(row);
      return;
    }
    messages.forEach((message, index) => {
      const row = document.createElement('tr');
      row.classList.toggle('selected', index === selected);
      checkCell(row, index);
      cell(row, message.sequenceNumber);
      cell(row, formatTime(message.enqueuedTime));
      cell(row, message.messageId);
      cell(row, message.subject);
      cell(row, message.deliveryCount);
      cell(row, message.body.replace(/\s+/g, ' ').slice(0, 200));
      row.addEventListener('click', () => {
        selected = index;
        renderRows();
        renderDetails();
      });
      rows.appendChild(row);
    });
  }

  function prettyBody(body) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }

  function renderDetails() {
    const message = messages[selected];
    $('details').classList.toggle('hidden', !message);
    if (!message) {
      return;
    }
    $('detailsTitle').textContent = `Message #${message.sequenceNumber ?? '?'}`;
    const props = $('props');
    props.replaceChildren();
    const add = (name, value) => {
      if (value === undefined || value === null || value === '') {
        return;
      }
      const dt = document.createElement('dt');
      dt.textContent = name;
      const dd = document.createElement('dd');
      dd.textContent = typeof value === 'object' ? JSON.stringify(value) : String(value);
      props.append(dt, dd);
    };
    add('Message ID', message.messageId);
    add('Enqueued', formatTime(message.enqueuedTime));
    add('Expires', formatTime(message.expiresAt));
    add('Subject', message.subject);
    add('Content type', message.contentType);
    add('Correlation ID', message.correlationId);
    add('Session ID', message.sessionId);
    add('Delivery count', message.deliveryCount);
    add('State', message.state);
    add('Dead-letter reason', message.deadLetterReason);
    add('Dead-letter description', message.deadLetterErrorDescription);
    add('Dead-letter source', message.deadLetterSource);
    for (const [key, value] of Object.entries(message.applicationProperties || {})) {
      add(`[app] ${key}`, value);
    }
    $('body').textContent = prettyBody(message.body);
  }

  vscode.postMessage({ type: 'ready' });
})();
