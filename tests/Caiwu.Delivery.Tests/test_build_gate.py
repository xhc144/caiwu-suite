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
