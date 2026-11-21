import hmac, json, os, queue, threading, time, uuid
from datetime import datetime, timezone
from flask import Flask, Response, jsonify, render_template, request
try:
    from flask_cors import CORS
except ImportError:  # optional: the bundled UI is same-origin
    CORS = lambda app: None
import qubit

app = Flask(__name__)
CORS(app)

MAX_ATTEMPTS = 3
LOCK = threading.Lock()
MESSAGES, ALERTS, SUBS = {}, {}, {}          # in-memory demo store
STATS = {"sent": 0, "opened": 0, "wrong": 0, "locked": 0, "expired": 0}


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def body():
    return request.get_json(silent=True) or {}


def public(m):
    return {k: m[k] for k in ("id", "sender", "to", "created", "status", "attempts", "destruct", "expires_at")} | {"max": MAX_ATTEMPTS}


def notify(token, kind, m, text):
    ev = {"kind": kind, "id": m["id"], "to": m["to"], "text": text, "time": now()}
    ALERTS.setdefault(token, []).insert(0, ev)
    for q in SUBS.get(token, []):
        q.put(ev)


def purge():
    """Delete expired messages and tell their senders. Call while holding LOCK."""
    t = time.time()
    for mid, m in list(MESSAGES.items()):
        if m["expires_at"] and t >= m["expires_at"]:
            del MESSAGES[mid]
            STATS["expired"] += 1
            notify(m["token"], "expired", m, f"Your message to {m['to']} expired and was deleted.")


def _janitor():
    while True:
        time.sleep(5)
        with LOCK:
            purge()


def fail(error, status, m=None):
    return jsonify(error=error, attempts=m["attempts"] if m else 0, max=MAX_ATTEMPTS), status


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/generate-key")
def generate_key():
    return jsonify(key=qubit.generate_key(min(max(request.args.get("length", 8, type=int), 1), 64)))


@app.get("/states")
def states():
    return jsonify(qubit.all_states())


@app.get("/stats")
def stats():
    with LOCK:
        purge()
    return jsonify(STATS | {"waiting": sum(m["status"] == "unread" for m in MESSAGES.values())})


@app.post("/send")
def send():
    d = body()
    try:
        text = (d.get("message") or "").strip()
        if not text or len(text) > 500:
            raise ValueError("Enter a message (1-500 characters).")
        if not d.get("token"):
            raise ValueError("Missing sender ID. Refresh the page.")
        qubit.validate_key(d.get("key"))  # raises if empty
        key = d["key"]
        enc = qubit.encode(text, key)
    except ValueError as e:
        return jsonify(error=str(e)), 400
    minutes = min(max(int(d.get("expires") or 0), 0), 10080)
    salt = os.urandom(8).hex()
    m = {"id": uuid.uuid4().hex[:8], "sender": (d.get("sender") or "Anonymous")[:30],
         "to": (d.get("to") or "Receiver")[:30], "created": now(), "status": "unread", "attempts": 0,
         "cipher_hex": enc["cipher_hex"], "salt": salt, "key_hash": qubit.hash_key(key, salt),
         "token": d["token"], "destruct": bool(d.get("destruct")),
         "expires_at": time.time() + minutes * 60 if minutes else None}
    with LOCK:
        MESSAGES[m["id"]] = m
        STATS["sent"] += 1
    return jsonify(message=public(m), cipher_hex=enc["cipher_hex"], groups=enc["groups"])


@app.get("/inbox")
def inbox():
    with LOCK:
        purge()
    return jsonify(sorted((public(m) for m in MESSAGES.values()), key=lambda x: x["created"], reverse=True))


@app.post("/open/<mid>")
def open_message(mid):
    key = body().get("key")
    with LOCK:
        purge()
        m = MESSAGES.get(mid)
        if not m:
            return fail("Message not found. It may have been destroyed or expired.", 404)
        if m["status"] == "locked":
            return fail("This message is locked. The sender has been alerted.", 423, m)
        try:
            ok = hmac.compare_digest(qubit.hash_key(key, m["salt"]), m["key_hash"])
        except ValueError:
            ok = False
        if not ok:
            m["attempts"] += 1
            STATS["wrong"] += 1
            if m["attempts"] >= MAX_ATTEMPTS:
                m["status"] = "locked"
                STATS["locked"] += 1
                notify(m["token"], "locked", m,
                       f"Someone tried to access your message to {m['to']}. They entered a wrong key {MAX_ATTEMPTS} times, so it is now locked.")
                return fail("Attempt 3/3. Message locked and the sender has been alerted.", 423, m)
            return fail(f"Wrong key. Attempt {m['attempts']}/{MAX_ATTEMPTS}.", 401, m)
        if m["status"] == "unread":
            STATS["opened"] += 1
            notify(m["token"], "read", m, f"Your message to {m['to']} was opened with the correct key."
                   + (" It has self-destructed." if m["destruct"] else ""))
        m["status"], m["attempts"] = "read", 0
        result = qubit.decode(m["cipher_hex"], key) | {"message_info": public(m), "destroyed": m["destruct"]}
        if m["destruct"]:
            del MESSAGES[mid]
        return jsonify(result)


@app.post("/unlock/<mid>")
def unlock(mid):
    with LOCK:
        m = MESSAGES.get(mid)
        if not m or m["token"] != body().get("token"):
            return fail("Only the sender can unlock this message.", 403)
        m["status"], m["attempts"] = "unread", 0
    return jsonify(public(m))


@app.get("/alerts")
def alerts():
    return jsonify(ALERTS.get(request.args.get("token", ""), []))


@app.get("/events")
def events():
    token, q = request.args.get("token", ""), queue.Queue()
    SUBS.setdefault(token, []).append(q)

    def stream():
        try:
            yield "retry: 3000\n\n"
            while True:
                try:
                    yield f"data: {json.dumps(q.get(timeout=15))}\n\n"
                except queue.Empty:
                    yield ": ping\n\n"
        finally:
            SUBS[token].remove(q)
    return Response(stream(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


if __name__ == "__main__":
    threading.Thread(target=_janitor, daemon=True).start()
    app.run(debug=True, use_reloader=False, threaded=True)
