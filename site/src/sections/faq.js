import { reveal } from '../fx/reveal.js';

/* faq: native <details> accordion. Works without JS; JS only adds a height animation. */

const REPO = 'https://github.com/0xCodez/bastion';
const RELEASES = `${REPO}/releases/latest`;

const QA = [
  {
    q: 'Is it really free?',
    a: `<p>Yes. Bastion is free and open source under the MIT licence, and there is no account to create. If you use the AI watchers, your AI provider bills your own key for what you use. Bastion adds nothing on top and never sees the bill.</p>`,
  },
  {
    q: 'Does it change my router settings?',
    a: `<p>No. Bastion never logs in to your router, never tries a password and never changes a setting on its own. Each fix is a guided fix: the steps, plus a button that opens the right settings page or your router’s admin page. You make the change.</p>`,
  },
  {
    q: 'Do I need an API key?',
    a: `<p>No. The scan, the connections view, the Wi-Fi channel advice and the speed test all work without one. A key from Anthropic, OpenAI or xAI is only needed for the AI watchers, and you can add or remove it at any time.</p>`,
  },
  {
    q: 'Which AI is best?',
    a: `<p>The one you already have a key for. Claude, ChatGPT and Grok all receive the same trimmed snapshot of your scan and can answer the same questions. You can connect more than one and ask each of them, then see where they agree.</p>`,
  },
  {
    q: 'Will it slow my network?',
    a: `<p>No. The scan talks only to your router’s local address and uses standard local discovery, so it is light. The one thing that uses real bandwidth is the speed test, and it only runs when you press the button.</p>`,
  },
  {
    q: 'Does it work on macOS?',
    a: `<p>Yes. There are builds for macOS 13 and later, for both Apple Silicon and Intel, and for Windows 10 and 11. The builds are not code-signed yet, so the first launch shows a system warning; the <a href="${REPO}#install" rel="noopener">install notes</a> walk you through it.</p>`,
  },
  {
    q: 'Can it see my family’s traffic?',
    a: `<p>Not yet. Bastion sees which programs on your computer connect where. Seeing traffic from phones, TVs and other devices needs router integration, which is on the roadmap.</p><p>It also can’t prove from inside your network that a port is reachable from the internet. When that matters, the finding says so plainly.</p>`,
  },
  {
    q: 'Why open source?',
    a: `<p>Because a tool that looks at your network should be one you can read. Every line is on <a href="${REPO}" rel="noopener">GitHub</a>: you can check exactly what leaves your machine, build it yourself, or report a problem.</p>`,
  },
];

const RM = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

/* Smooth open/close for <details>. Native behaviour stays the source of truth. */
function animate(details) {
  const summary = details.querySelector('summary');
  const body = details.querySelector('.fq-a');
  let anim = null;

  summary.addEventListener('click', (e) => {
    if (RM.matches || !body.animate) return;
    e.preventDefault();
    if (anim) anim.cancel();
    if (details.open) {
      const h = body.offsetHeight;
      details.classList.add('is-closing');
      anim = body.animate([{ height: `${h}px`, opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' });
      anim.onfinish = () => { details.open = false; details.classList.remove('is-closing'); anim = null; };
      anim.oncancel = () => { details.classList.remove('is-closing'); };
    } else {
      details.open = true;
      const h = body.offsetHeight;
      anim = body.animate([{ height: '0px', opacity: 0 }, { height: `${h}px`, opacity: 1 }], { duration: 360, easing: 'cubic-bezier(.16,1,.3,1)' });
      anim.onfinish = () => { anim = null; };
    }
  });
}

export function mount(el) {
  if (!el) return;
  el.setAttribute('aria-labelledby', 'faq-title');

  const items = QA.map(
    (x, i) => `
        <details class="fq-item" id="faq-${i + 1}">
          <summary class="fq-q">
            <span class="fq-qt">${x.q}</span>
            <span class="fq-plus" aria-hidden="true"></span>
          </summary>
          <div class="fq-a"><div class="fq-ai">${x.a}</div></div>
        </details>`,
  ).join('');

  el.innerHTML = `
    <div class="container fq">
      <header class="fq-intro" data-reveal>
        <p class="eyebrow">Questions</p>
        <h2 class="display-l" id="faq-title">Straight answers</h2>
        <p class="lead">The things people ask before they install a network tool, answered without the small print.</p>
        <div class="fq-links">
          <a class="btn btn--ghost btn--sm" href="${REPO}/issues" rel="noopener">Ask on GitHub</a>
          <a class="fq-link" href="${RELEASES}" rel="noopener">Latest release notes</a>
        </div>
      </header>
      <div class="fq-list glass" data-reveal style="--reveal-delay:.08s">${items}
      </div>
    </div>`;

  el.querySelectorAll('.fq-item').forEach(animate);
  reveal(el);
}
