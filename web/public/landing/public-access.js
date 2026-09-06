(() => {
  const dialog = document.querySelector('#public-access-dialog');
  if (!dialog) return;
  const form = dialog.querySelector('form');
  const heading = dialog.querySelector('#public-access-title');
  const success = dialog.querySelector('.public-access-success');
  const errorMessage = dialog.querySelector('.public-access-error');
  const submit = form.querySelector('[type=submit]');
  let opener;
  let scrollPosition = 0;

  document.querySelectorAll('[data-public-access-open]').forEach((button) => {
    button.addEventListener('click', () => {
      opener = button;
      scrollPosition = window.scrollY;
      dialog.showModal();
      document.body.classList.add('public-access-open');
      heading.focus({ preventScroll: true });
    });
  });

  const close = () => dialog.close();
  dialog.querySelectorAll('[data-public-access-close]').forEach((button) => {
    button.addEventListener('click', close);
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('click', (event) => {
    const bounds = dialog.getBoundingClientRect();
    if (
      event.target === dialog &&
      (event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom)
    ) {
      close();
    }
  });
  dialog.addEventListener('close', () => {
    document.body.classList.remove('public-access-open');
    window.scrollTo({ top: scrollPosition, behavior: 'instant' });
    opener?.focus({ preventScroll: true });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled || !form.reportValidity()) return;
    submit.disabled = true;
    submit.textContent = 'Sending…';
    form.setAttribute('aria-busy', 'true');
    errorMessage.hidden = true;
    const failure = 'Unable to send your request. Please try again.';
    try {
      const response = await fetch('/api/pilot-requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || typeof result?.message !== 'string') {
        throw new Error(typeof result?.error === 'string' ? result.error : failure);
      }
      form.hidden = true;
      dialog.querySelector('[data-public-access-message]').textContent = result.message;
      success.hidden = false;
      if (dialog.open) success.querySelector('button').focus({ preventScroll: true });
    } catch (error) {
      errorMessage.textContent = error instanceof TypeError ? failure : error.message || failure;
      errorMessage.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = 'Request access';
      form.removeAttribute('aria-busy');
    }
  });
})();
