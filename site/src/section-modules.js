// Section modules and stylesheets, globbed so a section still in progress doesn't break the build.
// Kept in its own module and imported after the shared styles in main.js: eager globs become
// hoisted imports, so living in main.js put every section's CSS before base.css in the bundle.
export const sectionCss = import.meta.glob('./sections/*.css', { eager: true });
export const sectionJs = import.meta.glob('./sections/*.js', { eager: true });
