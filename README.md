# Desmond & Rhodalyn — wedding invitation

A static wedding website hosted on GitHub Pages. Attendance and guest uploads are handled by Google Forms; no application server, Python environment, or local spreadsheet is needed.

## Files

- `index.html` — page content, wedding date, and Google Forms links.
- `code/styles.css` — layout, colours, responsive design, and animation styles.
- `code/script.js` — calendar, countdown, mobile navigation, and scroll animations.
- `assets/favicon.svg` — site icon.
- `assets/images/` — wedding photographs and the Google Forms banner.

All local asset links are relative. Open `index.html` to preview the page.

## Guest forms

- Attendance: https://forms.gle/sSDJohEdpAjEx4Rz9
- Photos and videos: https://forms.gle/iqYvLdGNRwUPn83f6

The website buttons open these forms in a new tab and work without JavaScript. Manage submissions in Google Forms and their linked Google Sheets. Uploaded files are stored in the form owner's Google Drive. Guests must sign in to Google to upload; videos must be trimmed by the guest before submission. This website does not trim or store uploads.

Form sharing, response destinations, and Drive permissions are managed in Google, separately from this repository. Keep guest response sheets and uploaded files private.

## Editing and publishing

Edit the root `index.html` for text, links, and photos. The calendar and countdown read the `datetime` attribute on `#wedding-date`. Update visible dates and times too if the event changes.

After editing CSS or JavaScript, update their `?v=` values in `index.html` to refresh cached files.

Commit changes and push to `main`. GitHub Pages publishes the repository root at https://destinedforrhoda.github.io/ . Do not add guest records or credentials to the repository.
