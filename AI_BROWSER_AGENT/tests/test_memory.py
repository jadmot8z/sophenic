from memory.long_term_memory import LongTermMemory
from memory.short_term_memory import ShortTermMemory
from memory.sqlite_storage import SQLiteStorage


def test_persistence(tmp_path):
    path = tmp_path / "memory.db"
    storage = SQLiteStorage(path)
    storage.create_task("t1", "recherche")
    storage.event("t1", "plan", {"steps": ["a"]})
    storage.update_task("t1", "completed", "answer")
    memory = LongTermMemory(storage)
    memory.set_preference("language", "fr")
    memory.learn_error("click", "detached")
    storage.close()
    storage = SQLiteStorage(path)
    assert storage.tasks()[0]["answer"] == "answer"
    assert storage.events("t1")[0]["payload"] == {"steps": ["a"]}
    assert storage.events("t1", 999) == []
    assert LongTermMemory(storage).preferences()["language"] == "fr"
    assert LongTermMemory(storage).lessons()[0]["error"] == "detached"
    storage.close()


def test_bounded_context():
    memory = ShortTermMemory()
    for i in range(30):
        memory.add(i, {})
    assert len(memory.snapshot()) == 12
