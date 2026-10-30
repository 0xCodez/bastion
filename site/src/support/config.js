// Support section settings. Same tips profile and feedback inbox as Cleanly (electron/config.ts there).
// Empty strings disable the feature they configure.

export const PRODUCT = 'Bastion';

// Beyond Apps tips (shared Stripe backend at beyond-media.ai, never Stripe keys here).
export const TIPS_ORIGIN = 'https://beyond-media.ai';
export const TIPS_EMBED = `${TIPS_ORIGIN}/tips/embed.js`;
export const TIPS_CREATOR = 'beyond-apps';
// Standalone tip page, used as the no-script fallback and the "open in a new tab" link.
export const TIPS_PAGE = `${TIPS_ORIGIN}/tips?creator=${TIPS_CREATOR}`;

// Feedback. Cleanly ships with no endpoint (mailto only), and so does this site. Leave
// VITE_FEEDBACK_ENDPOINT unset until a receiver exists (site/api has no feedback function yet);
// a cross-origin endpoint must also be added to connect-src in vercel.json. Mail stays the fallback.
export const FEEDBACK_ENDPOINT = (import.meta.env && import.meta.env.VITE_FEEDBACK_ENDPOINT) || '';
export const FEEDBACK_EMAIL = 'contact@beyond-media.ai';
export const FEEDBACK_SOURCE = 'bastion-site';
