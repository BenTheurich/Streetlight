(() => {
  const page = document.querySelector('.public-page');
  if (!page) return;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const easing = 'cubic-bezier(0.16, 1, 0.3, 1)';

  const header = page.querySelector('.public-shell-header');
  const updateHeaderHeight = () => {
    document.documentElement.style.setProperty(
      '--public-header-height',
      `${header.offsetHeight}px`,
    );
  };
  updateHeaderHeight();
  new ResizeObserver(updateHeaderHeight).observe(header);
  // Re-align an initial fragment after measuring the mobile header.
  page.querySelector(':target')?.scrollIntoView({ behavior: 'instant' });

  const path = page.querySelector('.workflow-path');
  if (path) {
    const numbers = [...page.querySelectorAll('.step-number')];
    const drawPath = () => {
      const origin = path.getBoundingClientRect();
      const positions = numbers.map((number) => {
        const range = document.createRange();
        range.selectNodeContents(number);
        const glyph = range.getBoundingClientRect();
        const box = number.getBoundingClientRect();
        return {
          x: glyph.left + glyph.width / 2 - origin.left,
          top: box.top - origin.top,
          bottom: box.bottom - origin.top,
        };
      });
      path.querySelectorAll('line').forEach((line, index) => {
        line.setAttribute('x1', positions[index].x);
        line.setAttribute('y1', positions[index].bottom + 16);
        line.setAttribute('x2', positions[index + 1].x);
        line.setAttribute('y2', positions[index + 1].top - 16);
      });
      path.style.visibility = 'visible';
    };
    new ResizeObserver(drawPath).observe(path.parentElement);
    document.fonts.ready.then(drawPath);
  }

  page.querySelectorAll('.pricing-faq details').forEach((details) => {
    const summary = details.querySelector('summary');
    const answer = details.querySelector('.faq-answer');
    let expanded = details.open;
    let animation;

    summary.addEventListener('click', (event) => {
      event.preventDefault();
      const start = answer.getBoundingClientRect().height;
      animation?.cancel();
      expanded = !expanded;
      if (reducedMotion.matches) {
        details.open = expanded;
        return;
      }
      details.open = true;
      animation = answer.animate(
        { height: [`${start}px`, `${expanded ? answer.scrollHeight : 0}px`] },
        { duration: expanded ? 280 : 200, easing, fill: 'both' },
      );
      animation.onfinish = () => {
        details.open = expanded;
        animation.cancel();
        animation = null;
      };
    });
  });

  const figures = [...page.querySelectorAll('.progress-frames > figure')];
  let frame;

  function renderScrollMotion() {
    frame = null;
    // Measure the stationary figures before transforming their images.
    const positions = figures.map((figure) => figure.getBoundingClientRect().top / innerHeight);
    figures.forEach((figure, index) => {
      const image = figure.querySelector('img');
      const progress = reducedMotion.matches
        ? 1
        : Math.min(1, Math.max(0, (1 - positions[index] - index * 0.06) / 0.75));
      if (progress === 1) {
        image.style.removeProperty('opacity');
        image.style.removeProperty('clip-path');
        return;
      }
      const remaining = (1 - progress) ** 3;
      image.style.opacity = (1 - remaining * 0.65).toFixed(3);
      image.style.clipPath = `inset(0 0 ${(1 - progress) * 100}% 0)`;
    });
  }

  function requestScrollFrame() {
    if (!frame) frame = requestAnimationFrame(renderScrollMotion);
  }

  if (figures.length) {
    window.addEventListener('scroll', requestScrollFrame, { passive: true });
    window.addEventListener('resize', requestScrollFrame);
    new ResizeObserver(requestScrollFrame).observe(page);
    requestScrollFrame();
  }

  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches)
      page.getAnimations({ subtree: true }).forEach((animation) => {
        animation.finish();
      });
    requestScrollFrame();
  });
})();
