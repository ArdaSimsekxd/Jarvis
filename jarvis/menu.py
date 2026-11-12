"""Yemek menüsü: data/menu.json dosyasını okur ve bir günün menüsünü metne çevirir."""
import json
import os

from jarvis.agents.canvas_notifier import esc

MENU_PATH = os.environ.get("JARVIS_MENU_PATH") or os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "menu.json")


def load(path=None):
    try:
        with open(path or MENU_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"days": {}}


def lines_for(menu, day):
    """day: datetime.date. O günün menü satırlarını döndürür; menü yoksa boş liste."""
    entry = (menu.get("days") or {}).get(day.isoformat())
    if not entry:
        return []
    if isinstance(entry, list):
        return [f"• {esc(i)}" for i in entry]
    out = []
    for name, value in entry.items():
        if isinstance(value, str) and value:
            out.append(f"• <b>{esc(name)}:</b> {esc(value)}")
        elif isinstance(value, list) and value:
            out.append(f"• <b>{esc(name)}:</b> {esc(', '.join(value))}")
    return out
