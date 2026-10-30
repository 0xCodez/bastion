import { reveal } from '../fx/reveal.js';
import { flare } from '../fx/flare.js';

const ICONS = {
  // broadcast tower: a channel someone else can talk through
  remote:
    '<path d="M12 12.5V21"/><path d="M9 21h6"/><circle cx="12" cy="10.5" r="2"/><path d="M8.2 6.8a5.3 5.3 0 0 0 0 7.4M15.8 6.8a5.3 5.3 0 0 1 0 7.4"/><path d="M5.4 4a9.3 9.3 0 0 0 0 13M18.6 4a9.3 9.3 0 0 1 0 13"/>',
  // an eye: lookups readable on the way
  eye:
    '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  // a box with an arrow leaving it: a port opened outward
  port:
    '<rect x="3.5" y="12" width="17" height="8.5" rx="2"/><path d="M7.5 16.2h.01M11 16.2h.01"/><path d="M15.5 9V2.8M12.6 5.6l2.9-2.9 2.9 2.9"/>',
  // TV with a standby dot and an outgoing signal
  tv:
    '<rect x="2.5" y="6" width="19" height="12.5" rx="2.2"/><path d="M8.5 21.5h7"/><circle cx="18" cy="15.4" r=".9" fill="currentColor" stroke="none"/><path d="M15.6 3.4a2.8 2.8 0 0 1 2.5 2.4M15.6 1a5.2 5.2 0 0 1 4.9 4.8"/>',
};

const CARDS = [
  {
    tone: 'var(--coral)',
    icon: 'remote',
    tag: 'TR-069 · port 7547',
    title: 'Your provider keeps a remote control',
    body:
      'TR-069, also called CWMP, lets your internet provider reach the router over port 7547 to change its settings and push new firmware. It works whether or not you ever open the admin page.',
  },
  {
    tone: 'var(--amber)',
    icon: 'eye',
    tag: 'DNS · plain text',
    title: 'Every site you visit, in plain text',
    body:
      'Before any page loads, your device asks a DNS server where the site lives. By default that question goes to your provider unencrypted, so the provider, and anyone on the path, can read the list.',
  },
  {
    tone: 'var(--lavender)',
    icon: 'port',
    tag: 'UPnP · auto port-forwards',
    title: 'Devices open doors on their own',
    body:
      'With UPnP switched on, any app or gadget on your network can ask the router to forward a port from the internet to itself. There is no password and no prompt, and the forward stays until something removes it.',
  },
  {
    tone: 'var(--sky)',
    icon: 'tv',
    tag: 'Smart TV · set-top box',
    title: 'The TV keeps talking with the screen off',
    body:
      'Smart TVs and set-top boxes often keep sending usage and viewing data to the maker’s servers while they sit in standby. Nothing on the screen tells you it is happening.',
  },
];

function icon(name) {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

export function mount(el) {
  if (!el) return;
  el.setAttribute('aria-labelledby', 'problem-title');

  const cards = CARDS.map(
    (c, i) => `
      <li class="pb-cell" data-reveal style="--tone:${c.tone};--reveal-delay:${(i * 0.08).toFixed(2)}s">
       <div class="pb-card glass">
        <div class="pb-card__top">
          <span class="pb-ic">${icon(c.icon)}</span>
          <span class="pb-tag mono">${c.tag}</span>
        </div>
        <h3 class="pb-card__title">${c.title}</h3>
        <p class="pb-card__body">${c.body}</p>
       </div>
      </li>`,
  ).join('');

  el.innerHTML = `
    <div class="container">
      <header class="sec-head pb-head" data-reveal>
        <p class="eyebrow">The quiet part</p>
        <h2 class="display-l" id="problem-title">What your router does behind your back</h2>
        <p class="lead">Home routers and the gadgets around them ship with features that serve the provider or the device maker first. None of them ask you, and none of them make noise.</p>
      </header>
      <ul class="pb-grid" role="list">${cards}
      </ul>
      <p class="pb-foot" data-reveal>
        <span class="pb-foot__dot" aria-hidden="true"></span>
        Bastion checks for the first three from your computer and walks you through switching each one off. TV traffic needs router integration, which is on the roadmap; for now, Bastion lists those devices on your network.
      </p>
    </div>`;

  el.querySelectorAll('.pb-card').forEach((card) => {
    flare(card, { y: 0 });
  });

  reveal(el);
}
