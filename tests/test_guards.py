"""Guard tests: no network, no secrets, no live sends. stdlib only."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from smooth_ai_bdr import guards


class DomainMatchTests(unittest.TestCase):
    def test_exact_and_subdomain_skip(self):
        from smooth_ai_bdr.discover import host_matches
        self.assertTrue(host_matches("x.com", "x.com"))
        self.assertTrue(host_matches("sub.x.com", "x.com"))
        self.assertTrue(host_matches("m.facebook.com", "facebook."))

    def test_no_false_positives(self):
        from smooth_ai_bdr.discover import host_matches
        self.assertFalse(host_matches("x.company.com", "x.com"))
        self.assertFalse(host_matches("notx.com", "x.com"))
        self.assertFalse(host_matches("hvacontario.ca", "x.com"))
        self.assertFalse(host_matches("", "x.com"))
        self.assertFalse(host_matches("x.com", ""))


class GuardTests(unittest.TestCase):
    def test_brand_domain_send_blocked(self):
        self.assertTrue(guards.is_brand_domain_send("hello@smoothaiconsultancy.com"))
        self.assertTrue(guards.is_brand_domain_send("Hi@SmoothAIConsultancy.com "))
        self.assertTrue(guards.is_brand_domain_send("nick@mail.smoothaiconsultancy.com"))

    def test_secondary_domain_allowed(self):
        self.assertFalse(guards.is_brand_domain_send("hi@smoothaigrowth.com"))
        self.assertFalse(guards.is_brand_domain_send(""))
        self.assertFalse(guards.is_brand_domain_send("nick@gmail.com"))

    def test_placeholder_emails_rejected(self):
        for bad in ["", "not-an-email", "[email protected]",
                    "someone@example.com", "info@sentry.io",
                    "pic@site.png", "me@domain"]:
            self.assertFalse(guards.email_looks_real(bad), bad)

    def test_real_emails_accepted(self):
        self.assertTrue(guards.email_looks_real("sales@hvacontario.ca"))
        self.assertTrue(guards.email_looks_real("reception@atlasdental.ca"))
        self.assertTrue(guards.email_looks_real("smile@maison-dental.ca"))

    def test_weak_role_prefixes_held(self):
        # 2026-09-04: sales@ and reception@ bounced 5.1.1. Shaped fine,
        # but never ingestible without verification.
        for weak in ["sales@hvacontario.ca", "reception@atlasdental.ca",
                     "support@shop.ca", "service@shop.ca", "admin@shop.ca"]:
            self.assertTrue(guards.email_looks_real(weak), weak)
            self.assertTrue(guards.email_is_weak_role(weak), weak)
            self.assertTrue(guards.email_needs_verification(weak), weak)

    def test_role_addresses_need_verification(self):
        for role in ["info@airpoint.ca", "contact@shop.ca", "hello@shop.ca"]:
            self.assertTrue(guards.email_needs_verification(role), role)

    def test_named_contacts_skip_verification(self):
        for named in ["sarah@maison-dental.ca", "dave.smith@shop.ca",
                      "drdentalclinics@gmail.com"]:
            self.assertFalse(guards.email_needs_verification(named), named)
            self.assertFalse(guards.email_is_weak_role(named), named)

    def test_font_credit_emails_rejected(self):
        # thedentalclinic.ca footer embeds font-foundry credits
        # (Aldusleaf, Sudtipos): designer addresses, not the business.
        for bad in ["sebastian@aldusleaf.org", "sudtipos@sudtipos.com",
                    "hello@rfuenzalida.com", "impallari@gmail.com"]:
            self.assertFalse(guards.email_looks_real(bad), bad)
        from smooth_ai_bdr import scrape
        for hint in ("aldusleaf", "sudtipos", "rfuenzalida", "impallari"):
            self.assertIn(hint, scrape.BAD_EMAIL_HINTS)

    def test_cloudflare_obfuscation_rejected(self):
        # maison-dental.ca renders "[email protected]" (Cloudflare email
        # protection). The visible text is junk, but the data-cfemail
        # payload decodes to the real address, so both layers reject the
        # junk while the scraper recovers the contact.
        for bad in ["a@cloudflare.com", "x@data-cfemail.com",
                    "u@site__cf_email__.com"]:
            self.assertFalse(guards.email_looks_real(bad), bad)
        from smooth_ai_bdr import scrape
        for hint in ("cloudflare", "data-cfemail", "cfemail", "__cf_email__"):
            self.assertIn(hint, scrape.BAD_EMAIL_HINTS)

    def test_cfemail_decode(self):
        from smooth_ai_bdr import scrape
        self.assertEqual(
            scrape.decode_cfemail("e7b48a8e8b82a7aa868e948889caa3828993868bc98486"),
            "Smile@Maison-Dental.ca")
        self.assertEqual(scrape.decode_cfemail("zz"), "")
        self.assertEqual(scrape.decode_cfemail("00"), "")

    def test_plan_evidence_gate(self):
        good = ("Audit of Acme (shop):\n- ISSUE: no booking — homepage shows "
                "phone-only contact → lost after-hours jobs\n- PLAN: online "
                "booking: add Calendly ($0, week 1)\n- EXPECTED: 5 hrs/week; $2k")
        self.assertTrue(guards.plan_cites_evidence(good))
        self.assertFalse(guards.plan_cites_evidence("Great business, big opportunity!"))
        self.assertFalse(guards.plan_cites_evidence(""))


class DiscoverRobustnessTests(unittest.TestCase):
    def test_search_failure_skips_query(self):
        from smooth_ai_bdr import discover, db
        import sqlite3
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        conn.execute("CREATE TABLE leads (website TEXT PRIMARY KEY, name TEXT, description TEXT)")
        calls = {"n": 0}
        def flaky(query, n):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("search down")
            return [{"url": "https://example-shop.ca/", "title": "Shop", "content": "x"}]
        orig = discover.search
        discover.search = flaky
        try:
            added = discover.discover(["q1", "q2"], 3, conn)
        finally:
            discover.search = orig
        self.assertEqual(added, 1)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM leads").fetchone()[0], 1)

    def test_host_match_edge_cases(self):
        from smooth_ai_bdr.discover import host_matches
        self.assertFalse(host_matches("", "x.com"))
        self.assertFalse(host_matches("x.com", ""))
        self.assertTrue(host_matches("WWW.X.COM", "x.com"))
        self.assertFalse(host_matches("x.company.com", "x.com"))
        self.assertTrue(host_matches("x.com", "x.com."))


if __name__ == "__main__":
    unittest.main()
