#!/usr/bin/env python3
"""
PowerAutomate API Diagnostic Tool

Tests the PowerAutomate API connection and response format independently
of the Documentation Hub application. Helps diagnose API-related issues.

Usage:
    python api_diagnostic.py --url "https://your-api-url" --ids "TSRC-ABC-123456,TSRC-DEF-789012"
    python api_diagnostic.py --url "https://your-api-url" --docx document.docx
    python api_diagnostic.py --config config.json

Author: Documentation Hub Team
"""

import argparse
import json
import re
import sys
import time
import zipfile
from typing import Any, Dict, List, Optional, Tuple
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
from xml.etree import ElementTree as ET

# ============================================================================
# URL PATTERN EXTRACTION (matches urlPatterns.ts)
# ============================================================================

# Content ID pattern: TSRC-ABC-123456 or CMS-XYZ-789012
CONTENT_ID_PATTERN = re.compile(r'(TSRC|CMS)-([a-zA-Z0-9]+)-(\d{6})', re.IGNORECASE)

# Document ID pattern: docid=abc-123-def or docid=abc123
DOCUMENT_ID_PATTERN = re.compile(r'docid=([a-zA-Z0-9-]+)(?:[^a-zA-Z0-9-]|$)', re.IGNORECASE)


def extract_content_id(url: str) -> Optional[str]:
    """Extract Content ID from URL (e.g., TSRC-ABC-123456)."""
    if not url:
        return None
    match = CONTENT_ID_PATTERN.search(url)
    return match.group(0) if match else None


def extract_document_id(url: str) -> Optional[str]:
    """Extract Document ID from URL (value after docid=)."""
    if not url:
        return None
    match = DOCUMENT_ID_PATTERN.search(url)
    return match.group(1) if match else None


def extract_lookup_ids(url: str) -> Dict[str, str]:
    """Extract both Content ID and Document ID from URL."""
    result = {}
    content_id = extract_content_id(url)
    if content_id:
        result['contentId'] = content_id
    document_id = extract_document_id(url)
    if document_id:
        result['documentId'] = document_id
    return result


# ============================================================================
# DOCX HYPERLINK EXTRACTION
# ============================================================================

NAMESPACES = {
    'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'rel': 'http://schemas.openxmlformats.org/package/2006/relationships',
}


def extract_hyperlinks_from_docx(filepath: str) -> List[Dict[str, Any]]:
    """Extract all hyperlinks from a DOCX file."""
    hyperlinks = []

    try:
        with zipfile.ZipFile(filepath, 'r') as zf:
            # First, get the relationships to map rId to URLs
            rels_map = {}
            rels_path = 'word/_rels/document.xml.rels'

            if rels_path in zf.namelist():
                with zf.open(rels_path) as f:
                    rels_content = f.read()
                    rels_root = ET.fromstring(rels_content)

                    rel_ns = 'http://schemas.openxmlformats.org/package/2006/relationships'
                    for rel in rels_root.findall(f'.//{{{rel_ns}}}Relationship'):
                        rel_id = rel.get('Id', '')
                        target = rel.get('Target', '')
                        rel_type = rel.get('Type', '')

                        if 'hyperlink' in rel_type.lower():
                            rels_map[rel_id] = target

            # Now parse document.xml for hyperlinks
            with zf.open('word/document.xml') as f:
                doc_content = f.read()
                root = ET.fromstring(doc_content)

                w_ns = NAMESPACES['w']
                r_ns = NAMESPACES['r']

                for hl in root.findall(f'.//{{{w_ns}}}hyperlink'):
                    r_id = hl.get(f'{{{r_ns}}}id', '')
                    anchor = hl.get(f'{{{w_ns}}}anchor', '')

                    # Get display text
                    text_parts = []
                    for t in hl.findall(f'.//{{{w_ns}}}t'):
                        if t.text:
                            text_parts.append(t.text)
                    display_text = ''.join(text_parts)

                    # Get URL from relationships
                    url = rels_map.get(r_id, '')

                    if url or anchor:
                        hyperlink_info = {
                            'url': url,
                            'displayText': display_text,
                            'relationshipId': r_id,
                            'anchor': anchor,
                            'isInternal': bool(anchor and not url),
                        }

                        # Extract lookup IDs
                        lookup_ids = extract_lookup_ids(url)
                        if lookup_ids:
                            hyperlink_info['lookupIds'] = lookup_ids

                        hyperlinks.append(hyperlink_info)

    except Exception as e:
        print(f"Error extracting hyperlinks: {e}", file=sys.stderr)

    return hyperlinks


# ============================================================================
# API TESTING
# ============================================================================

class Colors:
    """ANSI color codes."""
    RED = '\033[91m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    BOLD = '\033[1m'
    RESET = '\033[0m'

    @classmethod
    def disable(cls):
        cls.RED = cls.GREEN = cls.YELLOW = cls.BLUE = cls.CYAN = cls.BOLD = cls.RESET = ''


def test_api_connection(
    api_url: str,
    lookup_ids: List[str],
    user_profile: Optional[Dict[str, str]] = None,
    timeout: int = 30,
    verbose: bool = False
) -> Dict[str, Any]:
    """
    Test the PowerAutomate API with given lookup IDs.

    Returns diagnostic information about the request and response.
    """
    result = {
        'success': False,
        'request': {},
        'response': {},
        'timing': {},
        'errors': [],
        'warnings': [],
    }

    # Build request payload (matches DocHub format)
    payload = {
        'Lookup_ID': lookup_ids,
        'Hyperlinks_Checked': len(lookup_ids),
        'Total_Hyperlinks': len(lookup_ids),
        'First_Name': user_profile.get('firstName', 'Test') if user_profile else 'Test',
        'Last_Name': user_profile.get('lastName', 'User') if user_profile else 'User',
        'Email': user_profile.get('email', 'test@example.com') if user_profile else 'test@example.com',
    }

    result['request'] = {
        'url': api_url,
        'method': 'POST',
        'payload': payload,
        'timeout': timeout,
    }

    # Prepare request
    headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'User-Agent': 'DocHub-Diagnostic/1.0',
    }

    json_payload = json.dumps(payload).encode('utf-8')

    if verbose:
        print(f"\n{Colors.CYAN}Request Payload:{Colors.RESET}")
        print(json.dumps(payload, indent=2))

    # Make request
    start_time = time.time()

    try:
        req = Request(api_url, data=json_payload, headers=headers, method='POST')

        with urlopen(req, timeout=timeout) as response:
            elapsed = time.time() - start_time
            result['timing']['elapsed_ms'] = round(elapsed * 1000, 2)

            status_code = response.getcode()
            response_headers = dict(response.headers)
            response_body = response.read().decode('utf-8')

            result['response'] = {
                'status_code': status_code,
                'headers': response_headers,
                'body_length': len(response_body),
            }

            # Try to parse JSON
            try:
                response_data = json.loads(response_body)
                result['response']['parsed'] = True
                result['response']['data'] = response_data

                # Check for expected structure
                if 'Results' in response_data:
                    results_array = response_data['Results']
                    if isinstance(results_array, list):
                        result['response']['results_count'] = len(results_array)
                        result['success'] = True

                        # Analyze results structure
                        if results_array:
                            sample = results_array[0]
                            result['response']['result_fields'] = list(sample.keys())
                    else:
                        result['warnings'].append(f"'Results' is not an array: {type(results_array).__name__}")
                elif 'results' in response_data:
                    result['warnings'].append("API returned 'results' (lowercase) - DocHub expects 'Results' (uppercase)")
                    results_array = response_data['results']
                    if isinstance(results_array, list):
                        result['response']['results_count'] = len(results_array)
                else:
                    result['warnings'].append(f"No 'Results' key in response. Keys found: {list(response_data.keys())}")

            except json.JSONDecodeError as e:
                result['response']['parsed'] = False
                result['response']['raw_body'] = response_body[:1000]
                result['errors'].append(f"Failed to parse JSON: {e}")

    except HTTPError as e:
        elapsed = time.time() - start_time
        result['timing']['elapsed_ms'] = round(elapsed * 1000, 2)

        result['response'] = {
            'status_code': e.code,
            'reason': e.reason,
        }

        # Try to read error body
        try:
            error_body = e.read().decode('utf-8')
            result['response']['error_body'] = error_body[:1000]
        except:
            pass

        result['errors'].append(f"HTTP {e.code}: {e.reason}")

    except URLError as e:
        elapsed = time.time() - start_time
        result['timing']['elapsed_ms'] = round(elapsed * 1000, 2)
        result['errors'].append(f"Connection error: {e.reason}")

    except TimeoutError:
        result['errors'].append(f"Request timed out after {timeout} seconds")

    except Exception as e:
        elapsed = time.time() - start_time
        result['timing']['elapsed_ms'] = round(elapsed * 1000, 2)
        result['errors'].append(f"Unexpected error: {str(e)}")

    return result


def print_diagnostic_report(result: Dict[str, Any], verbose: bool = False):
    """Print formatted diagnostic report."""
    print(f"\n{Colors.BOLD}{'=' * 70}{Colors.RESET}")
    print(f"{Colors.BOLD}PowerAutomate API Diagnostic Report{Colors.RESET}")
    print(f"{Colors.BOLD}{'=' * 70}{Colors.RESET}")

    # Request info
    print(f"\n{Colors.BOLD}[Request]{Colors.RESET}")
    print(f"  URL: {result['request'].get('url', 'N/A')}")
    print(f"  Method: {result['request'].get('method', 'N/A')}")
    print(f"  Timeout: {result['request'].get('timeout', 'N/A')}s")

    payload = result['request'].get('payload', {})
    lookup_ids = payload.get('Lookup_ID', [])
    print(f"  Lookup_ID count: {len(lookup_ids)}")
    if lookup_ids:
        print(f"  Lookup_IDs: {', '.join(lookup_ids[:5])}" + ('...' if len(lookup_ids) > 5 else ''))

    # Timing
    if result['timing']:
        print(f"\n{Colors.BOLD}[Timing]{Colors.RESET}")
        print(f"  Elapsed: {result['timing'].get('elapsed_ms', 'N/A')} ms")

    # Response info
    print(f"\n{Colors.BOLD}[Response]{Colors.RESET}")
    response = result.get('response', {})

    status_code = response.get('status_code')
    if status_code:
        color = Colors.GREEN if 200 <= status_code < 300 else Colors.RED
        print(f"  Status: {color}{status_code}{Colors.RESET}")

    if response.get('reason'):
        print(f"  Reason: {response['reason']}")

    if response.get('parsed'):
        print(f"  JSON Parsed: {Colors.GREEN}Yes{Colors.RESET}")
        print(f"  Body Length: {response.get('body_length', 'N/A')} bytes")

        if 'results_count' in response:
            print(f"  Results Count: {Colors.GREEN}{response['results_count']}{Colors.RESET}")

        if 'result_fields' in response:
            print(f"  Result Fields: {', '.join(response['result_fields'])}")

        if verbose and 'data' in response:
            print(f"\n{Colors.CYAN}Response Data:{Colors.RESET}")
            print(json.dumps(response['data'], indent=2)[:2000])
    else:
        print(f"  JSON Parsed: {Colors.RED}No{Colors.RESET}")
        if 'raw_body' in response:
            print(f"\n{Colors.CYAN}Raw Response (first 500 chars):{Colors.RESET}")
            print(response['raw_body'][:500])

    if response.get('error_body'):
        print(f"\n{Colors.CYAN}Error Body:{Colors.RESET}")
        print(response['error_body'][:500])

    # Warnings
    if result['warnings']:
        print(f"\n{Colors.BOLD}[Warnings]{Colors.RESET}")
        for warning in result['warnings']:
            print(f"  {Colors.YELLOW}! {warning}{Colors.RESET}")

    # Errors
    if result['errors']:
        print(f"\n{Colors.BOLD}[Errors]{Colors.RESET}")
        for error in result['errors']:
            print(f"  {Colors.RED}X {error}{Colors.RESET}")

    # Summary
    print(f"\n{Colors.BOLD}{'=' * 70}{Colors.RESET}")
    if result['success']:
        print(f"Status: {Colors.GREEN}{Colors.BOLD}SUCCESS{Colors.RESET}")
        print("The API returned a valid response with Results array.")
    else:
        print(f"Status: {Colors.RED}{Colors.BOLD}FAILED{Colors.RESET}")
        if result['errors']:
            print(f"Primary Error: {result['errors'][0]}")
    print(f"{Colors.BOLD}{'=' * 70}{Colors.RESET}\n")


def main():
    parser = argparse.ArgumentParser(
        description='Diagnose PowerAutomate API connection and response format',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Test with specific IDs
  python api_diagnostic.py --url "https://your-api.com" --ids "TSRC-ABC-123456,TSRC-DEF-789012"

  # Extract IDs from a DOCX file and test
  python api_diagnostic.py --url "https://your-api.com" --docx document.docx

  # Use a config file
  python api_diagnostic.py --config api_config.json

  # Verbose output with full response
  python api_diagnostic.py --url "https://your-api.com" --ids "TSRC-ABC-123456" --verbose

Config file format (JSON):
  {
    "apiUrl": "https://your-powerautomate-url",
    "lookupIds": ["TSRC-ABC-123456"],
    "userProfile": {
      "firstName": "John",
      "lastName": "Doe",
      "email": "john@example.com"
    },
    "timeout": 30
  }
        """
    )

    parser.add_argument('--url', help='PowerAutomate API URL')
    parser.add_argument('--ids', help='Comma-separated list of Lookup IDs (Content_ID or Document_ID)')
    parser.add_argument('--docx', help='Extract Lookup IDs from a DOCX file')
    parser.add_argument('--config', help='Path to JSON config file')
    parser.add_argument('--timeout', type=int, default=30, help='Request timeout in seconds (default: 30)')
    parser.add_argument('--verbose', '-v', action='store_true', help='Show full response data')
    parser.add_argument('--json', action='store_true', help='Output as JSON')
    parser.add_argument('--no-color', action='store_true', help='Disable colored output')
    parser.add_argument('--extract-only', action='store_true', help='Only extract and show IDs from DOCX, do not call API')

    args = parser.parse_args()

    if args.no_color or not sys.stdout.isatty():
        Colors.disable()

    # Load config if provided
    config = {}
    if args.config:
        try:
            with open(args.config, 'r') as f:
                config = json.load(f)
        except Exception as e:
            print(f"Error loading config: {e}", file=sys.stderr)
            sys.exit(2)

    # Get API URL
    api_url = args.url or config.get('apiUrl')

    # Get Lookup IDs
    lookup_ids = []

    if args.ids:
        lookup_ids = [id.strip() for id in args.ids.split(',') if id.strip()]
    elif config.get('lookupIds'):
        lookup_ids = config['lookupIds']

    # Extract from DOCX if provided
    if args.docx:
        print(f"\n{Colors.BOLD}Extracting hyperlinks from: {args.docx}{Colors.RESET}")
        hyperlinks = extract_hyperlinks_from_docx(args.docx)

        print(f"\nFound {len(hyperlinks)} hyperlinks:")

        docx_ids = set()
        internal_count = 0
        external_count = 0

        for hl in hyperlinks:
            if hl.get('isInternal'):
                internal_count += 1
                continue

            external_count += 1
            ids = hl.get('lookupIds', {})

            if ids.get('contentId'):
                docx_ids.add(ids['contentId'])
            if ids.get('documentId'):
                docx_ids.add(ids['documentId'])

            if args.verbose or args.extract_only:
                url = hl.get('url', '')[:80]
                text = hl.get('displayText', '')[:40]
                id_str = ', '.join(f"{k}={v}" for k, v in ids.items()) if ids else 'None'
                print(f"  - {url}...")
                print(f"    Text: {text}")
                print(f"    IDs: {id_str}")

        print(f"\n{Colors.BOLD}Summary:{Colors.RESET}")
        print(f"  Internal hyperlinks: {internal_count}")
        print(f"  External hyperlinks: {external_count}")
        print(f"  Unique Lookup IDs: {len(docx_ids)}")

        if docx_ids:
            print(f"\n{Colors.BOLD}Extracted Lookup_ID array:{Colors.RESET}")
            for id in sorted(docx_ids):
                print(f"  - {id}")

            # Add to lookup_ids if not already specified
            if not lookup_ids:
                lookup_ids = list(docx_ids)

        if args.extract_only:
            # Output as JSON if requested
            if args.json:
                output = {
                    'file': args.docx,
                    'hyperlinks': hyperlinks,
                    'lookupIds': list(docx_ids),
                    'summary': {
                        'totalHyperlinks': len(hyperlinks),
                        'internalHyperlinks': internal_count,
                        'externalHyperlinks': external_count,
                        'uniqueLookupIds': len(docx_ids),
                    }
                }
                print(json.dumps(output, indent=2))
            sys.exit(0)

    # Validate we have what we need
    if not api_url:
        print("Error: API URL required. Use --url or --config", file=sys.stderr)
        sys.exit(2)

    if not lookup_ids:
        print("Error: Lookup IDs required. Use --ids, --docx, or --config", file=sys.stderr)
        sys.exit(2)

    # Get user profile
    user_profile = config.get('userProfile')

    # Get timeout
    timeout = args.timeout or config.get('timeout', 30)

    # Run diagnostic
    print(f"\n{Colors.BOLD}Testing API connection...{Colors.RESET}")
    result = test_api_connection(
        api_url=api_url,
        lookup_ids=lookup_ids,
        user_profile=user_profile,
        timeout=timeout,
        verbose=args.verbose
    )

    # Output
    if args.json:
        print(json.dumps(result, indent=2, default=str))
    else:
        print_diagnostic_report(result, verbose=args.verbose)

    # Exit code
    sys.exit(0 if result['success'] else 1)


if __name__ == '__main__':
    main()
