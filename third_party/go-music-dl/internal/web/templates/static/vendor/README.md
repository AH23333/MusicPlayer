# Bundled frontend assets

These files are embedded in the application so the Web UI and desktop WebView
do not depend on a CDN at runtime.

| Asset | Version | Source |
| --- | --- | --- |
| APlayer | 1.10.1 | `https://www.npmjs.com/package/aplayer` |
| Font Awesome Free | 6.7.2 | `https://www.npmjs.com/package/@fortawesome/fontawesome-free` |
| Sakana Widget | 2.7.1 | `https://www.npmjs.com/package/sakana-widget` |

Upstream license texts are stored in `licenses/`. Keep versions pinned and
update the corresponding template paths and tests when replacing an asset.
