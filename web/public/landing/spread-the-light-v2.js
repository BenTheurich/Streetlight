const story = document.querySelector('.anchor-story');
const toast = document.querySelector('.demo-toast');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const desktop = window.matchMedia('(min-width: 761px)');
const lamp = story.querySelector('.anchor-lamp');
const lampLit = story.querySelector('.lamp-lit');
const aura = story.querySelector('.anchor-aura');
const daylight = story.querySelector('.anchor-daylight');
const map = story.querySelector('.anchor-map');
const packet = story.querySelector('.anchor-paper');
const pilotDialog = document.querySelector('#pilot-dialog');
const pilotHeading = document.querySelector('#pilot-dialog-title');
const pilotForm = document.querySelector('.drawer-form');
const pilotSuccess = document.querySelector('.drawer-success');
const pilotError = document.querySelector('.drawer-error');
const pilotMessage = document.querySelector('[data-pilot-message]');
const motion = { current: 0, target: 0 };
let animationFrame = 0;
let pilotOpener = null;
let pilotScroll = 0;

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function easeOut(value) {
  return 1 - (1 - value) ** 3;
}

function mix(from, to, amount) {
  return from + (to - from) * amount;
}

function dynamicStoryEnabled() {
  return desktop.matches && !reduceMotion.matches;
}

function updateStep(progress) {
  const stepIndex = Math.min(5, Math.floor(clamp(progress) * 6));
  story.dataset.active = String(stepIndex);
  story.querySelectorAll('.anchor-step').forEach((step) => {
    step.classList.toggle('is-current', Number(step.dataset.step) === stepIndex);
  });
}

function measureStory() {
  if (!dynamicStoryEnabled()) {
    document.body.classList.remove('is-daylight');
    return;
  }
  const rect = story.getBoundingClientRect();
  motion.target = clamp(-rect.top / Math.max(1, rect.height - window.innerHeight));
  updateStep(motion.target);
  requestFrame();
}

function render(progress) {
  const ignition = easeOut(clamp((progress - 0.305) / 0.17));
  const sunrise = easeOut(clamp((progress - 0.435) / 0.18));
  const settles = easeOut(clamp((progress - 0.53) / 0.32));
  const mapAppears = easeOut(clamp((progress - 0.59) / 0.14));
  const packetAppears = easeOut(clamp((progress - 0.81) / 0.14));

  story.classList.toggle('is-daylight', sunrise > 0.42);
  story.classList.toggle('has-light-copy', sunrise > 0.08);
  document.body.classList.toggle('is-daylight', sunrise > 0.42);
  lamp.style.transform =
    `translate3d(-50%, ${mix(0, window.innerHeight * 0.33, settles).toFixed(1)}px, 0) ` +
    `scale(${mix(1.08, 0.62, settles).toFixed(3)})`;
  lampLit.style.opacity = ignition.toFixed(3);
  aura.style.opacity = (ignition * (1 - sunrise * 0.52)).toFixed(3);
  aura.style.transform = `translate(-50%, -50%) scale(${(0.4 + ignition * 1.25 + sunrise * 1.8).toFixed(3)})`;
  daylight.style.transform = `translate(-50%, -50%) scale(${(sunrise * 7.2).toFixed(3)})`;
  map.style.opacity = mapAppears.toFixed(3);
  map.style.transform = `scale(${mix(0.95, 1, mapAppears).toFixed(3)}) translateY(${mix(34, 0, mapAppears).toFixed(1)}px)`;
  packet.style.opacity = packetAppears.toFixed(3);
  packet.style.transform = `translate3d(0, ${mix(125, 0, packetAppears).toFixed(1)}%, 0) rotate(${mix(-6, -2, packetAppears).toFixed(2)}deg)`;
}

function requestFrame() {
  if (!animationFrame) animationFrame = window.requestAnimationFrame(runMotion);
}

function runMotion() {
  animationFrame = 0;
  const difference = motion.target - motion.current;
  if (Math.abs(difference) > 0.0004) {
    motion.current += difference * 0.13;
    requestFrame();
  } else {
    motion.current = motion.target;
  }
  render(motion.current);
}

function resetPresentation() {
  if (dynamicStoryEnabled()) {
    measureStory();
  } else {
    document.body.classList.remove('is-daylight');
  }
}

function openPilot(event) {
  pilotOpener = event.currentTarget;
  pilotScroll = window.scrollY;
  pilotForm.hidden = false;
  pilotForm.reset();
  pilotSuccess.hidden = true;
  pilotError.hidden = true;
  pilotError.textContent = '';
  pilotDialog.showModal();
  document.body.classList.add('drawer-open');
  pilotHeading.focus();
}

function closePilot() {
  if (!pilotDialog.open) return;
  pilotDialog.close();
  document.body.classList.remove('drawer-open');
  window.scrollTo({ top: pilotScroll, behavior: 'instant' });
  pilotOpener?.focus();
}

document.querySelectorAll('[data-pilot-open]').forEach((button) => {
  button.addEventListener('click', openPilot);
});

document.querySelectorAll('[data-pilot-close]').forEach((button) => {
  button.addEventListener('click', closePilot);
});

pilotDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  closePilot();
});

pilotDialog.addEventListener('click', (event) => {
  if (event.target === pilotDialog) closePilot();
});

pilotForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!pilotForm.reportValidity()) return;
  const submit = pilotForm.querySelector('[type=submit]');
  submit.disabled = true;
  pilotError.hidden = true;
  try {
    const response = await fetch('/api/pilot-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(pilotForm))),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to send your request');
    pilotForm.hidden = true;
    pilotMessage.textContent = result.message;
    pilotSuccess.hidden = false;
    pilotSuccess.querySelector('[data-pilot-close]').focus();
  } catch (error) {
    pilotError.textContent = error instanceof Error ? error.message : 'Unable to send your request';
    pilotError.hidden = false;
  } finally {
    submit.disabled = false;
  }
});

document.querySelectorAll('[data-demo]').forEach((button) => {
  button.addEventListener('click', () => {
    toast.textContent = 'Administrator sign-in will be available to invited pilot churches.';
    toast.classList.add('is-visible');
    window.setTimeout(() => toast.classList.remove('is-visible'), 2600);
  });
});

window.addEventListener('scroll', measureStory, { passive: true });
window.addEventListener('resize', measureStory);
reduceMotion.addEventListener('change', resetPresentation);
desktop.addEventListener('change', resetPresentation);
resetPresentation();
