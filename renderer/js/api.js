// The only way the renderer talks to the system. Inside Electron this is window.bastion
// (see electron/preload.js). In a plain browser (preview) it falls back to the mock,
// which is clearly labelled as sample data in the UI.

const api = window.bastion ? window.bastion : (await import('./mock-api.js')).default;

document.body.classList.add(`platform-${api.platform}`);
if (api.platform === 'browser-mock') document.body.classList.add('is-mock');

export const isMock = api.platform === 'browser-mock';
export default api;
