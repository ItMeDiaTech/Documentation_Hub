#!/usr/bin/env python3
"""
DOCX Diagnostic Tool

Analyzes Word documents (.docx) for potential processing issues without
requiring the full application. Detects common problems that cause
document processing errors.

Usage:
    python docx_diagnostic.py document.docx
    python docx_diagnostic.py document.docx --json
    python docx_diagnostic.py document.docx --verbose
    python docx_diagnostic.py *.docx

Author: Documentation Hub Team
"""

import argparse
import json
import os
import re
import sys
import zipfile
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple
from xml.etree import ElementTree as ET

# OpenXML namespaces
NAMESPACES = {
    'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'o': 'urn:schemas-microsoft-com:office:office',
    'm': 'http://schemas.openxmlformats.org/officeDocument/2006/math',
    'wp': 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
    'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    'pic': 'http://schemas.openxmlformats.org/drawingml/2006/picture',
    'ct': 'http://schemas.openxmlformats.org/package/2006/content-types',
    'rel': 'http://schemas.openxmlformats.org/package/2006/relationships',
}

# Register namespaces for ElementTree
for prefix, uri in NAMESPACES.items():
    ET.register_namespace(prefix, uri)


class Severity:
    """Issue severity levels."""
    ERROR = 'ERROR'
    WARNING = 'WARNING'
    INFO = 'INFO'


class Colors:
    """ANSI color codes for terminal output."""
    RED = '\033[91m'
    YELLOW = '\033[93m'
    GREEN = '\033[92m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    BOLD = '\033[1m'
    RESET = '\033[0m'

    @classmethod
    def disable(cls):
        """Disable colors for non-terminal output."""
        cls.RED = ''
        cls.YELLOW = ''
        cls.GREEN = ''
        cls.BLUE = ''
        cls.CYAN = ''
        cls.BOLD = ''
        cls.RESET = ''


class Issue:
    """Represents a diagnostic issue found in the document."""

    def __init__(
        self,
        severity: str,
        category: str,
        message: str,
        location: Optional[str] = None,
        context: Optional[str] = None,
        suggestion: Optional[str] = None
    ):
        self.severity = severity
        self.category = category
        self.message = message
        self.location = location
        self.context = context
        self.suggestion = suggestion

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON output."""
        result = {
            'severity': self.severity,
            'category': self.category,
            'message': self.message,
        }
        if self.location:
            result['location'] = self.location
        if self.context:
            result['context'] = self.context
        if self.suggestion:
            result['suggestion'] = self.suggestion
        return result

    def format(self, verbose: bool = False) -> str:
        """Format issue for console output."""
        color = {
            Severity.ERROR: Colors.RED,
            Severity.WARNING: Colors.YELLOW,
            Severity.INFO: Colors.BLUE,
        }.get(self.severity, '')

        lines = [f"{color}[{self.severity}]{Colors.RESET} {Colors.BOLD}{self.category}{Colors.RESET}: {self.message}"]

        if self.location:
            lines.append(f"  Location: {self.location}")

        if verbose and self.context:
            # Truncate context if too long
            ctx = self.context if len(self.context) <= 200 else self.context[:200] + '...'
            lines.append(f"  Context: {ctx}")

        if self.suggestion:
            lines.append(f"  {Colors.CYAN}Suggestion: {self.suggestion}{Colors.RESET}")

        return '\n'.join(lines)


class DocxDiagnostic:
    """Main diagnostic class for analyzing DOCX files."""

    # Required files in a valid DOCX
    REQUIRED_FILES = [
        '[Content_Types].xml',
        '_rels/.rels',
        'word/document.xml',
    ]

    # Invalid XML character ranges
    INVALID_CHAR_RANGES = [
        (0x00, 0x08),  # Null and control chars
        (0x0B, 0x0C),  # Vertical tab, form feed
        (0x0E, 0x1F),  # More control chars
        (0x7F, 0x7F),  # DEL
        (0xFFFE, 0xFFFF),  # Non-characters
    ]

    def __init__(self, filepath: str, verbose: bool = False):
        self.filepath = filepath
        self.verbose = verbose
        self.issues: List[Issue] = []
        self.stats: Dict[str, Any] = {}
        self.zip_file: Optional[zipfile.ZipFile] = None

    def add_issue(
        self,
        severity: str,
        category: str,
        message: str,
        location: Optional[str] = None,
        context: Optional[str] = None,
        suggestion: Optional[str] = None
    ):
        """Add an issue to the list."""
        self.issues.append(Issue(severity, category, message, location, context, suggestion))

    def run_all_checks(self) -> bool:
        """Run all diagnostic checks. Returns True if document appears valid."""
        print(f"\n{Colors.BOLD}Analyzing: {self.filepath}{Colors.RESET}\n")

        # Check 1: File exists and is accessible
        if not self._check_file_exists():
            return False

        # Check 2: Valid ZIP structure
        if not self._check_zip_structure():
            return False

        # Check 3: Required files present
        self._check_required_files()

        # Check 4: Parse and analyze document.xml
        self._analyze_document_xml()

        # Check 5: Check relationships
        self._check_relationships()

        # Check 6: Check for embedded objects
        self._check_embedded_objects()

        # Close ZIP file
        if self.zip_file:
            self.zip_file.close()

        return len([i for i in self.issues if i.severity == Severity.ERROR]) == 0

    def _check_file_exists(self) -> bool:
        """Check if file exists and is readable."""
        if not os.path.exists(self.filepath):
            self.add_issue(
                Severity.ERROR,
                'File Access',
                f'File not found: {self.filepath}'
            )
            return False

        if not os.path.isfile(self.filepath):
            self.add_issue(
                Severity.ERROR,
                'File Access',
                f'Path is not a file: {self.filepath}'
            )
            return False

        # Check file size
        size = os.path.getsize(self.filepath)
        self.stats['file_size'] = size
        self.stats['file_size_mb'] = round(size / (1024 * 1024), 2)

        if size == 0:
            self.add_issue(
                Severity.ERROR,
                'File Access',
                'File is empty (0 bytes)'
            )
            return False

        if size > 100 * 1024 * 1024:  # 100MB
            self.add_issue(
                Severity.WARNING,
                'File Size',
                f'File is very large ({self.stats["file_size_mb"]}MB), may cause performance issues'
            )

        return True

    def _check_zip_structure(self) -> bool:
        """Check if file is a valid ZIP archive."""
        try:
            self.zip_file = zipfile.ZipFile(self.filepath, 'r')

            # Test ZIP integrity
            bad_file = self.zip_file.testzip()
            if bad_file:
                self.add_issue(
                    Severity.ERROR,
                    'ZIP Structure',
                    f'Corrupted file in archive: {bad_file}',
                    suggestion='The DOCX archive is corrupted. Try opening and re-saving in Word.'
                )
                return False

            self.stats['zip_files'] = len(self.zip_file.namelist())
            return True

        except zipfile.BadZipFile as e:
            self.add_issue(
                Severity.ERROR,
                'ZIP Structure',
                f'Invalid ZIP archive: {str(e)}',
                suggestion='File is not a valid DOCX. May be corrupted or not a Word document.'
            )
            return False
        except Exception as e:
            self.add_issue(
                Severity.ERROR,
                'ZIP Structure',
                f'Error reading file: {str(e)}'
            )
            return False

    def _check_required_files(self):
        """Check for required files in DOCX structure."""
        if not self.zip_file:
            return

        file_list = self.zip_file.namelist()

        for required in self.REQUIRED_FILES:
            if required not in file_list:
                self.add_issue(
                    Severity.ERROR,
                    'DOCX Structure',
                    f'Missing required file: {required}',
                    suggestion='Document structure is incomplete. May be corrupted.'
                )

        # Check for optional but important files
        optional_files = {
            'word/styles.xml': 'Style definitions missing - default styles will be used',
            'word/numbering.xml': 'Numbering definitions missing - lists may not render correctly',
            'word/settings.xml': 'Settings missing - document settings may be lost',
        }

        for filepath, message in optional_files.items():
            if filepath not in file_list:
                self.add_issue(Severity.INFO, 'DOCX Structure', message, location=filepath)

    def _analyze_document_xml(self):
        """Analyze the main document.xml file."""
        if not self.zip_file:
            return

        try:
            with self.zip_file.open('word/document.xml') as f:
                content = f.read()

            # Check for invalid characters in raw content
            self._check_invalid_characters(content, 'word/document.xml')

            # Parse XML
            try:
                root = ET.fromstring(content)
            except ET.ParseError as e:
                self.add_issue(
                    Severity.ERROR,
                    'XML Parsing',
                    f'Failed to parse document.xml: {str(e)}',
                    suggestion='Document XML is malformed. Check for invalid characters or corrupted content.'
                )
                return

            # Run element-specific checks
            self._check_tracked_changes(root)
            self._check_smart_tags(root)
            self._check_content_controls(root)
            self._check_field_codes(root)
            self._check_equations(root)
            self._check_hyperlinks(root)
            self._check_namespaces(root)

        except KeyError:
            self.add_issue(
                Severity.ERROR,
                'DOCX Structure',
                'document.xml not found in archive'
            )
        except Exception as e:
            self.add_issue(
                Severity.ERROR,
                'Analysis',
                f'Error analyzing document.xml: {str(e)}'
            )

    def _check_invalid_characters(self, content: bytes, filename: str):
        """Check for invalid XML characters in content."""
        try:
            text = content.decode('utf-8')
        except UnicodeDecodeError as e:
            self.add_issue(
                Severity.ERROR,
                'Encoding',
                f'Invalid UTF-8 encoding in {filename}',
                location=f'Byte position: {e.start}',
                suggestion='Document contains invalid byte sequences. May need manual repair.'
            )
            return

        invalid_found = []

        for i, char in enumerate(text):
            code = ord(char)
            for start, end in self.INVALID_CHAR_RANGES:
                if start <= code <= end:
                    # Get surrounding context
                    ctx_start = max(0, i - 20)
                    ctx_end = min(len(text), i + 20)
                    context = text[ctx_start:ctx_end].replace('\n', '\\n').replace('\r', '\\r')

                    # Find line number
                    line_num = text[:i].count('\n') + 1

                    invalid_found.append({
                        'char': hex(code),
                        'position': i,
                        'line': line_num,
                        'context': context
                    })
                    break

        if invalid_found:
            # Group by character type
            char_counts = defaultdict(int)
            for item in invalid_found:
                char_counts[item['char']] += 1

            summary = ', '.join([f"{char}: {count}x" for char, count in char_counts.items()])

            self.add_issue(
                Severity.ERROR,
                'Invalid Characters',
                f'Found {len(invalid_found)} invalid XML character(s) in {filename}',
                location=f'Characters found: {summary}',
                context=invalid_found[0]['context'] if invalid_found else None,
                suggestion='Remove control characters. These often come from copy/paste operations.'
            )

            # Add detailed info for first few occurrences in verbose mode
            if self.verbose:
                for item in invalid_found[:5]:
                    self.add_issue(
                        Severity.INFO,
                        'Invalid Character Detail',
                        f'Character {item["char"]} at line {item["line"]}, position {item["position"]}',
                        context=item['context']
                    )

    def _check_tracked_changes(self, root: ET.Element):
        """Check for tracked changes (revisions)."""
        w = NAMESPACES['w']

        # Count revision elements
        insertions = root.findall(f'.//{{{w}}}ins')
        deletions = root.findall(f'.//{{{w}}}del')
        para_changes = root.findall(f'.//{{{w}}}pPrChange')
        run_changes = root.findall(f'.//{{{w}}}rPrChange')

        total_revisions = len(insertions) + len(deletions) + len(para_changes) + len(run_changes)

        self.stats['tracked_changes'] = {
            'insertions': len(insertions),
            'deletions': len(deletions),
            'paragraph_changes': len(para_changes),
            'run_changes': len(run_changes),
            'total': total_revisions
        }

        if total_revisions > 0:
            severity = Severity.WARNING if total_revisions < 100 else Severity.ERROR

            self.add_issue(
                severity,
                'Tracked Changes',
                f'Document contains {total_revisions} tracked change(s)',
                location=f'Insertions: {len(insertions)}, Deletions: {len(deletions)}, '
                         f'Paragraph changes: {len(para_changes)}, Run changes: {len(run_changes)}',
                suggestion='Accept or reject all tracked changes before processing to avoid issues.'
            )

            # Check for nested revisions (complex case)
            for ins in insertions:
                nested_del = ins.findall(f'.//{{{w}}}del')
                if nested_del:
                    self.add_issue(
                        Severity.WARNING,
                        'Nested Revisions',
                        'Found deletions nested inside insertions (complex revision structure)',
                        suggestion='This can cause processing issues. Accept all changes in Word first.'
                    )
                    break

    def _check_smart_tags(self, root: ET.Element):
        """Check for deprecated smart tags."""
        w = NAMESPACES['w']

        smart_tags = root.findall(f'.//{{{w}}}smartTag')

        self.stats['smart_tags'] = len(smart_tags)

        if smart_tags:
            self.add_issue(
                Severity.WARNING,
                'Smart Tags',
                f'Document contains {len(smart_tags)} deprecated smart tag(s)',
                suggestion='Smart tags are deprecated and may cause processing issues. '
                           'Open in Word and save to remove them.'
            )

    def _check_content_controls(self, root: ET.Element):
        """Check for content controls (SDT elements)."""
        w = NAMESPACES['w']

        sdt_elements = root.findall(f'.//{{{w}}}sdt')

        self.stats['content_controls'] = len(sdt_elements)

        if sdt_elements:
            # Check for locked content controls
            locked_count = 0
            for sdt in sdt_elements:
                sdt_pr = sdt.find(f'{{{w}}}sdtPr')
                if sdt_pr is not None:
                    lock = sdt_pr.find(f'{{{w}}}lock')
                    if lock is not None:
                        lock_val = lock.get(f'{{{w}}}val', '')
                        if lock_val in ('sdtLocked', 'contentLocked', 'sdtContentLocked'):
                            locked_count += 1

            if locked_count > 0:
                self.add_issue(
                    Severity.WARNING,
                    'Content Controls',
                    f'Document contains {locked_count} locked content control(s)',
                    suggestion='Locked content controls may prevent editing. Unlock them in Word if needed.'
                )
            else:
                self.add_issue(
                    Severity.INFO,
                    'Content Controls',
                    f'Document contains {len(sdt_elements)} content control(s)'
                )

    def _check_field_codes(self, root: ET.Element):
        """Check for field codes."""
        w = NAMESPACES['w']

        field_chars = root.findall(f'.//{{{w}}}fldChar')
        instr_texts = root.findall(f'.//{{{w}}}instrText')

        self.stats['field_codes'] = len(field_chars)

        if field_chars or instr_texts:
            # Try to identify field types
            field_types = []
            for instr in instr_texts:
                text = instr.text or ''
                if 'TOC' in text.upper():
                    field_types.append('Table of Contents')
                elif 'REF' in text.upper():
                    field_types.append('Cross-reference')
                elif 'HYPERLINK' in text.upper():
                    field_types.append('Hyperlink')
                elif 'MERGEFIELD' in text.upper():
                    field_types.append('Mail Merge')
                elif 'PAGE' in text.upper():
                    field_types.append('Page Number')
                elif 'DATE' in text.upper() or 'TIME' in text.upper():
                    field_types.append('Date/Time')

            unique_types = list(set(field_types))

            self.add_issue(
                Severity.INFO,
                'Field Codes',
                f'Document contains {len(field_chars)} field code(s)',
                location=f'Types found: {", ".join(unique_types) if unique_types else "Unknown"}',
                suggestion='Field codes may need to be updated or unlinked before processing.'
            )

    def _check_equations(self, root: ET.Element):
        """Check for equations (OMML)."""
        m = NAMESPACES['m']

        equations = root.findall(f'.//{{{m}}}oMath')
        equation_paras = root.findall(f'.//{{{m}}}oMathPara')

        total_equations = len(equations) + len(equation_paras)
        self.stats['equations'] = total_equations

        if total_equations > 0:
            self.add_issue(
                Severity.INFO,
                'Equations',
                f'Document contains {total_equations} equation(s)',
                suggestion='Equations (OMML) may cause processing issues. '
                           'Consider converting to images if problems occur.'
            )

    def _check_hyperlinks(self, root: ET.Element):
        """Check hyperlinks in document."""
        w = NAMESPACES['w']

        hyperlinks = root.findall(f'.//{{{w}}}hyperlink')
        self.stats['hyperlinks'] = len(hyperlinks)

        if hyperlinks:
            # Check for hyperlinks without anchor or relationship ID
            broken_count = 0
            for hl in hyperlinks:
                r_id = hl.get(f'{{{NAMESPACES["r"]}}}id')
                anchor = hl.get(f'{{{w}}}anchor')

                if not r_id and not anchor:
                    broken_count += 1

            if broken_count > 0:
                self.add_issue(
                    Severity.WARNING,
                    'Hyperlinks',
                    f'Found {broken_count} hyperlink(s) without target reference',
                    suggestion='Some hyperlinks may be broken. Check document relationships.'
                )
            else:
                self.add_issue(
                    Severity.INFO,
                    'Hyperlinks',
                    f'Document contains {len(hyperlinks)} hyperlink(s)'
                )

    def _check_namespaces(self, root: ET.Element):
        """Check for custom or unusual namespaces."""
        # Get all namespaces from root element
        if hasattr(root, 'nsmap'):
            namespaces = root.nsmap
        else:
            # ElementTree doesn't expose nsmap directly, parse from tag
            namespaces = {}
            for elem in root.iter():
                if elem.tag.startswith('{'):
                    ns = elem.tag[1:elem.tag.index('}')]
                    if ns not in namespaces.values():
                        namespaces[f'ns{len(namespaces)}'] = ns

        known_ns = set(NAMESPACES.values())
        custom_ns = [ns for ns in namespaces.values() if ns and ns not in known_ns]

        if custom_ns:
            self.add_issue(
                Severity.INFO,
                'Custom Namespaces',
                f'Document contains {len(custom_ns)} custom namespace(s)',
                location=', '.join(custom_ns[:3]) + ('...' if len(custom_ns) > 3 else ''),
                suggestion='Custom namespaces may indicate third-party extensions that could cause issues.'
            )

    def _check_relationships(self):
        """Check document relationships for broken references."""
        if not self.zip_file:
            return

        try:
            # Check main document relationships
            rels_path = 'word/_rels/document.xml.rels'
            if rels_path not in self.zip_file.namelist():
                self.add_issue(
                    Severity.WARNING,
                    'Relationships',
                    'Document relationships file not found',
                    location=rels_path
                )
                return

            with self.zip_file.open(rels_path) as f:
                content = f.read()

            root = ET.fromstring(content)
            rel_ns = 'http://schemas.openxmlformats.org/package/2006/relationships'

            relationships = root.findall(f'.//{{{rel_ns}}}Relationship')
            self.stats['relationships'] = len(relationships)

            broken_refs = []
            external_refs = []

            for rel in relationships:
                target = rel.get('Target', '')
                target_mode = rel.get('TargetMode', '')
                rel_type = rel.get('Type', '')

                # External references (URLs)
                if target_mode == 'External' or target.startswith('http'):
                    external_refs.append(target)
                    continue

                # Internal references - check if file exists
                if target.startswith('/'):
                    target_path = target[1:]  # Remove leading slash
                else:
                    target_path = f'word/{target}'

                # Normalize path
                target_path = os.path.normpath(target_path).replace('\\', '/')

                if target_path not in self.zip_file.namelist():
                    # Some references may use different paths
                    alt_path = target.lstrip('./')
                    if alt_path not in self.zip_file.namelist():
                        broken_refs.append({
                            'target': target,
                            'type': rel_type.split('/')[-1] if rel_type else 'unknown'
                        })

            if broken_refs:
                types = list(set([r['type'] for r in broken_refs]))
                self.add_issue(
                    Severity.WARNING,
                    'Broken References',
                    f'Found {len(broken_refs)} broken internal reference(s)',
                    location=f'Types: {", ".join(types)}',
                    suggestion='Some referenced files are missing. Document may have been edited externally.'
                )

            if external_refs:
                self.stats['external_refs'] = len(external_refs)
                self.add_issue(
                    Severity.INFO,
                    'External References',
                    f'Document contains {len(external_refs)} external reference(s) (URLs)'
                )

        except ET.ParseError as e:
            self.add_issue(
                Severity.ERROR,
                'Relationships',
                f'Failed to parse relationships: {str(e)}'
            )
        except Exception as e:
            self.add_issue(
                Severity.WARNING,
                'Relationships',
                f'Error checking relationships: {str(e)}'
            )

    def _check_embedded_objects(self):
        """Check for embedded OLE objects."""
        if not self.zip_file:
            return

        file_list = self.zip_file.namelist()

        # Check for embeddings folder
        embeddings = [f for f in file_list if f.startswith('word/embeddings/')]
        self.stats['embedded_objects'] = len(embeddings)

        if embeddings:
            # Categorize by type
            ole_objects = [f for f in embeddings if f.endswith('.bin')]
            other_objects = [f for f in embeddings if not f.endswith('.bin')]

            self.add_issue(
                Severity.WARNING,
                'Embedded Objects',
                f'Document contains {len(embeddings)} embedded object(s)',
                location=f'OLE objects: {len(ole_objects)}, Other: {len(other_objects)}',
                suggestion='Embedded OLE objects (Excel, PDF, etc.) may cause processing issues. '
                           'Consider removing or converting them.'
            )

        # Check for media folder
        media = [f for f in file_list if f.startswith('word/media/')]
        self.stats['media_files'] = len(media)

        if media:
            self.add_issue(
                Severity.INFO,
                'Media Files',
                f'Document contains {len(media)} media file(s) (images, etc.)'
            )

    def get_summary(self) -> Dict[str, Any]:
        """Get diagnostic summary."""
        error_count = len([i for i in self.issues if i.severity == Severity.ERROR])
        warning_count = len([i for i in self.issues if i.severity == Severity.WARNING])
        info_count = len([i for i in self.issues if i.severity == Severity.INFO])

        return {
            'file': self.filepath,
            'status': 'FAIL' if error_count > 0 else ('WARN' if warning_count > 0 else 'PASS'),
            'errors': error_count,
            'warnings': warning_count,
            'info': info_count,
            'statistics': self.stats,
            'issues': [i.to_dict() for i in self.issues]
        }

    def print_report(self):
        """Print formatted report to console."""
        print(f"{Colors.BOLD}{'=' * 60}{Colors.RESET}")
        print(f"{Colors.BOLD}DOCX Diagnostic Report{Colors.RESET}")
        print(f"File: {self.filepath}")
        print(f"Size: {self.stats.get('file_size_mb', 'N/A')} MB")
        print(f"{Colors.BOLD}{'=' * 60}{Colors.RESET}\n")

        # Group issues by category
        by_category = defaultdict(list)
        for issue in self.issues:
            by_category[issue.category].append(issue)

        # Print issues
        for category in sorted(by_category.keys()):
            print(f"\n{Colors.BOLD}[{category}]{Colors.RESET}")
            for issue in by_category[category]:
                print(issue.format(self.verbose))
                print()

        # Print summary
        summary = self.get_summary()
        print(f"\n{Colors.BOLD}{'=' * 60}{Colors.RESET}")

        status_color = {
            'PASS': Colors.GREEN,
            'WARN': Colors.YELLOW,
            'FAIL': Colors.RED
        }.get(summary['status'], '')

        print(f"Status: {status_color}{Colors.BOLD}{summary['status']}{Colors.RESET}")
        print(f"Errors: {Colors.RED}{summary['errors']}{Colors.RESET}")
        print(f"Warnings: {Colors.YELLOW}{summary['warnings']}{Colors.RESET}")
        print(f"Info: {Colors.BLUE}{summary['info']}{Colors.RESET}")

        # Print key statistics
        if self.stats:
            print(f"\n{Colors.BOLD}Statistics:{Colors.RESET}")
            stat_items = [
                ('tracked_changes', 'Tracked Changes'),
                ('content_controls', 'Content Controls'),
                ('field_codes', 'Field Codes'),
                ('equations', 'Equations'),
                ('hyperlinks', 'Hyperlinks'),
                ('embedded_objects', 'Embedded Objects'),
                ('media_files', 'Media Files'),
            ]
            for key, label in stat_items:
                if key in self.stats:
                    val = self.stats[key]
                    if isinstance(val, dict):
                        val = val.get('total', val)
                    if val and val > 0:
                        print(f"  {label}: {val}")

        print(f"{Colors.BOLD}{'=' * 60}{Colors.RESET}\n")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description='Diagnose DOCX files for potential processing issues',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python docx_diagnostic.py document.docx
  python docx_diagnostic.py document.docx --verbose
  python docx_diagnostic.py document.docx --json
  python docx_diagnostic.py *.docx --json > report.json

Exit codes:
  0 - All files passed (no errors)
  1 - One or more files had errors
  2 - Invalid arguments or file not found
        """
    )

    parser.add_argument(
        'files',
        nargs='+',
        help='DOCX file(s) to analyze'
    )
    parser.add_argument(
        '--json',
        action='store_true',
        help='Output results as JSON'
    )
    parser.add_argument(
        '--verbose', '-v',
        action='store_true',
        help='Show detailed context for issues'
    )
    parser.add_argument(
        '--no-color',
        action='store_true',
        help='Disable colored output'
    )

    args = parser.parse_args()

    # Disable colors if requested or if not outputting to terminal
    if args.no_color or not sys.stdout.isatty() or args.json:
        Colors.disable()

    results = []
    has_errors = False

    for filepath in args.files:
        # Handle glob patterns on Windows
        if '*' in filepath or '?' in filepath:
            import glob
            expanded = glob.glob(filepath)
            if not expanded:
                print(f"Warning: No files match pattern: {filepath}", file=sys.stderr)
                continue
            files_to_check = expanded
        else:
            files_to_check = [filepath]

        for file in files_to_check:
            diagnostic = DocxDiagnostic(file, verbose=args.verbose)
            passed = diagnostic.run_all_checks()

            if not passed:
                has_errors = True

            if args.json:
                results.append(diagnostic.get_summary())
            else:
                diagnostic.print_report()

    if args.json:
        print(json.dumps(results if len(results) > 1 else results[0], indent=2))

    sys.exit(1 if has_errors else 0)


if __name__ == '__main__':
    main()
