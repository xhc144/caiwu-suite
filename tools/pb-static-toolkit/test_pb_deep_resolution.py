import unittest
from pb_deep_window import build_type_resolver


class TypeResolutionTests(unittest.TestCase):
    def test_only_observed_c000_is_treated_as_absent_candidate(self):
        resolve=build_type_resolver({'types':{'items':[]},'symbols':[]})
        self.assertEqual(resolve(0xc000)['resolution'],'none_sentinel')
        self.assertEqual(resolve(0xc001)['resolution'],'unresolved_type_family_C')
        self.assertIsNone(resolve(0xc001)['name'])


if __name__=='__main__':unittest.main()
