# Connect the Guest Memories gallery

The website is ready, but it needs a deployed Google Apps Script URL before it can read the media list. The Google Drive folder URL alone is not that connection.

## One-time setup (use the Google account that owns the uploads)

1. Open https://script.google.com/ and create a **New project**, named **Wedding Guest Memories**.
2. Replace the contents of **Code.gs** with the contents of `guest-moments.gs` in this folder. Your supplied upload-folder ID is already filled in. The script scans it and its subfolders, without reading response sheets.
3. Open **Project Settings** and enable **Show appsscript.json manifest file in editor**. Return to the editor and replace **appsscript.json** with the supplied `appsscript.json`. This requests read-only Drive access.
4. Select **checkGallery** and click **Run**. Review and authorize your own script. The execution log will show the count of publicly viewable photos/videos. If access fails, check that you are using the folder owner's account and the folder ID is correct.
5. Click **Deploy → New deployment → Select type → Web app**. Set **Execute as: Me**, and **Who has access: Anyone** (not only signed-in Google users). Deploy and copy the **Web app URL**, ending in `/exec`. Google hosts this code; no Render account is involved.
6. Send that URL back in this chat, or paste it into `feedUrl` in `code/guest-moments-config.js`. If editing it yourself, bump the config script's `?v=` in `index.html`, then commit and push those changes to GitHub.

Official deployment instructions: https://developers.google.com/apps-script/guides/web

## Media sharing

The feed includes only images and videos that are already shared with **Anyone with the link** or **Anyone**. It never changes permissions. Ensure the media-upload folder/files allow public viewing and downloads. Do not place the response spreadsheet or any private records in a public folder. The supplied link points to the form's media upload folder, not the response spreadsheet.

The website and feed do not display or return guest names, phone numbers, captions or filenames. Google's own video preview/download pages can display the original filename or owner information. Use neutral filenames if uploaded filenames contain personal details; the script does not rename original uploads.

Each photo/video has a download link. Google may show a download confirmation or warning for large files; owner restrictions, browser settings, storage limits, processing and Drive quotas still apply. Photo previews use Drive thumbnails; an Open photo link is shown if preview loading fails. Videos use Google's embedded preview player.

## How updates work

- The gallery reads a complete fresh list on page load, every 60 seconds while the tab is visible, and when the visitor returns to the tab.
- Moving a file to trash, removing it from the scanned folder tree, or revoking its public link removes the gallery card after the next successful refresh. Google-side propagation and request time can add delay.
- An empty folder removes all cards. A network/permission/quota error keeps the last successful gallery and shows a retry message; it is not treated as proof of deletion.
- Unchanged video frames stay mounted during refresh so playback is not restarted.
- The script does not cache the file list and never returns partial results. Limits are 1,000 media items, 5,000 scanned files and 100 folders. Larger folders need a revised implementation.
- Only media IDs, media types and optional Drive resource keys are public. The endpoint is read-only and returns no form responses or access tokens.
- Downloads already saved by visitors cannot be recalled.

Google Apps Script has execution quotas, so very high visitor counts may require less frequent refreshes or a different hosting design.

## Verify after connecting

1. Open the `/exec` URL in a signed-out/private browser. It should return `ok: true` with an `items` list, without a login prompt. `ok: false` means access or scanning failed; an empty list means no publicly viewable media were found.
2. Open the website on a phone. Check a photo, play a video and try both download buttons.
3. Add a disposable test photo. Confirm it appears, then move it to trash and confirm its card disappears after a successful refresh (normally around one minute).
4. Confirm the form response sheet remains private.

For script changes later, use **Deploy → Manage deployments → Edit → New version → Deploy** to retain the same web-app URL.
