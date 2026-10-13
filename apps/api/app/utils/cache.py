import time
from collections import OrderedDict
from threading import RLock


class TTLCache[T]:
    """Thread-safe LRU cache with per-entry expiry. Safe to share across the event loop."""

    def __init__(self, ttl_seconds: int, max_entries: int = 512):
        self.ttl = ttl_seconds
        self.max_entries = max_entries
        self._store: OrderedDict[str, tuple[T, float]] = OrderedDict()
        self._lock = RLock()
        self.hits = 0
        self.misses = 0

    def get(self, key: str) -> T | None:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                self.misses += 1
                return None
            value, expires_at = entry
            if time.monotonic() > expires_at:
                self._store.pop(key, None)
                self.misses += 1
                return None
            self._store.move_to_end(key)
            self.hits += 1
            return value

    def set(self, key: str, value: T) -> None:
        if self.ttl <= 0:
            return
        with self._lock:
            self._store[key] = (value, time.monotonic() + self.ttl)
            self._store.move_to_end(key)
            while len(self._store) > self.max_entries:
                self._store.popitem(last=False)

    def stats(self) -> dict[str, int]:
        with self._lock:
            return {"entries": len(self._store), "hits": self.hits, "misses": self.misses}
