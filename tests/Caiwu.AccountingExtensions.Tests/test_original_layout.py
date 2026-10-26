"""Static geometry comparison with the existing original-analysis JSON, never Windows acceptance."""
from pathlib import Path
import json
import unittest
import xml.etree.ElementTree as ET

REPO = Path(__file__).resolve().parents[2]
WINDOWS = json.loads((REPO / "docs/original-analysis/json/windows.json").read_text())
WPF = REPO / "src/Caiwu.AccountingExtensions/Wpf"
NS = "{http://schemas.microsoft.com/winfx/2006/xaml/presentation}"


class OriginalReversalLayoutTests(unittest.TestCase):
    def compare(self, original_name, xaml_name):
        root = ET.parse(WPF / xaml_name).getroot()
        canvas = root.find(f"{NS}Viewbox/{NS}Canvas")
        observed = {
            el.attrib["AutomationProperties.AutomationId"]: el
            for el in canvas if "AutomationProperties.AutomationId" in el.attrib
        }
        for product in ("qingsong/main", "minfeiqi/main", "chengben/main"):
            with self.subTest(product=product, window=original_name):
                original = WINDOWS[product][original_name]
                self.assertEqual(float(canvas.attrib["Width"]), float(original["props"]["width"]))
                self.assertEqual(float(canvas.attrib["Height"]), float(original["props"]["height"]))
                self.assertEqual(root.attrib["Title"], original["props"]["title"])
                self.assertEqual(set(observed), {c["name"] for c in original["controls"]})
                for control in original["controls"]:
                    with self.subTest(control=control["name"]):
                        actual = observed[control["name"]]
                        props = control["props"]
                        for old_key, new_key in (("x", "Canvas.Left"), ("y", "Canvas.Top"),
                                                 ("width", "Width"), ("height", "Height")):
                            self.assertIn(old_key, props, "Unknown source coordinates must not be guessed")
                            self.assertEqual(float(actual.attrib[new_key]), float(props[old_key]))
                        if control["name"] not in ("st_4", "st_jzyf") and "text" in props and not actual.tag.endswith("TextBox"):
                            self.assertEqual(actual.attrib.get("Content", actual.attrib.get("Text")), props["text"])

    def test_reverse_posting_three_products(self):
        self.compare("w_zw_fgz", "ReversePostingWindow.xaml")

    def test_reopen_three_products(self):
        self.compare("w_zw_qxfz", "ReopenPeriodWindow.xaml")

    def test_buttons_use_real_handlers(self):
        for name in ("ReversePostingWindow.xaml", "ReopenPeriodWindow.xaml"):
            root = ET.parse(WPF / name).getroot()
            buttons = root.findall(f".//{NS}Button")
            self.assertEqual([b.attrib["Click"] for b in buttons], ["Confirm_Click", "Cancel_Click"])
            code = (WPF / (name + ".cs")).read_text()
            self.assertIn("shownContext", code)
            self.assertIn("DialogResult = false", code)
            self.assertNotIn("shownContext = new", code.split("private void Confirm_Click", 1)[1])


if __name__ == "__main__":
    unittest.main()
