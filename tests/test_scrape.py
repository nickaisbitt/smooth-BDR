"""Tests for smooth_ai_bdr.scrape — marker detection, email extraction, CF decode."""
import pytest
from smooth_ai_bdr.scrape import (
    CHAT_MARKERS,
    BOOKING_MARKERS,
    CMS_MARKERS,
    BAD_EMAIL_HINTS,
    decode_cfemail,
    EMAIL_RE,
    CFEMAIL_RE,
)


class TestMarkerLists:
    """Verify marker lists contain expected entries and no duplicates."""

    def test_chat_markers_include_major_providers(self):
        for provider in ["crisp", "tawk.to", "intercom", "drift", "tidio"]:
            assert provider in CHAT_MARKERS, f"{provider} missing from CHAT_MARKERS"

    def test_booking_markers_include_cal_com(self):
        assert "cal.com" in BOOKING_MARKERS, "cal.com missing from BOOKING_MARKERS"

    def test_booking_markers_include_calendly(self):
        assert "calendly" in BOOKING_MARKERS, "calendly missing from BOOKING_MARKERS"

    def test_cms_markers_map_known_platforms(self):
        assert CMS_MARKERS["wp-content"] == "WordPress"
        assert CMS_MARKERS["squarespace"] == "Squarespace"
        assert CMS_MARKERS["wix.com"] == "Wix"

    def test_no_duplicate_chat_markers(self):
        assert len(CHAT_MARKERS) == len(set(CHAT_MARKERS))

    def test_no_duplicate_booking_markers(self):
        assert len(BOOKING_MARKERS) == len(set(BOOKING_MARKERS))


class TestBadEmailHints:
    """Verify BAD_EMAIL_HINTS blocks scraper junk and font credits."""

    def test_blocks_cloudflare_protection(self):
        for hint in ["cloudflare", "data-cfemail", "cfemail", "__cf_email__"]:
            assert hint in BAD_EMAIL_HINTS, f"{hint} missing from BAD_EMAIL_HINTS"

    def test_blocks_font_credits(self):
        for hint in ["aldusleaf", "sudtipos", "rfuenzalida", "impallari"]:
            assert hint in BAD_EMAIL_HINTS, f"{hint} missing from BAD_EMAIL_HINTS"

    def test_blocks_image_extensions(self):
        for ext in [".png", ".jpg", ".webp", ".gif"]:
            assert ext in BAD_EMAIL_HINTS, f"{ext} missing from BAD_EMAIL_HINTS"

    def test_blocks_placeholder_emails(self):
        for hint in ["example.", "yourname", "your-email", "name@company", "@domain"]:
            assert hint in BAD_EMAIL_HINTS, f"{hint} missing from BAD_EMAIL_HINTS"


class TestDecodeCfemail:
    """Verify Cloudflare email decoding."""

    def test_decodes_valid_payload(self):
        # Known test vector: key=0x65, encoded "hello" = [0x65^h, 0x65^e, ...]
        # h=0x68 -> 0x0d, e=0x65 -> 0x00, l=0x6c -> 0x09, l=0x6c -> 0x09, o=0x6f -> 0x0a
        payload = "650d0009090a"
        assert decode_cfemail(payload) == "hello"

    def test_returns_empty_on_short_input(self):
        assert decode_cfemail("65") == ""
        assert decode_cfemail("") == ""

    def test_returns_empty_on_invalid_hex(self):
        assert decode_cfemail("zzzz") == ""
        assert decode_cfemail("not-hex-at-all") == ""

    def test_returns_empty_on_none_like(self):
        # Should not raise on unexpected input types that reach here
        assert decode_cfemail("  ") == ""


class TestEmailRegex:
    """Verify EMAIL_RE matches valid addresses and rejects junk."""

    def test_matches_standard_email(self):
        assert EMAIL_RE.search("contact@example.com")

    def test_matches_subdomain_email(self):
        assert EMAIL_RE.search("info@mail.example.co.uk")

    def test_rejects_plain_text(self):
        assert not EMAIL_RE.search("no email here")

    def test_finds_email_in_html_context(self):
        html = '<a href="mailto:sales@heatingfirm.ca">Email us</a>'
        match = EMAIL_RE.search(html)
        assert match and match.group() == "sales@heatingfirm.ca"


class TestCfemailRegex:
    """Verify CFEMAIL_RE extracts data-cfemail payloads."""

    def test_extracts_payload_from_attribute(self):
        html = '<span data-cfemail="650d0009090a">[email protected]</span>'
        match = CFEMAIL_RE.search(html)
        assert match and match.group(1) == "650d0009090a"

    def test_no_match_without_attribute(self):
        assert not CFEMAIL_RE.search("<span>regular text</span>")