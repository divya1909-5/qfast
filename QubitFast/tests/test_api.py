import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import app as appmod


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.c = appmod.app.test_client()
        r = self.c.post("/send", json={"token": "tok", "sender": "A", "to": "B", "message": "Hello", "key": "a3f9"})
        self.mid = r.get_json()["message"]["id"]

    def test_three_strikes_lock_and_alert(self):
        for i in (1, 2):
            r = self.c.post(f"/open/{self.mid}", json={"key": "0000"})
            self.assertEqual((r.status_code, r.get_json()["attempts"]), (401, i))
        r = self.c.post(f"/open/{self.mid}", json={"key": "0000"})
        self.assertEqual(r.status_code, 423)
        # correct key no longer works once locked
        self.assertEqual(self.c.post(f"/open/{self.mid}", json={"key": "a3f9"}).status_code, 423)
        self.assertEqual(self.c.get("/alerts?token=tok").get_json()[0]["kind"], "locked")

    def test_correct_key_and_unlock(self):
        r = self.c.post(f"/open/{self.mid}", json={"key": "a3f9"})
        self.assertEqual(r.get_json()["message"], "Hello")
        for _ in range(3):
            self.c.post(f"/open/{self.mid}", json={"key": "zz"})
        self.assertEqual(self.c.post(f"/unlock/{self.mid}", json={"token": "bad"}).status_code, 403)
        self.assertEqual(self.c.post(f"/unlock/{self.mid}", json={"token": "tok"}).status_code, 200)
        self.assertEqual(self.c.post(f"/open/{self.mid}", json={"key": "a3f9"}).status_code, 200)


class FeatureTests(unittest.TestCase):
    def setUp(self):
        self.c = appmod.app.test_client()

    def send(self, **kw):
        body = {"token": "tok2", "sender": "A", "to": "B", "message": "Burn me", "key": "k1"} | kw
        return self.c.post("/send", json=body).get_json()["message"]["id"]

    def test_self_destruct_after_one_read(self):
        mid = self.send(destruct=True)
        r = self.c.post(f"/open/{mid}", json={"key": "k1"}).get_json()
        self.assertEqual((r["message"], r["destroyed"]), ("Burn me", True))
        self.assertEqual(self.c.post(f"/open/{mid}", json={"key": "k1"}).status_code, 404)

    def test_expiry_deletes_and_alerts_sender(self):
        import time
        mid = self.send(expires=10)
        appmod.MESSAGES[mid]["expires_at"] = time.time() - 1
        self.assertNotIn(mid, [m["id"] for m in self.c.get("/inbox").get_json()])
        self.assertEqual(self.c.get("/alerts?token=tok2").get_json()[0]["kind"], "expired")


if __name__ == "__main__":
    unittest.main()
