"""Ajanların hafızası: daha önce görülen olayları JSON dosyasında tutar."""
import json
import os

STATE_DIR = os.environ.get("JARVIS_STATE_DIR", "state")
MAX_KEYS = 2000


class State:
    def __init__(self, name):
        self.path = os.path.join(STATE_DIR, f"{name}.json")
        self.data = {"seen": [], "assignments": {}, "materials": {}}
        if os.path.exists(self.path):
            with open(self.path, encoding="utf-8") as f:
                self.data.update(json.load(f))
        self.is_new = not os.path.exists(self.path)
        self._seen = set(self.data["seen"])

    def seen(self, key):
        return key in self._seen

    def mark(self, key):
        if key not in self._seen:
            self._seen.add(key)
            self.data["seen"].append(key)

    def save(self):
        self.data["seen"] = self.data["seen"][-MAX_KEYS:]
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.data, f, ensure_ascii=False, indent=1)
        os.replace(tmp, self.path)
