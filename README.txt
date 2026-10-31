Learning Korean (한국어 배우기) - installable web app (PWA)

Files: index.html, manifest.webmanifest, sw.js, icons/ (keep this folder structure).

A PWA must be served over HTTPS (it will not install from a file on your phone).
Easiest free options: drag the whole folder onto Netlify Drop (app.netlify.com/drop),
or upload to GitHub Pages / Cloudflare Pages.

Install: open the link in Chrome on Android -> menu -> "Install app" (or "Add to Home screen").
On iPhone: Safari -> Share -> Add to Home Screen.

Updating: after you replace index.html, change VERSION in sw.js (e.g. korean-v2) so installed copies refresh.
