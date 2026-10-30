import { reveal } from '../fx/reveal.js';

/* privacy: exactly what leaves the machine, and what never does. Facts match the app's README
   and agents/prompt.js (the single place that decides what an AI request may contain). */

const REPO = 'https://github.com/0xCodez/bastion';

const OUT = [
  {
    what: 'Speed test',
    to: 'Cloudflare',
    host: 'speed.cloudflare.com',
    when: 'Only when you press Run speed test',
    sent: 'Test traffic. Cloudflare sees your IP address, as any website you open would.',
    tone: 'sky',
  },
  {
    what: 'Public IP lookup',
    to: 'ipify',
    host: 'api.ipify.org',
    when: 'When the overview loads',
    sent: 'One request that returns your public IP address, so Bastion can show it to you.',
    tone: 'lavender',
  },
  {
    what: 'AI requests',
    to: 'Anthropic, OpenAI or xAI',
    host: 'the provider you picked',
    when: 'Only when you ask an agent a question',
    sent: 'Your question and a trimmed snapshot of the scan, sent with your own key. MAC addresses are removed and your public IP is cut to its first three parts.',
    tone: 'amber',
  },
];

const NEVER = [
  'Full MAC addresses of your devices',
  'Device names and this computer’s name',
  'Wi-Fi network names and router hardware IDs (BSSIDs)',
  'The last part of your public IP, in any AI request',
  'Anything at all to a Bastion server, because there isn’t one',
];

const ICON = {
  out: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>',
  stay: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  dot: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  lock: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2.5"/></svg>',
};

export function mount(el) {
  if (!el) return;
  el.setAttribute('aria-labelledby', 'privacy-title');

  const rows = OUT.map(
    (r) => `
          <tr role="row" style="--tone:var(--${r.tone})">
            <th role="rowheader" scope="row"><span class="pv-dot" aria-hidden="true"></span>${r.what}</th>
            <td role="cell" data-label="Goes to"><div><strong>${r.to}</strong><span class="pv-host mono">${r.host}</span></div></td>
            <td role="cell" data-label="When"><div>${r.when}</div></td>
            <td role="cell" data-label="What is sent"><div>${r.sent}</div></td>
          </tr>`,
  ).join('');

  el.innerHTML = `
    <div class="container">
      <header class="sec-head pv-head" data-reveal>
        <p class="eyebrow">Privacy</p>
        <h2 class="display-l" id="privacy-title">Your network data stays on your computer</h2>
        <p class="lead">No account, no telemetry, no analytics, no crash reports. Bastion sends three things off your computer, each for a reason you can see.</p>
      </header>

      <div class="pv-grid">
        <div class="pv-out glass" data-reveal>
          <div class="pv-card-h">
            <span class="pv-ic pv-ic--out">${ICON.out}</span>
            <div>
              <h3 class="pv-h">What leaves your computer</h3>
              <p class="pv-sub">Everything Bastion itself sends out.</p>
            </div>
          </div>
          <table class="pv-table" role="table">
            <caption class="sr-only">Everything Bastion sends off your computer, where it goes, when, and what it contains</caption>
            <thead role="rowgroup">
              <tr role="row"><th role="columnheader" scope="col">What</th><th role="columnheader" scope="col">Goes to</th><th role="columnheader" scope="col">When</th><th role="columnheader" scope="col">What is sent</th></tr>
            </thead>
            <tbody role="rowgroup">${rows}
            </tbody>
          </table>
        </div>

        <div class="pv-side">
          <div class="pv-never glass" data-reveal style="--reveal-delay:.06s">
            <div class="pv-card-h">
              <span class="pv-ic pv-ic--stay">${ICON.stay}</span>
              <div>
                <h3 class="pv-h">What never leaves</h3>
                <p class="pv-sub">Not even inside an AI request.</p>
              </div>
            </div>
            <ul class="pv-list" role="list">
              ${NEVER.map((n) => `<li>${ICON.dot}<span>${n}</span></li>`).join('')}
            </ul>
          </div>

          <div class="pv-keys glass" data-reveal style="--reveal-delay:.12s">
            <span class="pv-lock" aria-hidden="true">${ICON.lock}</span>
            <div>
              <h3 class="pv-h">Your API keys</h3>
              <p>Encrypted at rest with your operating system’s keychain: Keychain on macOS, DPAPI on Windows. A key is decrypted only for the moment of a request and goes only to the provider it belongs to.</p>
            </div>
          </div>
        </div>
      </div>

      <p class="pv-foot" data-reveal>
        The scan itself talks only to your router’s local address. To show device names, Bastion asks the DNS server your system already uses, which is usually your router, but can be your provider’s or a public DNS server if your system is set up that way.
        <a href="${REPO}" rel="noopener">Check every request in the source</a>.
      </p>
    </div>`;

  reveal(el);
}
