import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps"))
import importlib.util
spec = importlib.util.spec_from_file_location("hourly_launcher", Path(__file__).resolve().parents[1] / "apps/hourly-launcher.py")
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class LauncherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = Path(self.temp.name) / "productivity-tracker.html"
        self.app.write_text("<!doctype html><script>/* tracker */</script>")
        self.server = launcher.HourlyServer(self.app, port=0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self, endpoint, body=None, token=True, origin=None):
        headers = {}
        if token:
            headers["Authorization"] = "Bearer " + self.server.token
        if origin:
            headers["Origin"] = origin
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = Request(self.server.origin + endpoint, headers=headers,
                          data=None if body is None else json.dumps(body).encode())
        try:
            with urlopen(request) as response:
                return response.status, response.read()
        except HTTPError as error:
            status, data = error.code, error.read()
            error.close()
            return status, data

    def test_serves_only_hourly_with_local_folder_configuration(self):
        status, html = self.request("/", token=False)
        self.assertEqual(status, 200)
        self.assertIn(b'hourly-local-config', html)
        self.assertIn(self.server.token.encode(), html)
        self.assertNotEqual(self.request("/hourly-launcher.py")[0], 200)

    def test_csv_roundtrip_preserves_exact_crlf_and_zero_values(self):
        text = "date,score\r\n2026-11-02,0\r\n"
        status, _ = self.request("/__hourly_api__/file", {"name": "scores.csv", "text": text, "expected": None})
        self.assertEqual(status, 200)
        status, result = self.request("/__hourly_api__/file?name=scores.csv")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(result)["text"], text)
        self.assertEqual((self.app.parent / "scores.csv").read_bytes(), text.encode())
        self.assertEqual(json.loads(self.request("/__hourly_api__/files")[1])["files"], ["scores.csv"])

    def test_atomic_saves_reject_stale_data(self):
        path = self.app.parent / "scores.csv"
        path.write_text("external data")
        status, data = self.request("/__hourly_api__/file", {"name": "scores.csv", "text": "new data", "expected": "old data"})
        self.assertEqual(status, 409)
        self.assertEqual(json.loads(data)["code"], "ConflictError")
        self.assertEqual(path.read_text(), "external data")
        self.assertEqual(self.request("/__hourly_api__/file", {"name": "scores.csv", "text": "new data", "expected": "external data"})[0], 200)

    def test_folder_scope_and_request_authorization(self):
        self.assertEqual(self.request("/__hourly_api__/files", token=False)[0], 403)
        self.assertEqual(self.request("/__hourly_api__/files", origin="https://unrelated.example")[0], 403)
        for name in ["../outside.csv", "folder/a.csv", "productivity-tracker.html"]:
            status, _ = self.request("/__hourly_api__/file", {"name": name, "text": "test", "expected": None})
            self.assertEqual(status, 400)
        self.assertEqual(self.request("/__hourly_api__/file?name=missing.csv")[0], 404)


if __name__ == "__main__":
    unittest.main()
