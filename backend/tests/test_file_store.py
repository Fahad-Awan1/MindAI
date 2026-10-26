"""Uploaded files survive a wiped disk (cloud hosts restart with an empty disk): they come back from the database."""
import os

from config import resolve_path


def test_file_comes_back_from_the_database(client):
    from services.document_service import delete_file, load_binary_file, save_binary_file
    from services import file_store

    stored = save_binary_file(b"%PDF-1.4 fake pdf bytes", "pdf")
    os.remove(resolve_path(stored))  # The host restarted: the disk copy is gone

    assert load_binary_file(stored) == b"%PDF-1.4 fake pdf bytes"
    assert os.path.exists(resolve_path(stored))  # ...and it is back on disk for next time

    delete_file(stored)
    assert not os.path.exists(resolve_path(stored)) and file_store.load(stored) is None
    assert load_binary_file(stored) is None
