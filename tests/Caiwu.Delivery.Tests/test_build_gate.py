"""Delivery pause regression, using only isolated temporary trees and the Python standard library."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest import mock

PROJECT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('caiwu_delivery_build', PROJECT / 'packaging-next/build.py')
BUILD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD)


class DistributionPauseTests(unittest.TestCase):
    def test_unpaused_tree_passes_preflight(self):
        with tempfile.TemporaryDirectory(prefix='caiwu-pause-test-') as temporary:
            BUILD.ensure_delivery_allowed(Path(temporary))

    def test_pause_blocks_before_any_tool_or_output(self):
        with tempfile.TemporaryDirectory(prefix='caiwu-pause-test-') as temporary:
            root = Path(temporary)
            pause = root / 'docs/acceptance/DELIVERY_PAUSED.md'
            pause.parent.mkdir(parents=True)
            pause.write_text('Independent P1 review is pending.', encoding='utf-8')
            output = root / 'artifacts'
            with mock.patch.object(BUILD, 'ROOT', root), mock.patch.object(BUILD, 'run') as tool:
                with mock.patch('sys.argv', ['build.py', '--version', '0.1.0.1', '--makensis', 'must-not-run', '--out', str(output)]):
                    with self.assertRaisesRegex(RuntimeError, 'paused distribution'):
                        BUILD.main()
                tool.assert_not_called()
            self.assertFalse(output.exists())

    def test_empty_pause_marker_still_blocks(self):
        with tempfile.TemporaryDirectory(prefix='caiwu-pause-test-') as temporary:
            root = Path(temporary)
            pause = root / 'docs/acceptance/DELIVERY_PAUSED.md'
            pause.parent.mkdir(parents=True)
            pause.touch()
            with self.assertRaisesRegex(RuntimeError, 'paused distribution'):
                BUILD.ensure_delivery_allowed(root)

    def test_managed_selection_does_not_bypass_pause(self):
        with tempfile.TemporaryDirectory(prefix='caiwu-managed-pause-') as temporary:
            root = Path(temporary)
            pause = root / 'docs/acceptance/DELIVERY_PAUSED.md'
            pause.parent.mkdir(parents=True)
            pause.touch()
            output = root / 'artifacts'
            arguments = ['build.py', '--version', '0.1.0.3', '--makensis', 'must-not-run',
                         '--out', str(output), '--managed-data-contract', '--expected-commit', 'a' * 40]
            with mock.patch.object(BUILD, 'ROOT', root), mock.patch.object(BUILD, 'run') as tool:
                with mock.patch('sys.argv', arguments), self.assertRaisesRegex(RuntimeError, 'paused distribution'):
                    BUILD.main()
                tool.assert_not_called()
            self.assertFalse(output.exists())

    def test_managed_requires_frozen_reviewed_source_before_tools(self):
        for extra, message in [([], 'expected-commit'),
                               (['--expected-commit', 'a' * 40, '--allow-dirty'], 'clean source'),
                               (['--expected-commit', 'a' * 40, '--refresh-locks'], 'frozen dependency')]:
            with self.subTest(extra=extra), tempfile.TemporaryDirectory(prefix='caiwu-managed-gate-') as temporary:
                root = Path(temporary)
                output = root / 'artifacts'
                arguments = ['build.py', '--version', '0.1.0.3', '--makensis', 'must-not-run',
                             '--out', str(output), '--managed-data-contract', *extra]
                with mock.patch.object(BUILD, 'ROOT', root), mock.patch.object(BUILD, 'run') as tool:
                    with mock.patch('sys.argv', arguments), self.assertRaisesRegex(RuntimeError, message):
                        BUILD.main()
                    tool.assert_not_called()
                self.assertFalse(output.exists())

    def test_wrong_reviewed_sha_blocks_before_output(self):
        with tempfile.TemporaryDirectory(prefix='caiwu-wrong-sha-') as temporary:
            root = Path(temporary)
            output = root / 'artifacts'
            arguments = ['build.py', '--version', '0.1.0.3', '--makensis', 'test-nsis',
                         '--out', str(output), '--managed-data-contract', '--expected-commit', 'a' * 40]
            with mock.patch.object(BUILD, 'ROOT', root):
                with mock.patch.object(BUILD, 'run', side_effect=[BUILD.SDK, BUILD.NSIS, 'b' * 40, '']):
                    with mock.patch('sys.argv', arguments), self.assertRaisesRegex(RuntimeError, 'does not match'):
                        BUILD.main()
            self.assertFalse(output.exists())

    def test_dangling_pause_link_is_not_treated_as_absent(self):
        with tempfile.TemporaryDirectory(prefix='caiwu-pause-test-') as temporary:
            root = Path(temporary)
            pause = root / 'docs/acceptance/DELIVERY_PAUSED.md'
            pause.parent.mkdir(parents=True)
            try:
                pause.symlink_to(root / 'unavailable-review-marker')
            except (OSError, NotImplementedError):
                self.skipTest('Symlinks unavailable; security settings are not changed.')
            with self.assertRaisesRegex(RuntimeError, 'paused distribution'):
                BUILD.ensure_delivery_allowed(root)


if __name__ == '__main__':
    unittest.main()
