// Which installer a release file or download link is for. Shared by the server (api/track.js,
// api/dashboard.js) and the browser tracker (src/track.js), so both read file names the same way.
// The leading underscore keeps Vercel from serving this file as a route.

// Fixed, version-free asset names (package.json "build"):
//   Bastion-setup-x64.exe, Bastion-setup-arm64.exe, Bastion-mac-arm64.dmg, Bastion-mac-x64.dmg
// Older versioned names (Bastion-0.1.0-win-x64.exe, Bastion-0.1.0-mac-universal.dmg) still map.
// Installers only. A link to the releases page itself ('page' from platformOfUrl) is a click
// ('releases-page'), not a download, so it never inflates downloads or conversion.
export const PLATFORMS = ['windows-x64', 'windows-arm64', 'mac-arm64', 'mac-x64', 'mac-universal'];

export function platformOf(fileName) {
  const name = String(fileName || '').toLowerCase();
  if (/\.(exe|msi)$/.test(name)) return /arm64/.test(name) ? 'windows-arm64' : 'windows-x64';
  if (/\.(dmg|zip|pkg)$/.test(name) && /mac|darwin|osx/.test(name)) {
    if (/universal/.test(name)) return 'mac-universal';
    if (/arm64|aarch64/.test(name)) return 'mac-arm64';
    if (/x64|x86_64|intel/.test(name)) return 'mac-x64';
    return 'mac-universal';
  }
  return null;
}

// A link into the GitHub releases of the repo: the file it downloads, or 'page' for the releases page.
export function platformOfUrl(href) {
  const m = String(href || '').match(/github\.com\/0xCodez\/bastion\/releases(\/[^?#]*)?/i);
  if (!m) return null;
  const file = (m[1] || '').match(/\/download\/(?:[^/]+\/)?([^/]+)$/);
  return (file && platformOf(decodeURIComponent(file[1]))) || 'page';
}
