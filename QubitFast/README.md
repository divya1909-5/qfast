# QubitFast – Quantum Secure Messaging System (XOR + Qubit Visualization)

Educational simulation: a message is split into 4-bit groups, XOR-encrypted with a shared
secret key, and each encrypted group is mapped to one of 16 distinct qubit states and drawn
on a Bloch sphere. **This is quantum-inspired and for learning only, not production security.**

## Run
```bash
python -m venv venv
venv\Scripts\activate        # Windows  (macOS/Linux: source venv/bin/activate)
pip install -r requirements.txt
python app.py                # open http://127.0.0.1:5000
python -m unittest discover tests
```

## Structure
| Path | Purpose |
|---|---|
| `app.py` | Flask REST API: `GET /generate-key`, `POST /encode`, `POST /decode` |
| `qubit.py` | 4-bit XOR engine and 16-state qubit mapping |
| `templates/index.html`, `static/` | Sender / Receiver UI with SVG Bloch spheres |
| `tests/test_core.py` | Round-trip, key, mapping and edge-case tests |

## New in this version
- Intro page with live stats, feature cards and a step-by-step overview.
- The secret key can be any word, phrase or number. Receiver must enter it. Wrong key shows `Attempt 1/3`, `2/3`; on `3/3` the message locks.
- The sender gets a real-time alert (Server-Sent Events) when a message is locked or read, and can unlock it from the Alerts page.
- Qubit map page with all 16 states and a live XOR demo.
- Demo tip: open the app in two browser tabs (same browser = same sender ID).
- Messages live in memory, so restarting the server clears them. Only a salted hash of each key is stored.

## Feature boxes on the Home page
- **Step-by-step animation**: text -> bytes -> 4-bit groups -> XOR -> qubit states, one stage at a time.
- **BB84 key exchange + Eve**: simulate Alice, Bob and an eavesdropper; Eve raises the error rate to about 25% and is caught, then the key can be sent to the Send page.
- **Self-destruct and expiry**: on the Send page, burn a message after one read or delete it after 1 minute to 1 day. The sender gets an alert when it expires.

## How it works
1. Text -> UTF-8 bytes -> 4-bit groups.
2. Each group XOR the repeating hex key digit -> cipher group.
3. Cipher value `n` -> qubit `cos(θ/2)|0> + e^{iφ} sin(θ/2)|1>` with
   θ from {36°,72°,108°,144°} (n >> 2) and φ from {0°,90°,180°,270°} (n & 3).
4. Receiver pastes the cipher hex + same key to recover the message.

## API
`POST /encode {"message","key"}` -> `{"cipher_hex","groups":[...]}`  
`POST /decode {"cipher","key"}` -> `{"message","groups":[...]}`  
`GET /generate-key?length=8` -> `{"key"}`
