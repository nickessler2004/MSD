#!/usr/bin/env python3
"""Finite ESP32 USB capture followed by authenticated RPC upload. Python >=3.9."""
import argparse
import base64
from datetime import datetime, timezone
import getpass
import json
import math
import os
from pathlib import Path
import re
import secrets
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


def utc_ms():
    return time.time_ns() // 1_000_000


def timestamp_ms(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", value):
        raise ValueError("Expected a millisecond ISO 8601 UTC source timestamp")
    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)


def thresholds(t1, t2):
    if not all(type(x) in (int, float) and math.isfinite(x) for x in (t1, t2)) or not 0 < t1 < t2 <= 10:
        raise ValueError("Require 0 < T1 < T2 <= 10 g")


class Framer:
    """Bounded NDJSON framing, including partial reads and CRLF. Fail closed."""
    def __init__(self):
        self.pending = bytearray()

    def feed(self, chunk):
        result = []
        for byte in chunk:
            if byte == 10:
                if self.pending:
                    value = json.loads(self.pending.decode("utf-8"))
                    if not isinstance(value, dict):
                        raise ValueError("Serial frame must be a JSON object")
                    result.append(value)
                self.pending.clear()
            else:
                self.pending.append(byte)
                if len(self.pending) > 1024:
                    raise ValueError("Oversized serial frame; capture stopped")
        return result


def validate(packet, run, t1, t2, start, end):
    fields = {"type", "run_id", "id", "sequence", "imu_id", "recorded_at", "magnitude", "severity", "t1", "t2", "latitude", "longitude"}
    if set(packet) != fields or packet["type"] != "event" or packet["run_id"] != run:
        raise ValueError("Unexpected packet or run; capture stopped")
    if str(uuid.UUID(packet["id"])) != packet["id"] or uuid.UUID(packet["id"]).version != 4:
        raise ValueError("Event needs a canonical UUID v4")
    if type(packet["sequence"]) is not int or not 1 <= packet["sequence"] <= 2**53 - 1:
        raise ValueError("Invalid event sequence")
    if type(packet["imu_id"]) is not int or packet["imu_id"] not in (1, 2, 3):
        raise ValueError("Invalid IMU ID")
    thresholds(packet["t1"], packet["t2"])
    if (packet["t1"], packet["t2"]) != (t1, t2):
        raise ValueError("Threshold acknowledgement mismatch")
    peak = packet["magnitude"]
    if type(peak) not in (int, float) or not math.isfinite(peak) or peak < t1:
        raise ValueError("Invalid threshold magnitude")
    if packet["severity"] != ("warning" if peak <= t2 else "critical"):
        raise ValueError("Severity disagrees with magnitude")
    if packet["latitude"] is not None or packet["longitude"] is not None:
        raise ValueError("This simulator has no GPS")
    if not start <= timestamp_ms(packet["recorded_at"]) <= end:
        raise ValueError("Source time outside synchronized capture window")
    return {key: value for key, value in packet.items() if key not in ("type", "run_id")}


class Outbox:
    def __init__(self, path, metadata=None):
        # File contains telemetry and project/session/owner IDs, never tokens/passwords.
        if metadata is not None:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            os.close(fd)
        self.db = sqlite3.connect(path)
        if metadata is not None:
            self.db.executescript("CREATE TABLE metadata (body TEXT NOT NULL); CREATE TABLE events (id TEXT PRIMARY KEY, sequence INTEGER UNIQUE NOT NULL, body TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0);")
            self.db.execute("INSERT INTO metadata VALUES (?)", (json.dumps(metadata),))
            self.db.commit()
        self.meta = json.loads(self.db.execute("SELECT body FROM metadata").fetchone()[0])

    def add(self, event):
        # Identical retries and conflicting UUID/sequence keys preserve first write.
        if self.db.execute("SELECT 1 FROM events WHERE id=? OR sequence=?", (event["id"], event["sequence"])).fetchone():
            return False
        highest = self.db.execute("SELECT COALESCE(MAX(sequence),0) FROM events").fetchone()[0]
        if event["sequence"] <= highest:
            raise ValueError("Event sequence moved backwards; new capture required")
        self.db.execute("INSERT INTO events(id,sequence,body) VALUES (?,?,?)", (event["id"], event["sequence"], json.dumps(event, separators=(",", ":"), allow_nan=False)))
        self.db.commit()
        return True

    def pending(self):
        return [json.loads(row[0]) for row in self.db.execute("SELECT body FROM events WHERE sent=0 ORDER BY sequence LIMIT 100")]


def public_key(key):
    if key.startswith("sb_publishable_"):
        return
    try:
        claims = json.loads(base64.urlsafe_b64decode(key.split(".")[1] + "=="))
        if claims.get("role") == "anon":
            return
    except (ValueError, IndexError):
        pass
    raise ValueError("Use only the public publishable/anon key; privileged keys refused")


class Cloud:
    def __init__(self, url, key):
        if not re.fullmatch(r"https://[a-z0-9-]+\.supabase\.co", url):
            raise ValueError("Use the project's https://<ref>.supabase.co URL")
        public_key(key)
        self.url, self.key, self.token, self.refresh = url, key, None, None
        self.expires = 0

    def request(self, path, body=None):
        headers = {"apikey": self.key, "Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        data = None if body is None else json.dumps(body, allow_nan=False).encode()
        request = urllib.request.Request(self.url + path, data=data, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                raw = response.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as exc:
            # Do not print request headers, auth responses, or credentials.
            raise RuntimeError("Cloud request failed (HTTP %s): %s" % (exc.code, path.split("?")[0])) from None

    def authenticate(self, email, password):
        self._session(self.request("/auth/v1/token?grant_type=password", {"email": email, "password": password}))
        self.owner = self.request("/auth/v1/user")["id"]

    def _session(self, result):
        self.token, self.refresh = result["access_token"], result["refresh_token"]
        self.expires = time.time() + result["expires_in"]

    def ensure_auth(self):
        if time.time() + 30 >= self.expires:
            self._session(self.request("/auth/v1/token?grant_type=refresh_token", {"refresh_token": self.refresh}))

    def rpc(self, name, **body):
        self.ensure_auth()
        return self.request("/rest/v1/rpc/" + name, body)

    def session(self, session_id):
        self.ensure_auth()
        rows = self.request("/rest/v1/driving_sessions?id=eq." + str(uuid.UUID(session_id)) + "&select=*")
        if len(rows) != 1 or rows[0]["owner_id"] != self.owner or rows[0]["data_source"] != "simulated":
            raise ValueError("Expected a simulated session owned by this account")
        return rows[0]


def upload(cloud, outbox):
    meta = outbox.meta
    if meta["url"] != cloud.url or meta["owner"] != cloud.owner:
        raise ValueError("Outbox belongs to a different project or owner")
    cloud.session(meta["session"])
    while True:
        batch = outbox.pending()
        if not batch:
            break
        # On any failure, leave the original batch durable. Retry the command;
        # even a server commit followed by a lost response is safe to replay.
        cloud.rpc("ingest_threshold_events", p_session_id=meta["session"], p_events=batch)
        outbox.db.executemany("UPDATE events SET sent=1 WHERE id=?", [(event["id"],) for event in batch])
        outbox.db.commit()
        print("Uploaded %d events" % len(batch), flush=True)
    cloud.rpc("finish_driving_session", p_session_id=meta["session"])


def synchronize(port, run, t1, t2):
    port.write(b"STOP\n")
    port.flush()
    # Let previous output drain, then start a fresh challenge. No boot text is
    # interpreted as telemetry. USB board firmware itself is otherwise silent.
    time.sleep(0.2)
    port.reset_input_buffer()
    nonce = secrets.token_hex(16)
    epoch, sent = utc_ms(), time.monotonic()
    port.write(("SYNC %s %s %d %.17g %.17g\n" % (run, nonce, epoch, t1, t2)).encode())
    port.flush()
    framer = Framer()
    while time.monotonic() - sent < 0.4:
        for ready in framer.feed(port.read(1)):
            if ready != {"type": "ready", "run_id": run, "nonce": nonce, "utc_ms": epoch, "t1": t1, "t2": t2}:
                raise ValueError("Unexpected clock acknowledgement")
            if time.monotonic() - sent >= 0.4 or abs(utc_ms() - epoch - (time.monotonic() - sent)*1000) > 100:
                raise ValueError("Slow handshake or laptop clock changed")
            port.write(("START %s\n" % nonce).encode())
            port.flush()
            return epoch
    raise ValueError("Clock handshake timed out; board remains paused")


def capture(port, outbox, seconds):
    meta = outbox.meta
    anchor = synchronize(port, meta["session"], meta["t1"], meta["t2"])
    started = time.monotonic()
    framer, count, imus = Framer(), 0, set()
    try:
        while time.monotonic() - started < seconds:
            elapsed = time.monotonic() - started
            if abs(utc_ms() - anchor - elapsed*1000) > 1000:
                raise ValueError("Laptop clock changed during capture; stopped")
            for packet in framer.feed(port.read(max(1, min(port.in_waiting, 1024)))):
                event = validate(packet, meta["session"], meta["t1"], meta["t2"], anchor, min(anchor + 60000, utc_ms() + 500))
                if outbox.add(event):
                    count += 1
                    imus.add(event["imu_id"])
                    print("Saved #%d IMU %d %s %.3f g" % (event["sequence"], event["imu_id"], event["severity"], event["magnitude"]), flush=True)
    finally:
        port.write(b"STOP\n")
        port.flush()
    if count == 0 or imus != {1, 2, 3}:
        raise ValueError("Incomplete capture: expected actual events from all three simulated IMUs")
    return count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", help="e.g. /dev/cu.usbmodem1101")
    parser.add_argument("--seconds", type=int, default=30)
    parser.add_argument("--t1", type=float, default=0.8)
    parser.add_argument("--t2", type=float, default=1.8)
    parser.add_argument("--retry", type=Path, help="Upload an existing SQLite outbox; does not open USB")
    parser.add_argument("--outbox", type=Path, help="New file (must not exist); defaults under work/")
    parser.add_argument("--share-email", help="Explicitly share new session with an existing confirmed observer")
    args = parser.parse_args()
    thresholds(args.t1, args.t2)
    if not args.retry and (not args.port or not 3 <= args.seconds <= 45):
        parser.error("Capture needs --port and --seconds between 3 and 45")
    cloud = Cloud(os.environ.get("VITE_SUPABASE_URL", "").rstrip("/"), os.environ.get("VITE_SUPABASE_PUBLISHABLE_KEY", ""))
    email = os.environ.get("MSD_TEST_EMAIL") or input("Session-owner email: ").strip()
    password = os.environ.get("MSD_TEST_PASSWORD") or getpass.getpass("Session-owner password (hidden): ")
    cloud.authenticate(email, password)
    del password
    if args.retry:
        outbox = Outbox(args.retry)
    else:
        import serial
        # Open USB before creating cloud state, but authenticate first.
        with serial.Serial(args.port, 115200, timeout=0.05, write_timeout=1) as port:
            time.sleep(2)  # USB enumeration / board reset
            session = cloud.rpc("create_driving_session", p_label="SIMULATED — ESP32 USB bench " + datetime.now(timezone.utc).isoformat(timespec="seconds"), p_data_source="simulated")
            path = args.outbox or Path("work") / ("usb-" + session + ".sqlite3")
            path.parent.mkdir(parents=True, exist_ok=True)
            outbox = Outbox(path, {"url": cloud.url, "owner": cloud.owner, "session": session, "t1": args.t1, "t2": args.t2})
            print("Session: %s\nOutbox: %s" % (session, path), flush=True)
            row = cloud.session(session)
            server_start = datetime.fromisoformat(row["started_at"].replace("Z", "+00:00")).timestamp()*1000
            if not 0 <= utc_ms() - server_start < 5000:
                raise ValueError("Laptop UTC differs from session start; enable macOS automatic time and retry as a NEW capture")
            cloud.rpc("set_imu_thresholds", p_session_id=session, p_thresholds=[{"imu_id": imu, "t1": args.t1, "t2": args.t2} for imu in (1, 2, 3)])
            if args.share_email:
                cloud.rpc("share_session", p_session_id=session, p_email=args.share_email)
            print("Capturing USB packets; uploads begin after capture ends.", flush=True)
            capture(port, outbox, args.seconds)
    upload(cloud, outbox)
    print("Cloud upload complete; session finished: " + outbox.meta["session"])


if __name__ == "__main__":
    try:
        main()
    except (Exception, KeyboardInterrupt) as error:
        print("Stopped: %s. Saved packets remain in the printed outbox; use --retry after fixing the cause." % (str(error) or "interrupted"), file=sys.stderr)
        sys.exit(1)
