import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("bridge", ROOT / "tools/serial_bridge/bridge.py")
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)
RUN = "10000000-0000-4000-8000-000000000001"


class FirmwareTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        binary = str(Path(cls.temp.name) / "native")
        subprocess.run([os.environ.get("CXX", "c++"), "-std=c++11", "-Wall", "-Wextra", "-Werror", "-I" + str(ROOT / "firmware/usb_simulator"), str(Path(__file__).with_name("native.cpp")), "-o", binary], check=True)
        cls.wire = subprocess.check_output([binary])
        cls.packets = [json.loads(line) for line in cls.wire.splitlines()]

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_sketch_handshake_and_emit_gate(self):
        binary = str(Path(self.temp.name) / "sketch")
        subprocess.run([os.environ.get("CXX", "c++"), "-std=c++11", "-Wall", "-Wextra", "-Werror", "-I" + str(ROOT / "firmware/usb_simulator"), "-I" + str(Path(__file__).with_name("stubs")), str(Path(__file__).with_name("sketch.cpp")), "-o", binary], check=True)
        subprocess.run([binary], check=True)

    def event(self):
        return b.validate(self.packets[0], RUN, .8, 1.8, 1793649600123, 1793649601123)

    def test_native_firmware_packets_end_to_end(self):
        framer = b.Framer()
        packets = []
        for byte in self.wire:
            packets.extend(framer.feed(bytes([byte])))
        self.assertEqual(packets, self.packets)
        self.assertEqual([p["sequence"] for p in packets], list(range(1, 13)))
        self.assertEqual({p["imu_id"] for p in packets}, {1, 2, 3})
        self.assertEqual(len({p["id"] for p in packets}), 12)
        for packet in packets:
            result = b.validate(packet, RUN, .8, 1.8, 1793649600123, 1793649601123)
            self.assertEqual(result["recorded_at"], "2026-11-02T20:00:00.123Z")
            self.assertNotIn("type", result)
            self.assertNotIn("x", result)

    def test_capture_saves_native_serial_and_stops_without_generating_samples(self):
        class Port:
            def __init__(self, wire): self.wire, self.writes = wire, []
            @property
            def in_waiting(self): return len(self.wire)
            def read(self, size):
                chunk, self.wire = self.wire[:size], self.wire[size:]
                return chunk
            def write(self, data): self.writes.append(data)
            def flush(self): pass
        clock = [0.0]
        def monotonic():
            clock[0] += 0.01
            return clock[0]
        with tempfile.TemporaryDirectory() as folder:
            box = b.Outbox(Path(folder)/"capture.sqlite3", {"session": RUN, "t1": .8, "t2": 1.8})
            port = Port(self.wire)
            with patch.object(b, "synchronize", return_value=1793649600123), patch.object(b.time, "monotonic", side_effect=monotonic), patch.object(b, "utc_ms", side_effect=lambda: 1793649600123 + int(clock[0]*1000)):
                self.assertEqual(b.capture(port, box, 3), 12)
            self.assertEqual(len(box.pending()), 12)
            self.assertEqual(port.writes, [b"STOP\n"])
            # Empty physical input must fail, never synthesize laptop readings.
            port = Port(b"")
            with patch.object(b, "synchronize", return_value=1793649600123), patch.object(b.time, "monotonic", side_effect=monotonic), patch.object(b, "utc_ms", return_value=1793649600123):
                with self.assertRaises(ValueError): b.capture(port, box, 0.1)
            box.db.close()

    def test_validation_rejects_bad_packets(self):
        for key, value in [("imu_id", True), ("sequence", True), ("sequence", -1), ("magnitude", float("nan")), ("magnitude", .1), ("severity", "normal"), ("t2", 2), ("run_id", str(uuid.uuid4())), ("id", "broken"), ("recorded_at", "1970-01-01T00:00:00.000Z"), ("longitude", 0)]:
            with self.subTest(key=key, value=value):
                packet = {**self.packets[0], key: value}
                with self.assertRaises(ValueError):
                    b.validate(packet, RUN, .8, 1.8, 1793649600123, 1793649601123)

    def test_serial_framing(self):
        frame = json.dumps(self.packets[0]).encode()
        f = b.Framer()
        self.assertEqual(f.feed(frame[:10]), [])
        self.assertEqual(f.feed(frame[10:] + b"\r\n" + frame + b"\n"), [self.packets[0]]*2)
        for raw in [b"x\n", b"[]\n", b"\xff\n", b"x"*1025]:
            with self.assertRaises((ValueError, UnicodeError)):
                b.Framer().feed(raw)

    def test_outbox_survives_restart_first_write_wins(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "outbox.sqlite3"
            box = b.Outbox(path, {"session": RUN})
            event = self.event()
            self.assertTrue(box.add(event))
            self.assertFalse(box.add({**event, "severity": "critical"}))
            self.assertFalse(box.add({**event, "id": str(uuid.uuid4())}))
            box.db.close()
            box = b.Outbox(path)
            self.assertEqual(box.pending(), [event])
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            box.db.close()

    def test_upload_failure_retries_identical_payload(self):
        class Fake:
            url = "https://example.supabase.co"
            owner = "owner"
            fail = True
            calls = []
            def session(self, session):
                assert session == RUN
            def rpc(self, name, **body):
                self.calls.append((name, copy.deepcopy(body)))
                if self.fail:
                    raise RuntimeError("lost response after possible cloud commit")
        with tempfile.TemporaryDirectory() as folder:
            box = b.Outbox(Path(folder)/"outbox.sqlite3", {"url": Fake.url, "owner": Fake.owner, "session": RUN})
            box.add(self.event())
            cloud = Fake()
            with self.assertRaises(RuntimeError):
                b.upload(cloud, box)
            self.assertEqual(len(box.pending()), 1)
            cloud.fail = False
            b.upload(cloud, box)
            self.assertEqual(cloud.calls[0], cloud.calls[1])
            self.assertEqual(cloud.calls[-1][0], "finish_driving_session")
            self.assertEqual(box.pending(), [])
            cloud.owner = "different"
            with self.assertRaises(ValueError):
                b.upload(cloud, box)
            box.db.close()

    def test_batch_limit(self):
        class Fake:
            url, owner = "https://example.supabase.co", "owner"
            sizes = []
            def session(self, session): pass
            def rpc(self, name, **body):
                if name == "ingest_threshold_events":
                    self.sizes.append(len(body["p_events"]))
        with tempfile.TemporaryDirectory() as folder:
            box = b.Outbox(Path(folder)/"outbox.sqlite3", {"url": Fake.url, "owner": Fake.owner, "session": RUN})
            for sequence in range(1, 206):
                box.add({**self.event(), "id": str(uuid.uuid4()), "sequence": sequence})
            cloud = Fake()
            b.upload(cloud, box)
            self.assertEqual(cloud.sizes, [100, 100, 5])
            box.db.close()


class AuthTests(unittest.TestCase):
    def test_privileged_keys_refused(self):
        for key in ["sb_secret_bad", "", "broken"]:
            with self.assertRaises(ValueError): b.Cloud("https://example.supabase.co", key)
        b.Cloud("https://example.supabase.co", "sb_publishable_test")
        with self.assertRaises(ValueError): b.Cloud("http://example.supabase.co", "sb_publishable_test")

    def test_http_auth_and_rpc(self):
        responses = [{"access_token": "user-token", "refresh_token": "refresh", "expires_in": 3600}, {"id": "owner"}, RUN]
        requests = []
        def urlopen(request, timeout):
            requests.append(request)
            return io.BytesIO(json.dumps(responses.pop(0)).encode())
        with patch.object(b.urllib.request, "urlopen", side_effect=urlopen):
            cloud = b.Cloud("https://example.supabase.co", "sb_publishable_test")
            cloud.authenticate("owner@example.test", "test-only")
            self.assertEqual(cloud.rpc("create_driving_session", p_label="test", p_data_source="simulated"), RUN)
        self.assertEqual(requests[2].get_header("Authorization"), "Bearer user-token")
        self.assertEqual(json.loads(requests[2].data)["p_data_source"], "simulated")
        self.assertNotIn("owner_id", json.loads(requests[2].data))

    def test_session_guard(self):
        cloud = b.Cloud("https://example.supabase.co", "sb_publishable_test")
        cloud.owner, cloud.expires = "owner", time.time()+3600
        for row in [{"owner_id": "other", "data_source": "simulated"}, {"owner_id": "owner", "data_source": "device"}]:
            with patch.object(cloud, "request", return_value=[row]):
                with self.assertRaises(ValueError): cloud.session(RUN)


class HandshakeTests(unittest.TestCase):
    class Port:
        in_waiting = 0
        def __init__(self, mismatch=False):
            self.writes, self.input, self.mismatch = [], bytearray(), mismatch
        def write(self, data):
            self.writes.append(data)
            if data.startswith(b"SYNC"):
                _, run, nonce, utc, t1, t2 = data.decode().split()
                self.input.extend((json.dumps({"type": "ready", "run_id": run, "nonce": "bad" if self.mismatch else nonce, "utc_ms": int(utc), "t1": float(t1), "t2": float(t2)}) + "\n").encode())
        def read(self, count):
            chunk = bytes(self.input[:count])
            del self.input[:count]
            return chunk
        def flush(self): pass
        def reset_input_buffer(self): self.input.clear()

    def test_valid_challenge_and_no_start_on_mismatch(self):
        port = self.Port()
        self.assertGreater(b.synchronize(port, RUN, .8, 1.8), 0)
        self.assertTrue(port.writes[-1].startswith(b"START "))
        port = self.Port(mismatch=True)
        with self.assertRaises(ValueError): b.synchronize(port, RUN, .8, 1.8)
        self.assertFalse(any(line.startswith(b"START") for line in port.writes))

    def test_timeout_no_start(self):
        port = self.Port()
        port.read = lambda count: b""
        with self.assertRaises(ValueError): b.synchronize(port, RUN, .8, 1.8)
        self.assertFalse(any(line.startswith(b"START") for line in port.writes))


if __name__ == "__main__":
    unittest.main()
