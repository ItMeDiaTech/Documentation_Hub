#!/usr/bin/env python3
"""
Power Automate API Test Script

Tests HTTP POST to Power Automate webhook endpoint.
Mimics the exact behavior of the Electron app's net.request implementation.

Usage:
    python test-powerautomate-api.py <POWER_AUTOMATE_URL>

    Or set environment variable:
    set POWERAUTOMATE_URL=...
    python test-powerautomate-api.py

The script will:
1. Send a POST request with the exact same headers and payload structure
2. Log every detail of the request and response
3. Help diagnose connection issues before building the exe
"""

import json
import sys
import os
import ssl
import urllib.request
import urllib.error
import time
from datetime import datetime


def print_separator(char="=", length=70):
    """Print a separator line."""
    print(char * length)


def print_header(title):
    """Print a section header."""
    print_separator()
    print(f"  {title}")
    print_separator()


def log(level, message):
    """Log a message with timestamp and level."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    print(f"[{timestamp}] [{level}] {message}")


def main():
    # Get API URL from command line or environment
    api_url = None

    if len(sys.argv) > 1:
        api_url = sys.argv[1]
    else:
        api_url = os.environ.get("POWERAUTOMATE_URL")

    if not api_url:
        print_header("ERROR: No Power Automate URL provided")
        print(
            """
Usage:
    python test-powerautomate-api.py <POWER_AUTOMATE_URL>

    Or set environment variable:
    set POWERAUTOMATE_URL=...
    python test-powerautomate-api.py
        """
        )
        sys.exit(1)

    # Test payload matching the exact schema expected by Power Automate
    test_payload = {
        "Lookup_ID": ["TEST-ID-001", "TSRC-ABC-123456"],
        "Hyperlinks_Checked": 2,
        "Total_Hyperlinks": 5,
        "First_Name": "Test",
        "Last_Name": "User",
        "Email": "test.user@example.com",
    }

    # Headers matching exactly what Electron app sends
    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "User-Agent": "DocHub/1.0",
        "Accept": "application/json",
    }

    print_header("Power Automate API Test")
    print(f"Timestamp: {datetime.now().isoformat()}")
    print(f"Python Version: {sys.version}")
    print()

    print_header("REQUEST DETAILS")
    log("INFO", f"URL: {api_url}")
    log("INFO", "Method: POST")
    log("INFO", "Headers:")
    for key, value in headers.items():
        log("INFO", f"  - {key}: {value}")

    log("INFO", "Payload:")
    payload_json = json.dumps(test_payload, indent=2)
    for line in payload_json.split("\n"):
        log("INFO", f"  {line}")

    print()
    print_header("SENDING REQUEST")

    # Create SSL context that bypasses certificate verification
    # This is necessary for corporate proxies like Zscaler
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE

    log(
        "INFO",
        "SSL certificate verification: DISABLED (for corporate proxy compatibility)",
    )

    # Encode payload
    payload_bytes = json.dumps(test_payload).encode("utf-8")

    # Create request
    request = urllib.request.Request(
        api_url, data=payload_bytes, headers=headers, method="POST"
    )

    start_time = time.time()
    log("INFO", "Request sent, waiting for response...")

    try:
        # Send request
        with urllib.request.urlopen(
            request, context=ssl_context, timeout=30
        ) as response:
            end_time = time.time()
            duration_ms = int((end_time - start_time) * 1000)

            print()
            print_header("RESPONSE RECEIVED")
            log("INFO", f"Status Code: {response.status} {response.reason}")
            log("INFO", f"Duration: {duration_ms}ms")
            log("INFO", "Response Headers:")
            for key, value in response.headers.items():
                log("INFO", f"  - {key}: {value}")

            # Read response body
            response_body = response.read().decode("utf-8")

            log("INFO", "Response Body (raw):")
            log(
                "INFO",
                f"  {response_body[:500]}{'...' if len(response_body) > 500 else ''}",
            )

            # Try to parse as JSON
            try:
                response_json = json.loads(response_body)
                log("INFO", "Response Body (parsed JSON):")
                for line in json.dumps(response_json, indent=2).split("\n"):
                    log("INFO", f"  {line}")

                # Check for Results array
                if "Results" in response_json:
                    log("INFO", f"Results count: {len(response_json['Results'])}")
                    for i, result in enumerate(
                        response_json["Results"][:5]
                    ):  # Show first 5
                        log("INFO", f"  Result {i+1}: {result}")
                    if len(response_json["Results"]) > 5:
                        log(
                            "INFO",
                            f"  ... and {len(response_json['Results']) - 5} more",
                        )

            except json.JSONDecodeError:
                log("WARN", "Response is not valid JSON")

            print()
            print_header("SUCCESS")
            log("INFO", "API call completed successfully!")
            log("INFO", f"Total duration: {duration_ms}ms")

    except urllib.error.HTTPError as e:
        end_time = time.time()
        duration_ms = int((end_time - start_time) * 1000)

        print()
        print_header("HTTP ERROR")
        log("ERROR", f"HTTP Error: {e.code} {e.reason}")
        log("ERROR", f"Duration: {duration_ms}ms")
        log("ERROR", "Response Headers:")
        for key, value in e.headers.items():
            log("ERROR", f"  - {key}: {value}")

        try:
            error_body = e.read().decode("utf-8")
            log("ERROR", f"Error Body: {error_body[:500]}")
        except:
            log("ERROR", "Could not read error body")

        sys.exit(1)

    except urllib.error.URLError as e:
        end_time = time.time()
        duration_ms = int((end_time - start_time) * 1000)

        print()
        print_header("CONNECTION ERROR")
        log("ERROR", f"URL Error: {e.reason}")
        log("ERROR", f"Duration: {duration_ms}ms")
        log("ERROR", "This could be due to:")
        log("ERROR", "  - Network connectivity issues")
        log("ERROR", "  - Corporate proxy blocking the request")
        log("ERROR", "  - Invalid URL")
        log("ERROR", "  - SSL/TLS certificate issues")

        sys.exit(1)

    except TimeoutError:
        print()
        print_header("TIMEOUT ERROR")
        log("ERROR", "Request timed out after 30 seconds")
        log("ERROR", "This could be due to:")
        log("ERROR", "  - Network connectivity issues")
        log("ERROR", "  - Corporate proxy blocking the request")
        log("ERROR", "  - Power Automate flow taking too long")

        sys.exit(1)

    except Exception as e:
        end_time = time.time()
        duration_ms = int((end_time - start_time) * 1000)

        print()
        print_header("UNEXPECTED ERROR")
        log("ERROR", f"Error Type: {type(e).__name__}")
        log("ERROR", f"Error Message: {str(e)}")
        log("ERROR", f"Duration: {duration_ms}ms")

        import traceback

        log("ERROR", "Stack Trace:")
        for line in traceback.format_exc().split("\n"):
            if line.strip():
                log("ERROR", f"  {line}")

        sys.exit(1)


if __name__ == "__main__":
    main()
