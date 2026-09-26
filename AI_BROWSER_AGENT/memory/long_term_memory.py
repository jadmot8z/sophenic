from memory.sqlite_storage import now


class LongTermMemory:
    def __init__(self, storage):
        self.storage = storage

    def preferences(self):
        with self.storage.lock:
            return dict(self.storage.db.execute("SELECT key,value FROM preferences"))

    def set_preference(self, key, value):
        with self.storage.lock, self.storage.db:
            self.storage.db.execute("INSERT OR REPLACE INTO preferences VALUES (?,?)", (key, value))

    def learn_error(self, action, error):
        with self.storage.lock, self.storage.db:
            self.storage.db.execute(
                "INSERT INTO lessons(at,action,error) VALUES (?,?,?)", (now(), action, error[:2000])
            )

    def lessons(self):
        with self.storage.lock:
            return [
                dict(r)
                for r in self.storage.db.execute("SELECT action,error FROM lessons ORDER BY id DESC LIMIT 8")
            ]
