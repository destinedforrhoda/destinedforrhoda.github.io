# The Owusus wedding invitation

To use guest uploads, double-click `code/Start uploads.command` on this Mac, then open
`http://127.0.0.1:8765/index.html`. Keep its terminal window open while using the site.
The invitation can still be opened directly from `index.html`, but uploads require the server.

```text
Scadio/
├── index.html           Page structure and content
├── code/
│   ├── styles.css       Design, colors and responsive layouts
│   ├── script.js        Calendar, countdown, RSVP and upload form
│   ├── server.py        Website and private upload server
│   ├── requirements.txt
│   ├── guest-list-template.xlsx
│   ├── attendance-template.xlsx
│   ├── test_server.py
│   ├── test_attendance.py
│   └── Start uploads.command
├── assets/
│   ├── favicon.svg
│   └── images/          Invitation photographs, with original filenames
├── documents/
│   └── Wedding Details.docx
├── Guest moments/
│   ├── Items/           Guest photos and processed videos
│   ├── Attendance Sheet/
│   │   └── Attendance Sheet.xlsx
│   └── List/
│       ├── Guest moments.xlsx
│       └── .records.sqlite3   Durable upload and attendance records
└── README.md
```

## Portable paths

The HTML loads its stylesheet and script using `./code/styles.css` and `./code/script.js`.
Photographs use `./assets/images/Shoot1.jpg` and the corresponding original filenames.
There are no computer-specific paths and no paths beginning with `/` for local assets.
Move or share the whole folder together, preserving its structure.

## Editing

- Edit wording, names, dates, contact numbers, map links and photographs directly in `index.html`. JavaScript does not replace this content.
- Change the `datetime` attribute on `<time id="wedding-date">` to set the calendar and live countdown. Use `YYYY-MM-DDTHH:MM:SS+00:00` for Ghana time. Also update the visible dates and ceremony times wherever they appear in the HTML.
- Add photos to `assets/images/`, then use their relative paths in the HTML (for example, `./assets/images/Shoot5.jpg`). Add or remove gallery `<figure>` elements as needed.
- The gallery keeps the photo order in the HTML, with one column on every screen. On phones each photo uses the full screen width at its natural proportions, with an 8-pixel gap between photos. Photos reveal after loading when they enter view, and replay when scrolled out and back into view. The footer’s Animations button lets guests enable or disable motion; the default follows their device preference.
- Change colors and layout styling in `code/styles.css`.
- Replace `[Invitation Message]` and `[Closing Message]` in the HTML with your chosen wording.
- Save your file, then refresh the browser. The preview does not automatically reload when a file is saved. If an old page is already open, use Command–Shift–R once to refresh cached files.

## Guest moments

The section after the closing photograph opens a pop-up with a guest name, phone number and file picker.
Each successful upload saves one item and one matching row in `Guest moments/List/Guest moments.xlsx`.
The row records the received time, name, phone number, original filename, saved item path, media type,
video durations and whether it was trimmed. Phone numbers remain text, preserving `+` and leading zeroes.
The Excel file is regenerated automatically after uploads; close and reopen it to see updates.
Do not edit this generated register in place. Make a separate copy if you want to annotate it.

- Photos: JPEG, PNG, WebP, GIF, HEIC/HEIF. Originals are preserved.
- Videos: MP4, MOV, M4V, WebM, MKV, AVI and 3GP, saved as compatible MP4 files.
- One item per submission, up to 250 MB. Images are limited to 40 megapixels.
- Videos longer than 3 minutes are automatically trimmed to their first 3 minutes. Trimming is enforced on the server, including audio. A small encoding allowance ensures the saved duration never exceeds 180 seconds.
- Two uploads can be processed at once. If both slots are busy, guests receive a message to retry.
- Guest files, the contact register and source documents are private local files. There is no public guest gallery or download route.
- The database is the durable record of uploads. Keep it with the Items folder when backing up or moving the site. The Excel register is rebuilt from these records on startup.

The local `.venv` folder contains installed dependencies and should be recreated on another computer rather than copied.
The server locates all project folders relative to its own location, with no personal computer paths in the code.

### Manual setup on another computer

Python 3.10 or later is required. From the project folder:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r code/requirements.txt
.venv/bin/python code/server.py
```

On Windows, use `python` instead of `python3` and `.venv\Scripts\python.exe` instead of `.venv/bin/python`.
FFmpeg is included by the video-processing dependency. No separate FFmpeg installation is needed.
Do not use `python -m http.server`: it cannot process uploads and would expose the private folders.

## RSVP and hosting

The attendance form saves each guest’s name, phone number and confirmation time to `Guest moments/Attendance Sheet/Attendance Sheet.xlsx`. Each successful confirmation adds a row. Retrying the same request after a connection failure does not duplicate it. The page confirms attendance only after saving succeeds. Names and phones are stored as literal text, preserving leading zeros and preventing Excel formulas.

Close and reopen the Excel register to see new confirmations. It is rebuilt from the private database on startup, so do not edit it directly; copy it first if you want to annotate it. Attendance and guest uploads both require the Python server. Opening `index.html` directly or using static-only hosting cannot save either form.

The title `theowusus.com` does not register or connect a domain. This is currently a local server, so people on other devices cannot use its localhost link. Attendance confirmations and guest uploads need hosting that runs the Python server with persistent disk storage and HTTPS. Static-only hosting will not support this feature. Keep `code`, `assets` and `Guest moments` as siblings, and expose only the routes served by `server.py`. Use one server process; it safely handles concurrent uploads with threads and a write lock. The `documents` folder is a source reference and does not need to be published.

## Checks

Run `.venv/bin/python -m unittest discover -s code -p 'test_*.py' -v`.
Tests use temporary folders and do not add fake guests to the real register.
