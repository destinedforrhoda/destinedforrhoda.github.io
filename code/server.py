"""Wedding invitation and private guest uploads. Run from any working directory.

Only the invitation and its curated assets are public. Guest moments, phone
numbers, source documents and server files are never served as static files.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import copy
import math
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import tempfile
import threading
from datetime import datetime, timezone
from urllib.parse import urlsplit
from uuid import UUID
from zipfile import ZipFile, ZIP_DEFLATED
import xml.etree.ElementTree as ET

from flask import Flask, abort, jsonify, redirect, request, send_from_directory
from werkzeug.exceptions import HTTPException
from PIL import Image
from pillow_heif import register_heif_opener
import imageio_ffmpeg

CODE = Path(__file__).resolve().parent
ROOT = CODE.parent
MAX_FILE_BYTES = 250 * 1024 * 1024
MAX_VIDEO_SECONDS = 180
IMAGE_FORMATS = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp", "GIF": ".gif", "HEIF": ".heic"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".3gp"}
NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
ET.register_namespace("", NS)
register_heif_opener()
Image.MAX_IMAGE_PIXELS = 40_000_000


def video_metadata(path: Path) -> dict:
    reader = imageio_ffmpeg.read_frames(str(path), input_params=["-protocol_whitelist", "file,pipe"])
    try:
        metadata = next(reader)
        width, height = metadata["size"]
        if width * height > 40_000_000:
            raise ValueError("This video’s resolution is too large. Please upload a smaller copy.")
        duration = float(metadata.get("duration", 0))
        if not math.isfinite(duration) or duration <= 0:
            raise ValueError("We could not read this video’s duration. Please save it as MP4 and try again.")
        return metadata
    except (RuntimeError, OSError, StopIteration) as error:
        raise ValueError("This video could not be read. Please try a playable MP4 or MOV file.") from error
    finally:
        reader.close()


def prepare_media(source: Path, original_name: str, work: Path) -> dict:
    """Validate file contents, and enforce the video limit on the server."""
    suffix = Path(original_name).suffix.lower()
    if suffix in VIDEO_EXTENSIONS:
        with source.open("rb") as stream:
            header = stream.read(32)
        valid_container = (header[4:8] in {b"ftyp", b"moov", b"mdat", b"wide", b"free"}
                           or header[:4] == b"\x1aE\xdf\xa3"
                           or (header[:4] == b"RIFF" and header[8:12] == b"AVI "))
        if not valid_container:
            raise ValueError("Please choose a valid MP4, MOV, WebM or AVI video.")
        metadata = video_metadata(source)
        original_duration = float(metadata["duration"])
        destination = work / "prepared.mp4"
        # Small muxing allowance keeps the final container at or below 180s,
        # including AAC packet padding. Always re-encode for accurate cuts.
        command = [imageio_ffmpeg.get_ffmpeg_exe(), "-nostdin", "-hide_banner", "-loglevel", "error",
                   "-protocol_whitelist", "file,pipe", "-i", str(source), "-t", "179.9",
                   "-map", "0:v:0", "-map", "0:a:0?", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                   "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-threads", "2",
                   "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
                   "-map_metadata", "-1", "-movflags", "+faststart", "-y", str(destination)]
        try:
            subprocess.run(command, check=True, capture_output=True, timeout=600)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
            raise ValueError("The video could not be processed. Please upload a shorter or smaller MP4.") from error
        saved_duration = float(video_metadata(destination)["duration"])
        if saved_duration > MAX_VIDEO_SECONDS:
            raise ValueError("The video could not be shortened safely. Please trim it to three minutes and try again.")
        return {"path": destination, "extension": ".mp4", "type": "Video", "original_seconds": original_duration,
                "saved_seconds": saved_duration, "trimmed": original_duration > MAX_VIDEO_SECONDS}

    try:
        with Image.open(source) as photo:
            if photo.width * photo.height > 40_000_000:
                raise ValueError("Please choose a photo up to 40 megapixels.")
            extension = IMAGE_FORMATS.get(photo.format)
            if not extension:
                raise ValueError("Please choose a JPEG, PNG, WebP, GIF or HEIC photo.")
            photo.verify()
    except (OSError, SyntaxError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise ValueError("This photo could not be read. Please choose a valid photo up to 40 megapixels.") from error
    return {"path": source, "extension": extension, "type": "Photo", "original_seconds": None,
            "saved_seconds": None, "trimmed": False}


def export_register(database: sqlite3.Connection, destination: Path, *, attendance: bool = False) -> None:
    """Populate the styled Excel template with durable upload records.

    The template is authored with Artifact Tool. Runtime export writes typed
    OpenXML cells, so user input is always literal text, never an Excel formula.
    Rebuilding from SQLite makes the register recoverable after a restart.
    """
    template = "attendance-template.xlsx" if attendance else "guest-list-template.xlsx"
    columns = "ABC" if attendance else "ABCDEFGHI"
    with ZipFile(CODE / template) as archive:
        entries = {name: archive.read(name) for name in archive.namelist()}
    sheet = ET.fromstring(entries["xl/worksheets/sheet1.xml"])
    sheet.attrib.pop("{http://schemas.openxmlformats.org/markup-compatibility/2006}Ignorable", None)
    data = sheet.find(f"{{{NS}}}sheetData")
    style_row = data.find(f"{{{NS}}}row[@r='6']")
    styles = {c.attrib["r"][0]: c.attrib.get("s", "0") for c in style_row} if style_row is not None else {}
    for row in list(data):
        if int(row.attrib["r"]) >= 6:
            data.remove(row)
    table = "attendance" if attendance else "uploads"
    records = database.execute(f"SELECT * FROM {table} ORDER BY received, id").fetchall()
    for row_number, record in enumerate(records, start=6):
        timestamp = datetime.fromisoformat(record["received"])
        excel_date = (timestamp - datetime(1899, 12, 30, tzinfo=timezone.utc)).total_seconds() / 86400
        values = [excel_date, record["name"], record["phone"]]
        if not attendance:
            values += [record["original_name"], "../Items/" + record["saved_name"], record["media_type"],
                       record["original_seconds"], record["saved_seconds"], "Yes" if record["trimmed"] else "No"]
        height = max(32, math.ceil(len(record["name"]) / 34) * 16) if attendance else 32
        row = ET.SubElement(data, f"{{{NS}}}row", {"r": str(row_number), "ht": str(height), "customHeight": "1"})
        for column, value in zip(columns, values):
            cell = ET.SubElement(row, f"{{{NS}}}c", {"r": f"{column}{row_number}", "s": styles.get(column, "0")})
            if value is None:
                continue
            if isinstance(value, (int, float)):
                ET.SubElement(cell, f"{{{NS}}}v").text = str(value)
            else:
                cell.set("t", "inlineStr")
                inline = ET.SubElement(cell, f"{{{NS}}}is")
                text = ET.SubElement(inline, f"{{{NS}}}t", {"{http://www.w3.org/XML/1998/namespace}space": "preserve"})
                text.text = str(value)
    if not records and style_row is not None:
        data.append(copy.deepcopy(style_row))
    last_row = max(6, len(records) + 5)
    dimension = sheet.find(f"{{{NS}}}dimension")
    if dimension is not None:
        dimension.set("ref", f"A1:{columns[-1]}{last_row}")
    entries["xl/worksheets/sheet1.xml"] = ET.tostring(sheet, encoding="utf-8", xml_declaration=True)
    with ZipFile(destination, "w", ZIP_DEFLATED) as output:
        for name, content in entries.items():
            output.writestr(name, content)


def create_app(storage_root: Path | None = None) -> Flask:
    app = Flask(__name__, static_folder=None)
    app.config.update(MAX_CONTENT_LENGTH=MAX_FILE_BYTES + 1024 * 1024, MAX_FORM_MEMORY_SIZE=500 * 1024,
                      MAX_FORM_PARTS=10)
    storage = Path(storage_root) if storage_root else ROOT / "Guest moments"
    items, lists, incoming = storage / "Items", storage / "List", storage / ".incoming"
    attendance_folder = storage / "Attendance Sheet"
    for folder in (items, lists, incoming, attendance_folder):
        folder.mkdir(parents=True, exist_ok=True)
    db_path = lists / ".records.sqlite3"
    workbook_path = lists / "Guest moments.xlsx"
    attendance_path = attendance_folder / "Attendance Sheet.xlsx"
    write_lock = threading.Lock()
    processing_slots = threading.BoundedSemaphore(2)

    @contextmanager
    def connect():
        connection = sqlite3.connect(db_path, timeout=30)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    with connect() as database:
        database.execute("PRAGMA journal_mode=WAL")
        database.execute("""CREATE TABLE IF NOT EXISTS uploads (
            id TEXT PRIMARY KEY, received TEXT NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL,
            original_name TEXT NOT NULL, saved_name TEXT NOT NULL UNIQUE, media_type TEXT NOT NULL,
            original_seconds REAL, saved_seconds REAL, trimmed INTEGER NOT NULL)""")
        database.execute("""CREATE TABLE IF NOT EXISTS attendance (
            id TEXT PRIMARY KEY, received TEXT NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL)""")
        export_register(database, lists / ".register-startup.xlsx")
        os.replace(lists / ".register-startup.xlsx", workbook_path)
        export_register(database, attendance_folder / ".register-startup.xlsx", attendance=True)
        os.replace(attendance_folder / ".register-startup.xlsx", attendance_path)

    @app.after_request
    def headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        if request.path in {"/", "/index.html"} or request.path.startswith(("/api/", "/code/", "/assets/")):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.errorhandler(HTTPException)
    def http_error(error):
        if request.path.startswith("/api/"):
            message = "Please choose a file smaller than 250 MB." if error.code == 413 else error.description
            return jsonify(error=message), error.code
        return error

    @app.get("/")
    def home():
        return redirect("index.html")

    @app.get("/code/")
    @app.get("/code/index.html")
    def old_invitation():
        return redirect("../index.html")

    @app.get("/index.html")
    def invitation():
        return send_from_directory(ROOT, "index.html")

    @app.get("/code/<name>")
    def code_asset(name):
        if name not in {"styles.css", "script.js"}:
            abort(404)
        return send_from_directory(CODE, name)

    @app.get("/assets/<path:name>")
    def asset(name):
        if name == "favicon.svg":
            return send_from_directory(ROOT / "assets", name)
        image_root = (ROOT / "assets" / "images").resolve()
        image = (ROOT / "assets" / name).resolve()
        if (not name.startswith("images/") or image.parent != image_root
                or image.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}):
            abort(404)
        return send_from_directory(image_root, image.name)

    @app.get("/api/moments/status")
    def status():
        return jsonify(ready=True, maxSeconds=MAX_VIDEO_SECONDS, maxBytes=MAX_FILE_BYTES)

    @app.post("/api/attendance")
    def confirm_attendance():
        origin = request.headers.get("Origin")
        if request.headers.get("X-Wedding-Attendance") != "1" or (origin and urlsplit(origin).netloc != request.host):
            abort(403, "Please confirm through the wedding invitation.")
        if request.content_length is None or request.content_length > 4096:
            abort(400, "Please enter only your name and phone number.")
        try:
            confirmation_id = str(UUID(request.headers.get("X-Confirmation-ID", "")))
        except ValueError:
            abort(400, "Please refresh the page and confirm again.")
        details = request.get_json(silent=True)
        if not isinstance(details, dict) or not all(isinstance(details.get(key), str) for key in ("name", "phone")):
            abort(400, "Please enter your name and phone number.")
        name, phone = details["name"].strip(), details["phone"].strip()
        if not name or len(name) > 120 or any(ord(c) < 32 or 0xD800 <= ord(c) <= 0xDFFF or ord(c) in (0xFFFE, 0xFFFF) for c in name):
            abort(400, "Please enter your name (up to 120 characters).")
        if not re.fullmatch(r"\+?[0-9() .-]{7,30}", phone) or not 7 <= len(re.sub(r"\D", "", phone)) <= 15:
            abort(400, "Please enter a valid phone number, including your country code.")
        with write_lock, connect() as database:
            existing = database.execute("SELECT name, phone FROM attendance WHERE id=?", (confirmation_id,)).fetchone()
            if existing and (existing["name"] != name or existing["phone"] != phone):
                abort(409, "Your details changed. Please refresh the page and confirm again.")
            staged = attendance_folder / ".register-pending.xlsx"
            try:
                if not existing:
                    database.execute("INSERT INTO attendance VALUES (?, ?, ?, ?)",
                        (confirmation_id, datetime.now(timezone.utc).isoformat(), name, phone))
                export_register(database, staged, attendance=True)
                os.replace(staged, attendance_path)
                database.commit()
            except Exception:
                database.rollback()
                app.logger.exception("Could not save attendance register")
                try:
                    export_register(database, staged, attendance=True)
                    os.replace(staged, attendance_path)
                except Exception:
                    app.logger.exception("Could not restore attendance register")
                return jsonify(error="Your attendance could not be saved. Please try again shortly."), 503
            finally:
                staged.unlink(missing_ok=True)
        return jsonify(saved=True), 200 if existing else 201

    @app.post("/api/moments")
    def upload():
        # A custom request header prevents cross-origin HTML form submissions.
        origin = request.headers.get("Origin")
        if request.headers.get("X-Wedding-Upload") != "1" or (origin and urlsplit(origin).netloc != request.host):
            abort(403, "Please upload through the wedding invitation.")
        try:
            upload_id = str(UUID(request.headers.get("X-Upload-ID", "")))
        except ValueError:
            abort(400, "Please reopen the upload form and try again.")
        if not processing_slots.acquire(blocking=False):
            return jsonify(error="Other memories are being processed. Please try again in a moment."), 503
        try:
            with connect() as database:
                existing = database.execute("SELECT * FROM uploads WHERE id=?", (upload_id,)).fetchone()
                if existing:
                    return jsonify(saved=True, filename=existing["saved_name"], trimmed=bool(existing["trimmed"]))
            name = request.form.get("name", "").strip()
            phone = request.form.get("phone", "").strip()
            if not name or len(name) > 120 or any(ord(c) < 32 for c in name):
                abort(400, "Please enter your name (up to 120 characters).")
            if not re.fullmatch(r"\+?[0-9() .-]{7,30}", phone) or not 7 <= len(re.sub(r"\D", "", phone)) <= 15:
                abort(400, "Please enter a valid phone number, including your country code.")
            files = request.files.getlist("item")
            if len(files) != 1 or not files[0].filename:
                abort(400, "Please choose one photo or video.")
            item = files[0]
            original_name = item.filename.replace("\\", "/").split("/")[-1]
            original_name = "".join(c for c in original_name if ord(c) >= 32)[:180]
            if not original_name:
                abort(400, "Please choose a file with a valid filename.")
            with tempfile.TemporaryDirectory(prefix="upload-", dir=incoming) as folder:
                work = Path(folder)
                source = work / ("source" + Path(original_name).suffix.lower())
                item.save(source)
                if not 0 < source.stat().st_size <= MAX_FILE_BYTES:
                    abort(413)
                try:
                    media = prepare_media(source, original_name, work)
                except ValueError as error:
                    abort(400, str(error))
                saved_name = upload_id + media["extension"]
                final_path = items / saved_name
                staged_register = work / "register.xlsx"
                with write_lock, connect() as database:
                    existing = database.execute("SELECT * FROM uploads WHERE id=?", (upload_id,)).fetchone()
                    if existing:
                        return jsonify(saved=True, filename=existing["saved_name"], trimmed=bool(existing["trimmed"]))
                    try:
                        database.execute("INSERT INTO uploads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                            (upload_id, datetime.now(timezone.utc).isoformat(), name, phone, original_name,
                             saved_name, media["type"], media["original_seconds"], media["saved_seconds"], int(media["trimmed"])))
                        export_register(database, staged_register)
                        os.replace(media["path"], final_path)
                        os.replace(staged_register, workbook_path)
                        database.commit()
                    except Exception:
                        database.rollback()
                        final_path.unlink(missing_ok=True)
                        app.logger.exception("Could not save guest moment and register")
                        # Restore the derived register if the database commit failed.
                        try:
                            export_register(database, staged_register)
                            os.replace(staged_register, workbook_path)
                        except OSError:
                            pass
                        return jsonify(error="Your upload could not be saved. Please try again shortly."), 503
                return jsonify(saved=True, filename=saved_name, trimmed=media["trimmed"],
                               savedSeconds=media["saved_seconds"]), 201
        finally:
            processing_slots.release()

    return app


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="The Owusus wedding invitation and guest uploads")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()
    # Fail at startup if the bundled video encoder is not available.
    imageio_ffmpeg.get_ffmpeg_exe()
    from waitress import serve
    print(f"Invitation ready: http://{args.host}:{args.port}/index.html", flush=True)
    serve(create_app(), host=args.host, port=args.port, threads=4, max_request_body_size=MAX_FILE_BYTES + 1024 * 1024)
