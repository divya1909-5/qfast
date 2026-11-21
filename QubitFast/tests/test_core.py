import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import qubit


class CoreTests(unittest.TestCase):
    def test_round_trip(self):
        for msg in ["Hello", "Quantum 123!", "héllo ✓", "a"]:
            enc = qubit.encode(msg, "a3f9")
            self.assertEqual(qubit.decode(enc["cipher_hex"], "a3f9")["message"], msg)

    def test_wrong_key_differs(self):
        enc = qubit.encode("secret", "a3f9")
        self.assertNotEqual(qubit.decode(enc["cipher_hex"], "1234")["message"], "secret")

    def test_sixteen_distinct_states(self):
        states = {tuple(qubit.qubit_state(n)["bloch"]) for n in range(16)}
        self.assertEqual(len(states), 16)

    def test_bloch_vector_is_unit(self):
        for n in range(16):
            x, y, z = qubit.qubit_state(n)["bloch"]
            self.assertAlmostEqual(x * x + y * y + z * z, 1, places=2)

    def test_passphrase_key(self):
        enc = qubit.encode("Hi there", "my secret 123")
        self.assertEqual(qubit.decode(enc["cipher_hex"], "my secret 123")["message"], "Hi there")

    def test_bad_inputs(self):
        for bad in ["", "   ", None]:
            with self.assertRaises(ValueError):
                qubit.validate_key(bad)
        with self.assertRaises(ValueError):
            qubit.decode("abc", "a1")  # odd number of 4-bit groups


if __name__ == "__main__":
    unittest.main()
