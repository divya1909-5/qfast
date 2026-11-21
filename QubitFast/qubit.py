"""Core logic: 4-bit XOR cipher + 16-state qubit mapping (no Flask dependency)."""
import math
import secrets

HEX = "0123456789abcdef"
# 4 polar rings (kept off the poles so all 16 states stay distinct) x 4 azimuths
THETAS = [math.radians(a) for a in (36, 72, 108, 144)]
PHIS = [math.radians(a) for a in (0, 90, 180, 270)]


def generate_key(length=8):
    """Random shared secret key as hex digits (one digit = one 4-bit group)."""
    return "".join(secrets.choice(HEX) for _ in range(length))


def validate_key(key):
    """Any non-empty text is a valid secret key; its UTF-8 bytes (as hex digits) drive the XOR."""
    key = (key or "").strip()
    if not key:
        raise ValueError("Enter a secret key.")
    return key.encode("utf-8").hex()


def to_nibbles(message):
    """Text -> UTF-8 bytes -> list of 4-bit values (high nibble, low nibble)."""
    out = []
    for b in message.encode("utf-8"):
        out += [b >> 4, b & 0xF]
    return out


def from_nibbles(nibbles):
    if len(nibbles) % 2:
        raise ValueError("Cipher must contain an even number of 4-bit groups.")
    data = bytes((nibbles[i] << 4) | nibbles[i + 1] for i in range(0, len(nibbles), 2))
    return data.decode("utf-8", errors="replace")


def xor_nibbles(nibbles, key):
    k = [int(c, 16) for c in validate_key(key)]
    return [n ^ k[i % len(k)] for i, n in enumerate(nibbles)]


def qubit_state(n):
    """Map a 4-bit value (0-15) to a qubit |psi> = cos(t/2)|0> + e^{i p} sin(t/2)|1>."""
    if not 0 <= n <= 15:
        raise ValueError("4-bit value must be 0-15.")
    theta, phi = THETAS[n >> 2], PHIS[n & 3]
    return {
        "bits": format(n, "04b"),
        "theta_deg": round(math.degrees(theta)),
        "phi_deg": round(math.degrees(phi)),
        "alpha": round(math.cos(theta / 2), 4),
        "beta_mag": round(math.sin(theta / 2), 4),
        "bloch": [round(math.sin(theta) * math.cos(phi), 4),
                  round(math.sin(theta) * math.sin(phi), 4),
                  round(math.cos(theta), 4)],
    }


def encode(message, key):
    plain = to_nibbles(message)
    cipher = xor_nibbles(plain, key)
    return {
        "cipher_hex": "".join(HEX[c] for c in cipher),
        "groups": [{"plain": format(p, "04b"), "cipher": qubit_state(c)}
                   for p, c in zip(plain, cipher)],
    }


def decode(cipher_hex, key):
    cipher_hex = (cipher_hex or "").strip().lower()
    if not cipher_hex or any(c not in HEX for c in cipher_hex):
        raise ValueError("Cipher must be hex digits (0-9, a-f).")
    cipher = [int(c, 16) for c in cipher_hex]
    plain = xor_nibbles(cipher, key)
    return {
        "message": from_nibbles(plain),
        "groups": [qubit_state(c) | {"plain": format(p, "04b")}
                   for c, p in zip(cipher, plain)],
    }


def all_states():
    return [{"n": n} | qubit_state(n) for n in range(16)]


def hash_key(key, salt):
    """Salted PBKDF2 hash so the key itself is never stored (demo-grade)."""
    import hashlib
    return hashlib.pbkdf2_hmac("sha256", validate_key(key).encode(), bytes.fromhex(salt), 50_000).hex()
