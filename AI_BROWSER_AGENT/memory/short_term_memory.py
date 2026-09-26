from collections import deque


class ShortTermMemory:
    def __init__(self):
        self.entries = deque(maxlen=12)

    def add(self, action, result):
        self.entries.append({"action": action, "result": result})

    def snapshot(self):
        return list(self.entries)
