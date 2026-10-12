"""Attendance integration checks use disposable storage, never the real guest list."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4
from zipfile import ZipFile
import xml.etree.ElementTree as ET

from server import create_app, NS


class AttendanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.storage = Path(self.temp.name)
        self.app = create_app(self.storage)
        self.client = self.app.test_client()

    def tearDown(self):
        self.temp.cleanup()

    def confirm(self, name="Preview Guest", phone="0540000000", key=None, client=None):
        return (client or self.client).post("/api/attendance", json={"name": name, "phone": phone},
            headers={"X-Wedding-Attendance": "1", "X-Confirmation-ID": key or str(uuid4())})

    def records(self):
        with sqlite3.connect(self.storage / "List/.records.sqlite3") as db:
            return db.execute("SELECT name, phone FROM attendance").fetchall()

    def sheet(self):
        with ZipFile(self.storage / "Attendance Sheet/Attendance Sheet.xlsx") as archive:
            return ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))

    def test_saved_excel_retry_and_restart(self):
        key = str(uuid4())
        result = self.confirm(name="=1+1", key=key)
        self.assertEqual(result.status_code, 201)
        self.assertTrue(result.json["saved"])
        self.assertEqual(self.confirm(name="=1+1", key=key).status_code, 200)
        self.assertEqual(self.confirm(name="Changed", key=key).status_code, 409)
        self.assertEqual(self.confirm(name="Another Guest", phone="+233 54 111 1111").status_code, 201)
        self.assertEqual(len(self.records()), 2)
        sheet = self.sheet()
        self.assertEqual(sheet.findall(f".//{{{NS}}}f"), [])
        for ref, value in (("B6", "=1+1"), ("C6", "0540000000"), ("C7", "+233 54 111 1111")):
            cell = sheet.find(f".//{{{NS}}}c[@r='{ref}']")
            self.assertEqual(cell.attrib["t"], "inlineStr")
            self.assertEqual(cell.find(f".//{{{NS}}}t").text, value)
        self.assertGreater(float(sheet.find(f".//{{{NS}}}c[@r='A6']/{{{NS}}}v").text), 40000)
        create_app(self.storage)
        self.assertEqual(len(self.records()), 2)
        self.assertIsNotNone(self.sheet().find(f".//{{{NS}}}c[@r='C7']"))

    def test_validation_and_privacy(self):
        for name, phone in ((" ", "0540000000"), ("x" * 121, "0540000000"),
                            ("Guest", "abc"), ("Guest", "12345"), ("bad\x00name", "0540000000")):
            self.assertEqual(self.confirm(name, phone).status_code, 400)
        self.assertEqual(self.client.post("/api/attendance", json={}).status_code, 403)
        headers = {"X-Wedding-Attendance": "1", "X-Confirmation-ID": str(uuid4())}
        for body in ([], {"name": None, "phone": "0540000000"}):
            self.assertEqual(self.client.post("/api/attendance", json=body, headers=headers).status_code, 400)
        self.assertEqual(self.client.post("/api/attendance", json={"name":"Guest", "phone":"0540000000"},
            headers={**headers, "Origin":"https://other.example"}).status_code, 403)
        for path in ("/Guest%20moments/Attendance%20Sheet/Attendance%20Sheet.xlsx",
                     "/Guest%20moments/List/.records.sqlite3", "/code/attendance-template.xlsx"):
            self.assertEqual(self.client.get(path).status_code, 404)
        self.assertEqual(self.records(), [])

    def test_concurrent_confirmations(self):
        def confirm(index):
            with self.app.test_client() as client:
                return self.confirm(name=f"Guest {index}", client=client).status_code
        with ThreadPoolExecutor(max_workers=4) as pool:
            self.assertEqual(list(pool.map(confirm, range(8))), [201] * 8)
        self.assertEqual(len(self.records()), 8)
        self.assertIsNotNone(self.sheet().find(f".//{{{NS}}}c[@r='C13']"))

    def test_failed_excel_write_can_be_retried(self):
        key = str(uuid4())
        with patch("server.export_register", side_effect=OSError("test disk failure")), self.assertLogs(self.app.logger, level="ERROR"):
            response = self.confirm(key=key)
        self.assertEqual(response.status_code, 503)
        self.assertFalse(response.json.get("saved", False))
        self.assertEqual(self.records(), [])
        self.assertEqual(self.confirm(key=key).status_code, 201)
        self.assertEqual(len(self.records()), 1)


if __name__ == "__main__":
    unittest.main()
