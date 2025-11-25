# DocHub User Guide

## Table of Contents

1. [Overview](#overview)
2. [Dashboard](#dashboard)
3. [Current Session](#current-session)
   - [Session Tab](#session-tab)
   - [Processing Options Tab](#processing-options-tab)
   - [Styles Tab](#styles-tab)
   - [Replacements Tab](#replacements-tab)
   - [Tracked Changes Tab](#tracked-changes-tab)
4. [Analytics](#analytics)
5. [Settings](#settings)
   - [Profile](#profile)
   - [Appearance](#appearance)
   - [Typography](#typography)
   - [Language & Region](#language--region)
   - [Updates](#updates)
   - [API Connections](#api-connections)
   - [Storage](#storage)
   - [Submit Idea](#submit-idea)
6. [Additional Windows](#additional-windows)

---

## Overview

DocHub is a document processing application designed to automate and streamline Word document formatting, style validation, hyperlink checking, and content standardization. The application organizes work into sessions, where you can upload multiple documents, configure processing options, and apply consistent formatting rules.

### Main Navigation

The application includes these primary sections:
- **Dashboard** - Home screen with statistics and session management
- **Current Session** - Main workspace for processing documents
- **Analytics** - Visual charts and productivity metrics
- **Settings** - Application configuration and customization
- **Sessions** - View and manage all saved sessions
- **Documents** - Document library and management
- **Projects** - Project organization
- **Search** - Search across documents and sessions
- **Plugins** - Extension management

---

## Dashboard

The Dashboard is your home screen, providing an overview of your activity and quick access to sessions.

### Statistics Cards

Four cards display your all-time and daily statistics:

1. **Documents Processed** - Total number of documents you've processed through DocHub
2. **Hyperlinks Checked** - Total hyperlinks validated across all documents
3. **Feedback Imported** - Count of feedback items imported into documents
4. **Time Saved** - Estimated time saved (calculated at 101 seconds per hyperlink checked)

Each card shows:
- All-time total
- Today's activity
- Change compared to yesterday (trending up/down/no change)

### Session Actions

Two buttons at the top right:

- **New Session** - Creates a new document processing session
- **Load Session** - Opens an existing saved session

### Recent Sessions

Lists your recently accessed sessions, showing:
- Session name
- Number of documents
- Last modified time
- Session status (active/inactive)

Click any session to open it.

---

## Current Session

The main workspace where you upload, configure, and process documents. Organized into five tabs.

### Session Tab

#### Session Header
- **Session Name** - Click the edit icon to rename your session
- **Save and Close Session** - Saves all changes and returns to Dashboard

#### Statistics
Four cards showing session-specific metrics:
- Documents processed in this session
- Hyperlinks checked in this session
- Feedback imported in this session
- Time saved (calculated at 101 seconds per hyperlink)

#### Document Upload Area

**When Empty:**
- Drag and drop .docx files or click "Load Files" button
- Accepts multiple Word documents (.docx format only)

**With Documents:**
- **Process Documents** button - Processes all pending documents with current settings
- **Add More Files** button - Upload additional documents to the session

#### Document List

Each document shows:
- Status icon (pending, processing, completed, or error)
- File name and size
- Processing timestamp (when completed)
- Action buttons (visible on hover):
  - **Process** - Process this specific document (pending documents only)
  - **Open** - Open the processed document in Microsoft Word (completed documents only)
  - **Show in Folder** - Open the file location in Windows Explorer
  - **Remove** - Remove document from session

**Document Statuses:**
- **Pending** - Uploaded but not yet processed
- **Processing** - Currently being processed
- **Completed** - Successfully processed and ready
- **Error** - Processing failed (error message shown)

### Processing Options Tab

Controls which operations run when documents are processed. Organized into four groups.

#### Autonomous Processing (Master Toggle)
Enable to automatically apply all selected processing options when documents are added.

#### Text Formatting Fixes
- **Remove All Italics** - Removes italic formatting from all text
- **Outdated Titles** - Updates outdated document titles
- **Apply User Defined Styles** - Applies the styles configured in the Styles tab

#### Hyperlink Fixes
- **Top of the Document** - Updates hyperlinks at the document top
- **Table of Contents** - Updates all Table of Contents hyperlinks
- **theSource Hyperlinks** - Fixes internal theSource document links
- **theSource Content IDs** - Updates content ID references

#### Content Structure Fixes
- **Remove Extra Whitespace** - Cleans up excessive whitespace
- **Remove Extra Paragraphs** - Removes unnecessary paragraph breaks
- **Remove All Headers / Footers** - Deletes headers and footers
- **Add Document Warning** - Adds a standard warning to documents
- **Header 2 Section Tables** - Validates and formats tables in Header 2 sections

#### List & Table Fixes
- **List Indentation** - Standardizes list indentation levels
- **List Styles** - Applies uniform bullet and numbering styles
- **Table Formatting** - Applies consistent table formatting

### Styles Tab

Configure formatting rules for document styles. Changes auto-save immediately.

#### Lists & Bullets Uniformity

**Enable Toggle** - Turn list/bullet formatting on or off

**Indentation Increments:**
- **Symbol Position Increment** - How far each level's bullet/number indents (in inches)
- **Text Position Increment** - How far each level's text indents (in inches)
- Shows calculated indentations for all 5 levels

**Bullet Points Format:**
Configure bullet symbols for each of 5 levels:
- Level 0-4 bullet symbols (choose from Closed Bullet •, Open Bullet ○, or Closed Square ■)

#### Table Shading Colors

- **Header 2 Table Shading** - Color for Header 2 section table cells (default: #BFBFBF)
- **Other Table Shading** - Color for other table cells (default: #DFDFDF)

#### Paragraph Styles

Five style types can be configured: Header 1, Header 2, Header 3, Normal, and List Paragraph.

**For Each Style:**

**Font Settings:**
- **Font Family** - Typeface (Verdana, Arial, Times New Roman, etc.)
- **Font Size** - Text size in points (8pt to 72pt)
- **Text Color** - Color picker and hex code input

**Formatting (varies by style type):**

*Headers (1, 2, 3):*
- Simple toggles for Bold, Italic, Underline
- Alignment (Left, Center, Right, Justify)

*Normal & List Paragraph:*
- **Format Toggles** - Bold, Italic, Underline (disabled when locked)
- **Preserve Toggles** - Lock icon buttons that preserve existing formatting:
  - **Bold Lock** - When enabled, preserves existing bold (ignores bold setting)
  - **Italic Lock** - When enabled, preserves existing italic (ignores italic setting)
  - **Underline Lock** - When enabled, preserves existing underline (ignores underline setting)

**Alignment:**
- Left, Center, Right, or Justify text alignment

**Spacing:**
- **Space Before** - Points before paragraph (0-72pt in 3pt increments)
- **Space After** - Points after paragraph (0-72pt in 3pt increments)
- **Line Spacing** - Single, 1.15 (Default), 1.5 Lines, or Double

**Special Options:**
- **Don't add space between paragraphs of the same style** - Checkbox to remove spacing when same style follows (available for Normal and List Paragraph)

**List Paragraph Only:**
- **Bullet Position** - Where bullets appear (in inches)
- **Text Position** - Where text starts (in inches)

**Preview:**
Each style shows a live preview of how text will appear with current settings.

### Replacements Tab

Configure text find-and-replace rules that run during document processing.

(Details based on session replacement configuration)

### Tracked Changes Tab

Manage and review tracked changes in documents.

(Details based on session tracked changes configuration)

---

## Analytics

Visual representation of your productivity over time.

### View Modes

Switch between three time ranges:
- **Daily** - Last 30 days
- **Weekly** - Last 12 weeks
- **Monthly** - Last 12 months

### Statistics Summary

Four cards showing all-time totals:
- Documents Processed
- Hyperlinks Checked
- Feedback Imported
- Time Saved (in minutes)

### Charts

Three interactive charts:

1. **Documents Processed Over Time** - Line chart showing document processing trends
2. **Hyperlinks Checked Over Time** - Line chart showing hyperlink validation trends
3. **Activity Breakdown** - Bar chart comparing Feedback and Time metrics side by side

All charts update based on the selected view mode.

### Reset All Stats

Button to permanently delete all historical data. Requires confirmation before proceeding.

---

## Settings

Customize application appearance, behavior, and integrations.

### Profile

**Personal Information:**
- First Name
- Last Name
- Email

**Actions:**
- **Export Settings** - Save all settings and data to a file
- **Import Settings** - Load settings and data from a previously exported file
- **Save Changes** - Save profile updates

### Appearance

#### Theme & Display

**Theme Mode:**
- **Light** - Light color scheme
- **Dark** - Dark color scheme

**Interface Density:**
- **Comfortable** - Spacious layout with more padding
- **Compact** - Tighter layout for more screen space
- **Minimal** - Most compact layout

#### Accent Color

Choose from 8 preset colors or create a custom color:
- Blue, Purple, Green, Orange, Pink, Cyan, Indigo
- Custom (opens color picker for any color)

#### Visual Effects

Two toggles:
- **Glass morphism effects** - Blur and transparency effects throughout the UI
- **Smooth animations** - Transitions and micro-interactions

Disabling effects can improve performance on slower systems.

#### Custom Theme Colors

**Enable Toggle** - Turn on to customize individual UI elements

**Color Options:**
- **Primary** - Main brand color
- **Background** - Main background color (shows auto-calculated text color)
- **Header** - Header bar color (shows auto-calculated text color)
- **Sidebar** - Sidebar color (shows auto-calculated text color)
- **Borders** - Border color throughout the UI

### Typography

Customize fonts and text styling.

#### Quick Presets

Four preset configurations:
- **Reading** - Optimized for reading long content
- **Compact** - Space-efficient layout
- **Presentation** - Bold, easy-to-read style
- **Default** - Standard system settings

#### Live Preview

Shows sample text with current settings applied.

#### Font Settings

- **Family** - Choose from 11 font options (Inter, Roboto, System Default, etc.)
- **Size** - Slider from 12px to 20px
- **Weight** - Light, Regular, Medium, Semibold, Bold
- **Style** - Normal or Italic

#### Spacing Settings

- **Letter Spacing** - Slider from tight (-0.05em) to wide (0.1em)
- **Line Height** - Slider from compact (1.0) to spacious (2.0)

All changes preview in real-time.

### Language & Region

**Language:**
- English (US), Español (Spanish), 中文 (Mandarin Chinese)

**Timezone:**
- Select from US timezones and common international zones
- Affects timestamp displays throughout the application

**Date Format:**
- MM/DD/YYYY (US format)
- DD/MM/YYYY (International)
- YYYY-MM-DD (ISO format)

### Updates

**Current Version:**
Shows your installed version number.

**Update Actions:**
- **Check for Updates** - Manually check for new versions
- **Download Update** - Download available update (when found)
- **Install & Restart** - Install downloaded update and restart app

**Update Settings:**
- **Auto-update on launch** - Automatically check for updates when app starts
- **Check for pre-releases** - Include beta versions in update checks

**Update Status:**
Displays current status (checking, downloading with progress bar, ready to install, or up to date).

### API Connections

Configure external service integrations.

#### Hyperlink Processing

**PowerAutomate Dictionary URL:**
- API endpoint for retrieving document metadata and validating links
- Application auto-sanitizes pasted URLs with encoding issues
- Shows validation status (valid, warnings, or errors)
- Used by Hyperlink Service to enrich collected document IDs

#### Feedback & Reporting

**Bug Report API URL:**
- Where bug reports are sent
- Leave as default to use email instead

**Submit Idea API URL:**
- Where feature suggestions are sent
- Leave as default to use email instead

### Storage

Manage application data and storage.

**Storage Used:**
- Visual progress bar showing space consumed
- Percentage and total usage displayed

**Data Management:**
- **Clear Cache** - Remove temporary cached data
- **Export Settings & Data** - Save all settings, sessions, and statistics to file
- **Import Settings & Data** - Load previously exported data (triggers app reload)
- **Delete Account** - Permanently remove all account data

### Submit Idea

Submit feature requests and improvement ideas.

**Form Fields:**
- **Title for Idea** - Brief description of your suggestion
- **Why is this needed / Who would this benefit?** - Detailed explanation

**Submit Button:**
Sends idea to configured API endpoint or opens email client if using default settings. Includes:
- Your idea title and description
- Submission timestamp
- Current app version

---

## Additional Windows

### Sessions
View and manage all saved sessions. Browse, filter, and load previous sessions.

### Documents
Central library of all documents across sessions. Search and organize your document collection.

### Projects
Organize sessions and documents into projects for better workflow management.

### Search
Powerful search across all documents, sessions, and projects. Find content quickly.

### Plugins
Manage extensions that add functionality to DocHub.

---

## Tips & Best Practices

1. **Use Sessions** - Organize related documents into sessions for batch processing
2. **Configure Styles First** - Set up your style preferences before processing documents
3. **Test Processing Options** - Try options on a single document before batch processing
4. **Save Sessions** - Sessions auto-save, but use "Save and Close" to ensure everything persists
5. **Monitor Analytics** - Track your productivity improvements over time
6. **Export Settings** - Regularly back up your configurations using Export Settings
7. **Keep Updated** - Enable auto-updates to get the latest features and fixes

---

## Keyboard Shortcuts

(Shortcuts will be documented here as they're implemented in the application)

---

## Troubleshooting

**Documents won't upload:**
- Verify files are .docx format
- Check file permissions
- Try smaller batch sizes

**Processing fails:**
- Review error messages in document list
- Check Processing Options are configured correctly
- Verify API connections if using external services

**Settings not saving:**
- Ensure you click Save buttons where required
- Check storage space isn't full
- Try clearing cache and restarting

---

## Support

For additional help:
- Use the bug report feature in Settings → API Connections
- Submit feature ideas via Settings → Submit Idea
- Check application logs for detailed error information

---

*Last Updated: November 2025*
*DocHub User Guide v1.0*
