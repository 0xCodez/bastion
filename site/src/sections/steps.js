import { reveal } from '../fx/reveal.js';

/* steps: "Five things to do tonight, with or without Bastion". A real sequence, so an <ol>. */

const STEPS = [
  {
    title: 'Change the router admin password from the one on the sticker',
    why: 'Anyone on your Wi-Fi who has seen the sticker, or knows the model’s default, can log in and change everything.',
    where: 'Your router’s admin page, often 192.168.0.1 or 192.168.1.1, under Administration or System.',
  },
  {
    title: 'Turn on encrypted DNS',
    why: 'With DNS-over-HTTPS, your provider stops seeing a plain-text list of every site your devices look up.',
    where:
      'Windows 11: Settings → Network & internet → your connection → DNS server assignment. Elsewhere: on the router, or with your DNS provider’s profile or app.',
  },
  {
    title: 'Turn on Private Wi-Fi Address (Apple) or Random hardware addresses (Windows)',
    why: 'Your device shows each network a different hardware address, which makes it harder to follow from place to place.',
    where:
      'iPhone, iPad, Mac: the Wi-Fi network’s details → Private Wi-Fi Address. Windows: Settings → Network & internet → Wi-Fi → Random hardware addresses.',
  },
  {
    title: 'Add <code>_nomap</code> to the end of your Wi-Fi name',
    why: 'Google and Apple leave networks whose name ends in _nomap out of the location maps they build from Wi-Fi names.',
    where: 'Router admin page → Wireless, for example HomeNet_nomap. Every device will need to reconnect once.',
  },
  {
    title: 'Turn off WPS and UPnP if you don’t need them',
    why: 'A WPS PIN can be guessed, and UPnP lets any device on your network open a port to the internet without asking.',
    where: 'Router admin page → Wireless (WPS) and Advanced or NAT (UPnP). Some game consoles rely on UPnP; switch it back on if online play breaks.',
  },
];

export function mount(el) {
  if (!el) return;
  el.setAttribute('aria-labelledby', 'steps-title');

  const items = STEPS.map(
    (s, i) => `
      <li class="st-item" data-reveal style="--reveal-delay:${(i * 0.06).toFixed(2)}s">
        <span class="st-num" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>
        <div class="st-card glass">
          <h3 class="st-title"><span class="sr-only">Step ${i + 1}: </span>${s.title}</h3>
          <p class="st-why"><span class="st-label">Why</span>${s.why}</p>
          <p class="st-where"><span class="st-label">Where</span>${s.where}</p>
        </div>
      </li>`,
  ).join('');

  el.innerHTML = `
    <div class="container st">
      <header class="st-intro" data-reveal>
        <p class="eyebrow">Tonight</p>
        <h2 class="display-l" id="steps-title">Five things to do tonight, with or without Bastion</h2>
        <p class="lead">No new hardware and no account. Each one is a switch or a field in settings you already have, so you can do all five before bed.</p>
        <p class="st-note">
          <span class="st-note__dot" aria-hidden="true"></span>
          <span>Bastion’s scan flags the ones it can see from your computer, like UPnP, WPS, plain-text DNS, a missing <code>_nomap</code> and this computer’s hardware-address setting. It can’t check your admin password, because it never tries one.</span>
        </p>
      </header>
      <ol class="st-list" role="list">${items}
      </ol>
    </div>`;

  reveal(el);
}
