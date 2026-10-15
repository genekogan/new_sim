"""Installer safety checks with synthetic values only; never calls the human prompts."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('cdn_install_key', Path(__file__).with_name('install-key.py'))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallKeyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='installer-test-', dir='<team>/scratch/cdn')
        self.addCleanup(self.temp.cleanup)
        self.target = Path(self.temp.name) / 'synthetic-only.txt'

    def write(self):
        installer.write_credentials(self.target, 'SYNTHETIC_TEST_KEY', 'SYNTHETIC_TEST_SECRET')

    def test_fd_permissions_survive_restrictive_umask(self):
        previous = os.umask(0o777)
        try:
            self.write()
        finally:
            os.umask(previous)
        self.assertEqual(self.target.stat().st_mode & 0o777, 0o600)

    def test_permission_failure_removes_created_file(self):
        with patch.object(installer.os, 'fchmod', side_effect=OSError('synthetic mode failure')):
            with self.assertRaises(OSError):
                self.write()
        self.assertFalse(self.target.exists())

    def test_partial_write_failure_removes_created_file(self):
        real_fdopen = os.fdopen

        class PartialWriter:
            def __init__(self, file):
                self.file = file

            def __enter__(self):
                return self

            def write(self, value):
                self.file.write(value[:5])
                self.file.flush()
                raise OSError('synthetic partial write')

            def __exit__(self, *_args):
                self.file.close()

        with patch.object(installer.os, 'fdopen', side_effect=lambda *a, **kw: PartialWriter(real_fdopen(*a, **kw))):
            with self.assertRaises(OSError):
                self.write()
        self.assertFalse(self.target.exists())

    def test_fsync_failure_and_interrupt_remove_created_file(self):
        for error in [OSError('synthetic fsync failure'), KeyboardInterrupt()]:
            with self.subTest(error=type(error).__name__), patch.object(installer.os, 'fsync', side_effect=error):
                with self.assertRaises(type(error)):
                    self.write()
            self.assertFalse(self.target.exists())

    def test_existing_file_and_links_are_never_replaced(self):
        original = Path(self.temp.name) / 'original.txt'
        original.write_text('existing synthetic record')
        for kind in ['file', 'symlink', 'dangling']:
            if kind == 'file':
                self.target.write_text('existing synthetic record')
            else:
                self.target.symlink_to(original if kind == 'symlink' else Path(self.temp.name) / 'absent')
            with self.assertRaises(FileExistsError):
                self.write()
            if kind == 'file':
                self.assertEqual(self.target.read_text(), 'existing synthetic record')
            else:
                self.assertTrue(self.target.is_symlink())
            self.target.unlink()
        self.assertEqual(original.read_text(), 'existing synthetic record')

    def test_failure_cleanup_preserves_replacement_inode(self):
        saved = Path(self.temp.name) / 'original-created.txt'

        def replace_then_fail(_fd):
            self.target.rename(saved)
            self.target.write_text('replacement must survive')
            raise OSError('synthetic failure after replacement')

        with patch.object(installer.os, 'fsync', side_effect=replace_then_fail):
            with self.assertRaises(OSError):
                self.write()
        self.assertEqual(self.target.read_text(), 'replacement must survive')


if __name__ == '__main__':
    unittest.main()
