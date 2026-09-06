const story = document.querySelector('.anchor-story');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const desktop = window.matchMedia('(min-width: 761px)');
const lamp = story.querySelector('.anchor-lamp');
const lampLit = story.querySelector('.lamp-lit');
const aura = story.querySelector('.anchor-aura');
const daylight = story.querySelector('.anchor-daylight');
const map = story.querySelector('.anchor-map');
const packet = story.querySelector('.anchor-paper');
const overviewHeading = document.querySelector('[data-reveal="overview-heading"]');
const proofComposition = document.querySelector('.proof-composition');
const coverageProof = document.querySelector('[data-reveal="coverage"]');
const coverageImage = coverageProof?.querySelector('img');
const packetProof = document.querySelector('[data-reveal="packet"]');
const workflow = document.querySelector('[data-reveal="workflow"]');
const workflowItems = [...(workflow?.querySelectorAll('li') ?? [])];
const progressProof = document.querySelector('[data-reveal="progress"]');
const projectorGlow = progressProof?.querySelector('.projector-glow');
const projectorHousing = progressProof?.querySelector('.projector-housing');
const projectorScreen = progressProof?.querySelector('.projector-screen');
const projectorRail = progressProof?.querySelector('.projector-rail');
const projectorPull = progressProof?.querySelector('.projector-pull');
const projectorCaption = progressProof?.querySelector('figcaption');
const progressVideo = projectorScreen?.querySelector('video');
if (progressVideo) {
  let visible = false;
  let reducedVideoMotion = reduceMotion.matches;

  function syncVideoPlayback() {
    if (visible && !document.hidden && !reducedVideoMotion) {
      progressVideo.play().catch(() => {});
    } else {
      progressVideo.pause();
    }
  }

  new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting && entry.intersectionRatio >= 0.25;
      syncVideoPlayback();
    },
    { threshold: 0.25 },
  ).observe(progressVideo);
  document.addEventListener('visibilitychange', syncVideoPlayback);
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (event) => {
    reducedVideoMotion = event.matches;
    syncVideoPlayback();
  });
}
const secondaryMotionElements = [
  overviewHeading,
  coverageProof,
  coverageImage,
  packetProof,
  ...workflowItems,
  projectorGlow,
  projectorHousing,
  projectorScreen,
  projectorRail,
  projectorPull,
  projectorCaption,
].filter(Boolean);
const pilotDialog = document.querySelector('#pilot-dialog');
const pilotHeading = document.querySelector('#pilot-dialog-title');
const pilotForm = document.querySelector('.drawer-form');
const pilotSuccess = document.querySelector('.drawer-success');
const pilotError = document.querySelector('.drawer-error');
const pilotMessage = document.querySelector('[data-pilot-message]');
const motion = { current: 0, target: 0 };
let animationFrame = 0;
let measureRequested = false;
let previousSecondaryFrame = null;
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

function viewportProgress(element, start = 0.94, finish = 0.5) {
  if (!element) return 1;
  const viewportPosition = element.getBoundingClientRect().top / Math.max(1, window.innerHeight);
  return clamp((start - viewportPosition) / (start - finish));
}

function stagedProgress(progress, start, duration) {
  return easeOut(clamp((progress - start) / duration));
}

function dynamicStoryEnabled() {
  return desktop.matches && !reduceMotion.matches;
}

function updateStep(progress) {
  const stepIndex = Math.min(4, Math.floor(clamp(progress) * 5));
  if (story.dataset.active === String(stepIndex)) return;
  story.dataset.active = String(stepIndex);
  story.querySelectorAll('.anchor-step').forEach((step) => {
    step.classList.toggle('is-current', Number(step.dataset.step) === stepIndex);
  });
}

function measureStory() {
  const enabled = dynamicStoryEnabled();
  if (enabled) {
    const rect = story.getBoundingClientRect();
    motion.target = clamp(-rect.top / Math.max(1, rect.height - window.innerHeight));
  }
  renderSecondaryMotion();
  if (!enabled) {
    document.body.classList.remove('is-daylight');
    return;
  }
  updateStep(motion.target);
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

function renderSecondaryMotion() {
  if (reduceMotion.matches) {
    if (previousSecondaryFrame === null) return;
    secondaryMotionElements.forEach((element) => {
      element.style.removeProperty('opacity');
      element.style.removeProperty('transform');
      element.style.removeProperty('clip-path');
    });
    previousSecondaryFrame = null;
    return;
  }

  const headingProgress = easeOut(viewportProgress(overviewHeading, 0.95, 0.55));
  const proofProgress = viewportProgress(proofComposition, 1, 0.12);
  const coverageProgress = easeOut(clamp(proofProgress / 0.75));
  const packetProgress = stagedProgress(proofProgress, 0.34, 0.6);
  const workflowProgress = viewportProgress(workflow);
  const projectorProgress = viewportProgress(progressProof, 1.02, 0.02);
  const projectorScreenHeight = projectorScreen?.offsetHeight ?? 0;
  const frame = [
    headingProgress,
    proofProgress,
    workflowProgress,
    projectorProgress,
    projectorScreenHeight,
  ];
  if (previousSecondaryFrame?.every((value, index) => value === frame[index])) return;
  previousSecondaryFrame = frame;

  if (overviewHeading) {
    overviewHeading.style.opacity = headingProgress.toFixed(3);
    overviewHeading.style.transform = `translate3d(0, ${mix(32, 0, headingProgress).toFixed(1)}px, 0)`;
  }
  if (coverageProof) {
    coverageProof.style.opacity = mix(0.15, 1, coverageProgress).toFixed(3);
    coverageProof.style.clipPath = `circle(${mix(10, 100, proofProgress).toFixed(2)}% at 50% 50%)`;
    coverageProof.style.transform =
      `translate3d(${mix(-76, 0, coverageProgress).toFixed(1)}px, ${mix(32, 0, coverageProgress).toFixed(1)}px, 0) ` +
      `scale(${mix(0.955, 1, coverageProgress).toFixed(3)})`;
  }
  if (coverageImage)
    coverageImage.style.transform = `scale(${mix(1.08, 1, proofProgress).toFixed(3)})`;
  if (packetProof) {
    packetProof.style.opacity = packetProgress.toFixed(3);
    packetProof.style.transform =
      `translate3d(${mix(140, 0, packetProgress).toFixed(1)}px, ${mix(96, 0, packetProgress).toFixed(1)}px, 0) ` +
      `rotate(${mix(9, 2, packetProgress).toFixed(2)}deg) scale(${mix(0.92, 1, packetProgress).toFixed(3)})`;
  }
  workflowItems.forEach((item, index) => {
    const itemProgress = stagedProgress(workflowProgress, index * 0.06, 1 - index * 0.06);
    item.style.opacity = itemProgress.toFixed(3);
    item.style.transform = `translate3d(0, ${mix(24, 0, itemProgress).toFixed(1)}px, 0)`;
  });

  const frameProgress = stagedProgress(projectorProgress, 0, 0.22);
  const screenProgress = clamp((projectorProgress - 0.06) / 0.8);
  const glowProgress = easeOut(screenProgress);
  const detailProgress = stagedProgress(projectorProgress, 0.36, 0.52);
  const pullProgress = stagedProgress(projectorProgress, 0.48, 0.36);
  const screenTravel = mix(-projectorScreenHeight, 0, screenProgress);

  if (projectorHousing) {
    projectorHousing.style.opacity = frameProgress.toFixed(3);
    projectorHousing.style.transform = `translate3d(0, ${mix(-22, 0, frameProgress).toFixed(1)}px, 0)`;
  }
  if (projectorScreen) {
    projectorScreen.style.opacity = mix(0.35, 1, screenProgress).toFixed(3);
    projectorScreen.style.clipPath = `inset(0 0 ${mix(100, 0, screenProgress).toFixed(2)}% 0)`;
  }
  if (projectorGlow) {
    projectorGlow.style.opacity = glowProgress.toFixed(3);
    projectorGlow.style.transform = `scale(${mix(0.65, 1, glowProgress).toFixed(3)})`;
  }
  if (projectorRail) {
    projectorRail.style.opacity = frameProgress.toFixed(3);
    projectorRail.style.transform = `translate3d(0, ${screenTravel.toFixed(1)}px, 0)`;
  }
  if (projectorCaption) {
    projectorCaption.style.opacity = detailProgress.toFixed(3);
    projectorCaption.style.transform = `translate3d(0, ${mix(28, 0, detailProgress).toFixed(1)}px, 0)`;
  }
  if (projectorPull) {
    projectorPull.style.opacity = pullProgress.toFixed(3);
    projectorPull.style.transform = `translate3d(-50%, ${screenTravel.toFixed(1)}px, 0)`;
  }
}

function requestFrame() {
  if (!animationFrame) animationFrame = window.requestAnimationFrame(runMotion);
}

function runMotion() {
  animationFrame = 0;
  if (measureRequested) {
    measureRequested = false;
    measureStory();
  }
  if (!dynamicStoryEnabled()) return;
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
  measureRequested = true;
  requestFrame();
}

function openPilot(event) {
  pilotOpener = event?.currentTarget ?? null;
  pilotScroll = window.scrollY;
  pilotDialog.showModal();
  document.body.classList.add('drawer-open');
  pilotHeading.focus({ preventScroll: true });
}

function closePilot() {
  if (!pilotDialog.open) return;
  pilotDialog.close();
  document.body.classList.remove('drawer-open');
  window.scrollTo({ top: pilotScroll, behavior: 'instant' });
  const currentUrl = new URL(window.location.href);
  if (currentUrl.searchParams.get('request') === 'access') {
    currentUrl.searchParams.delete('request');
    window.history.replaceState(
      {},
      '',
      `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
    );
  }
  pilotOpener?.focus({ preventScroll: true });
}

document.querySelectorAll('[data-pilot-open]').forEach((button) => {
  button.addEventListener('click', openPilot);
});

document.querySelectorAll('[data-pilot-close]').forEach((button) => {
  button.addEventListener('click', closePilot);
});

pilotDialog?.addEventListener('cancel', (event) => {
  event.preventDefault();
  closePilot();
});

pilotDialog?.addEventListener('click', (event) => {
  const bounds = pilotDialog.getBoundingClientRect();
  if (
    event.target === pilotDialog &&
    (event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom)
  ) {
    closePilot();
  }
});

pilotForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = pilotForm.querySelector('[type=submit]');
  if (submit.disabled || !pilotForm.reportValidity()) return;
  submit.disabled = true;
  pilotError.hidden = true;
  const failure = 'Unable to send your request. Please try again.';
  try {
    const response = await fetch('/api/pilot-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(pilotForm))),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || typeof result?.message !== 'string') {
      throw new Error(typeof result?.error === 'string' ? result.error : failure);
    }
    pilotForm.hidden = true;
    pilotMessage.textContent = result.message;
    pilotSuccess.hidden = false;
    if (pilotDialog.open)
      pilotSuccess.querySelector('[data-pilot-close]').focus({ preventScroll: true });
  } catch (error) {
    pilotError.textContent = error instanceof TypeError ? failure : error.message || failure;
    pilotError.hidden = false;
  } finally {
    submit.disabled = false;
  }
});

window.addEventListener('scroll', resetPresentation, { passive: true });
window.addEventListener('resize', resetPresentation);
reduceMotion.addEventListener('change', resetPresentation);
desktop.addEventListener('change', resetPresentation);
resetPresentation();

if (pilotDialog && new URLSearchParams(window.location.search).get('request') === 'access') {
  openPilot();
}
