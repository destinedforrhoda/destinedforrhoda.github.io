"""End-to-end upload tests. All guest records live in disposable folders."""
import io
from html.parser import HTMLParser
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest
from uuid import uuid4
from zipfile import ZipFile
import xml.etree.ElementTree as ET

import imageio_ffmpeg
from server import create_app, video_metadata, ROOT, NS


class UploadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.storage = Path(self.temp.name) / "Guest moments"
        self.app = create_app(self.storage)
        self.client = self.app.test_client()
        self.photo = (ROOT / "assets/images/Pic1.jpeg").read_bytes()

    def tearDown(self):
        self.temp.cleanup()

    def post(self, content, filename, upload_id=None, name="Preview Guest", phone="+233 54 000 0000"):
        return self.client.post("/api/moments", data={"name": name, "phone": phone,
            "item": (io.BytesIO(content), filename)}, headers={"X-Wedding-Upload": "1", "X-Upload-ID": upload_id or str(uuid4())})

    def records(self):
        with sqlite3.connect(self.storage / "List/.records.sqlite3") as database:
            return database.execute("SELECT name,phone,original_name,saved_name,trimmed FROM uploads").fetchall()

    def test_photo_register_and_retry(self):
        upload_id = str(uuid4())
        result = self.post(self.photo, "wedding-photo.jpeg", upload_id)
        self.assertEqual(result.status_code, 201, result.json)
        self.assertTrue((self.storage / "Items" / result.json["filename"]).exists())
        self.assertEqual(self.post(self.photo, "wedding-photo.jpeg", upload_id).status_code, 200)
        self.assertEqual(len(self.records()), 1)
        with ZipFile(self.storage / "List/Guest moments.xlsx") as archive:
            sheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
        row = sheet.find(f".//{{{NS}}}row[@r='6']")
        cells = {cell.attrib["r"]: cell for cell in row}
        self.assertEqual(cells["C6"].attrib["t"], "inlineStr")
        self.assertEqual(cells["C6"].find(f".//{{{NS}}}t").text, "+233 54 000 0000")
        self.assertIn(result.json["filename"], cells["E6"].find(f".//{{{NS}}}t").text)
        # A restart rebuilds the register from the same durable records.
        create_app(self.storage)
        self.assertEqual(len(self.records()), 1)

    def test_invalid_input_and_private_paths(self):
        self.assertEqual(self.post(self.photo, "pic.jpg", phone="bad phone").status_code, 400)
        self.assertEqual(self.post(b"<html>not an image</html>", "pic.jpg").status_code, 400)
        self.assertEqual(self.post(b"#EXTM3U\nhttp://example.com/video", "fake.mp4").status_code, 400)
        self.assertEqual(self.client.post("/api/moments").status_code, 403)
        for url in ("/Guest%20moments/List/Guest%20moments.xlsx", "/Guest%20moments/Items/test.jpg",
                    "/code/server.py", "/documents/Wedding%20Details.docx", "/assets/../code/server.py"):
            self.assertEqual(self.client.get(url).status_code, 404, url)
        self.assertEqual(self.records(), [])
        self.assertEqual(self.client.get("/").status_code, 302)
        with self.client.get("/index.html") as response:
            self.assertEqual(response.status_code, 200)

    def test_multiple_guests_and_formula_text(self):
        self.assertEqual(self.post(self.photo, "one.jpg").status_code, 201)
        self.assertEqual(self.post(self.photo, "two.jpg", name="=1+1", phone="0540000000").status_code, 201)
        self.assertEqual(len(self.records()), 2)
        with ZipFile(self.storage / "List/Guest moments.xlsx") as archive:
            sheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
        self.assertEqual(sheet.findall(f".//{{{NS}}}f"), [])
        values = [node.text for node in sheet.findall(f".//{{{NS}}}t")]
        self.assertIn("=1+1", values)
        self.assertIn("0540000000", values)

    def test_edited_invitation_assets_and_private_paths(self):
        for url in ("/index.html", "/code/script.js", "/code/styles.css",
                    "/assets/images/Shoot5.jpg", "/assets/images/Shoot8.jpg"):
            with self.client.get(url) as response:
                self.assertEqual(response.status_code, 200, url)
                self.assertEqual(response.headers["Cache-Control"], "no-store")
        for url in ("/assets/images/../../code/server.py", "/assets/images/../favicon.svg",
                    "/assets/images/../../../Guest%20moments/List/Guest%20moments.xlsx"):
            with self.client.get(url) as response:
                self.assertEqual(response.status_code, 404, url)

    def test_root_invitation_and_relative_assets(self):
        class Assets(HTMLParser):
            def __init__(self):
                super().__init__()
                self.paths = []

            def handle_starttag(self, tag, attrs):
                attrs = dict(attrs)
                if tag in {"img", "script", "link"}:
                    self.paths.append(attrs.get("src") or attrs.get("href"))

        with self.client.get("/index.html") as response:
            self.assertEqual(response.data, (ROOT / "index.html").read_bytes())
            assets = Assets()
            assets.feed(response.get_data(as_text=True))
        for path in assets.paths:
            self.assertTrue(path.startswith("./"), path)
            self.assertTrue((ROOT / path).is_file(), path)
            with self.client.get("/" + path.removeprefix("./")) as response:
                self.assertEqual(response.status_code, 200, path)
        self.assertFalse((ROOT / "code/index.html").exists())
        for old_path, destination in (("/", "index.html"), ("/code/", "../index.html"),
                                      ("/code/index.html", "../index.html")):
            with self.client.get(old_path) as response:
                self.assertEqual(response.status_code, 302)
                self.assertEqual(response.headers["Location"], destination)

    def test_long_video_trimmed_with_audio(self):
        video = Path(self.temp.name) / "long.mp4"
        subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-i", "color=c=brown:s=160x120:r=2", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=22050",
            "-t", "181", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-y", str(video)], check=True)
        result = self.post(video.read_bytes(), "long.mp4")
        self.assertEqual(result.status_code, 201, result.json)
        self.assertTrue(result.json["trimmed"])
        saved = self.storage / "Items" / result.json["filename"]
        self.assertLessEqual(video_metadata(saved)["duration"], 180)
        self.assertGreater(video_metadata(saved)["duration"], 179)
        self.assertEqual(self.records()[0][-1], 1)
        print(f"Verified: 181-second video saved as {video_metadata(saved)['duration']:.2f} seconds with matching Excel record.")


if __name__ == "__main__":
    unittest.main()
