"""Explicit software-only cloud smoke test. Never evidence of physical USB success."""
import importlib.util
from datetime import datetime, timezone
import os
from pathlib import Path
import tempfile
import unittest
import uuid

spec = importlib.util.spec_from_file_location("bridge", Path(__file__).resolve().parents[1] / "bridge.py")
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)


@unittest.skipUnless(os.environ.get("MSD_LIVE_USB_BRIDGE_TEST") == "1", "opt-in live Supabase software test")
class LiveCloud(unittest.TestCase):
    def test_owner_upload_readback_duplicate_and_observer_rls(self):
        cloud = b.Cloud(os.environ["VITE_SUPABASE_URL"], os.environ["VITE_SUPABASE_PUBLISHABLE_KEY"])
        cloud.authenticate(os.environ["MSD_TEST_EMAIL"], os.environ["MSD_TEST_PASSWORD"])
        session = cloud.rpc("create_driving_session", p_label="SIMULATED — SOFTWARE ONLY USB bridge RPC test " + datetime.now(timezone.utc).isoformat(), p_data_source="simulated")
        print("Software-only cloud test session: " + session)
        try:
            with tempfile.TemporaryDirectory() as folder:
                box = b.Outbox(Path(folder)/"outbox.sqlite3", {"url": cloud.url, "owner": cloud.owner, "session": session})
                events = []
                for imu, peak in [(1, .8), (2, 1.8), (3, 2.0)]:
                    packet = {"type": "event", "run_id": session, "id": str(uuid.uuid4()), "sequence": imu, "imu_id": imu, "recorded_at": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"), "magnitude": peak, "severity": "warning" if peak <= 1.8 else "critical", "t1": .8, "t2": 1.8, "latitude": None, "longitude": None}
                    event = b.validate(packet, session, .8, 1.8, b.utc_ms()-1000, b.utc_ms()+1000)
                    events.append(event)
                    box.add(event)
                # Simulate a server commit whose response was lost; outbox retries
                # the same UUIDs/sequences/timestamps through the real RPC.
                cloud.rpc("ingest_threshold_events", p_session_id=session, p_events=events)
                b.upload(cloud, box)
                rows = cloud.request("/rest/v1/threshold_events?session_id=eq." + session + "&order=sequence")
                self.assertEqual(len(rows), 3)
                for source, row in zip(events, rows):
                    self.assertEqual({key: row[key] for key in source if key != "recorded_at"}, {key: value for key, value in source.items() if key != "recorded_at"})
                    self.assertEqual(datetime.fromisoformat(row["recorded_at"].replace("Z", "+00:00")), datetime.fromisoformat(source["recorded_at"].replace("Z", "+00:00")))
                self.assertEqual(cloud.session(session)["data_source"], "simulated")
                if os.environ.get("MSD_OBSERVER_EMAIL") and os.environ.get("MSD_OBSERVER_PASSWORD"):
                    observer = b.Cloud(cloud.url, cloud.key)
                    observer.authenticate(os.environ["MSD_OBSERVER_EMAIL"], os.environ["MSD_OBSERVER_PASSWORD"])
                    if observer.owner != cloud.owner:
                        self.assertEqual(observer.request("/rest/v1/threshold_events?session_id=eq." + session), [])
                        with self.assertRaises(RuntimeError):
                            observer.rpc("ingest_threshold_events", p_session_id=session, p_events=events)
                box.db.close()
        finally:
            cloud.rpc("finish_driving_session", p_session_id=session)
