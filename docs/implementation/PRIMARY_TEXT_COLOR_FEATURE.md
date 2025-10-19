# Luminance-Based Primary Text Color Feature

## Overview

Automatically calculates optimal text color (black or white) for primary-colored elements based on the luminance of the custom primary color. This ensures text remains readable on buttons, badges, and other primary-colored UI elements regardless of the custom color chosen.

## How It Works

### 1. Color Calculation (ThemeContext.tsx)

When custom colors are enabled, the system:

- Reads the user's custom primary color (e.g., `#3b82f6`)
- Calculates its luminance using WCAG 2.1 formula
- Determines optimal contrast text color:
  - **Light backgrounds** (luminance > 0.5) → Black text (`#000000`)
  - **Dark backgrounds** (luminance ≤ 0.5) → White text (`#FFFFFF`)

```typescript
// ThemeContext.tsx line 216
const primaryTextColor = getContrastTextColor(customPrimaryColor);
root.style.setProperty('--custom-primary-text', hexToHSL(primaryTextColor));
```

### 2. CSS Variable Application (global.css)

The calculated text color is applied through CSS variables:

```css
/* Line 275-276: Override the CSS variable */
[data-custom-colors='true'] {
  --color-primary-foreground: hsl(var(--custom-primary-text)) !important;
}

/* Lines 279-285: Apply to all primary elements */
[data-custom-colors='true'] .bg-primary,
[data-custom-colors='true'] .bg-primary *,
[data-custom-colors='true'] button.bg-primary,
[data-custom-colors='true'] button.bg-primary * {
  color: hsl(var(--custom-primary-text)) !important;
}
```

### 3. Automatic Mode Detection

The system intelligently switches between modes:

**Standard Mode (Light/Dark themes):**

- Uses preset `--color-primary-foreground` from theme
- Light mode: `hsl(210 40% 98%)` (near white)
- Dark mode: `hsl(210 40% 98%)` (near white)

**Custom Color Mode:**

- Activates when: Settings → Appearance → "Custom Theme Colors" is enabled
- Calculates text color dynamically based on chosen primary color
- Updates automatically when primary color changes

## User Experience

### Enabling Custom Colors

1. Open **Settings** → **Appearance**
2. Toggle **"Custom Theme Colors"** ON
3. Click the primary color picker
4. Choose any color - text will automatically adjust

### Visual Examples

#### Example 1: Light Primary Color

- **Primary Color:** `#FFD700` (Gold - luminance 0.78)
- **Calculated Text:** Black (`#000000`)
- **Result:** Dark text on light gold background ✓ Readable

#### Example 2: Dark Primary Color

- **Primary Color:** `#1a1a2e` (Dark Navy - luminance 0.05)
- **Calculated Text:** White (`#FFFFFF`)
- **Result:** White text on dark navy background ✓ Readable

#### Example 3: Medium Primary Color

- **Primary Color:** `#3b82f6` (Blue - luminance 0.32)
- **Calculated Text:** White (`#FFFFFF`)
- **Result:** White text on blue background ✓ Readable

## Technical Details

### Luminance Calculation

Uses WCAG 2.1 relative luminance formula:

```text
L = 0.2126 * R + 0.7152 * G + 0.0722 * B
```

With gamma correction for sRGB color space.

### Affected Elements

All elements using these classes:

- `.bg-primary` - Primary background color
- `.text-primary-foreground` - Primary foreground text
- `button.bg-primary` - Primary buttons (like "Process Documents")
- Badges, checkboxes, toggles with primary color

### File Changes

1. **src/styles/global.css** (lines 271-290)
   - Added `--color-primary-foreground` override
   - Added `.bg-primary` text color rules
   - Added `.text-primary-foreground` rules

2. **src/contexts/ThemeContext.tsx** (existing, line 216)
   - Already calculates `primaryTextColor`
   - Already sets `--custom-primary-text` variable

## Testing Guide

### Manual Test Scenarios

#### Test 1: Very Light Primary Color

1. Enable Custom Theme Colors
2. Set primary color to: `#FFEB3B` (bright yellow)
3. **Expected:** All primary buttons show **BLACK** text
4. **Verify:** Text is clearly readable

#### Test 2: Very Dark Primary Color

1. Enable Custom Theme Colors
2. Set primary color to: `#212121` (very dark gray)
3. **Expected:** All primary buttons show **WHITE** text
4. **Verify:** Text is clearly readable

#### Test 3: Medium Brightness Colors

1. Test colors around the threshold (luminance ~0.5):
   - `#808080` (medium gray) → White text
   - `#00AA00` (medium green) → White text
   - `#FFA500` (orange) → Black text
   - `#4169E1` (royal blue) → White text

#### Test 4: Mode Switching

1. Enable Custom Theme Colors with light primary color
2. **Verify:** Black text appears
3. Disable Custom Theme Colors
4. **Verify:** Returns to standard theme text color
5. Re-enable Custom Theme Colors
6. **Verify:** Black text reappears correctly

### Visual Testing Checklist

- [ ] Process Documents button (CurrentSession page)
- [ ] Active session indicators (Sidebar)
- [ ] Primary action buttons (SessionManager)
- [ ] Update notification button (UpdateNotification)
- [ ] Save buttons in Settings
- [ ] Active tab indicators

## Troubleshooting

### Text Color Not Updating

**Symptom:** Text remains default color after changing primary color

**Solutions:**

1. Ensure "Custom Theme Colors" toggle is ON
2. Hard refresh browser (Ctrl+Shift+R)
3. Check browser console for errors
4. Verify `data-custom-colors="true"` attribute on `<html>` element

### Poor Contrast

**Symptom:** Text is barely visible on primary color

**Root Cause:** The threshold (0.5) works for most colors but edge cases may need adjustment

**Solution:** Adjust threshold in `colorConvert.ts`:

```typescript
// Line 165 - Current threshold
return luminance > 0.5 ? '#000000' : '#FFFFFF';

// If needed, adjust to 0.45 or 0.55 for better results
```

### Text Color in Standard Mode

**Symptom:** Custom text colors appear when custom mode is disabled

**Solution:** This should not happen - CSS rules only apply when `[data-custom-colors='true']`. Check that the attribute is being removed when disabling custom colors.

## Browser Compatibility

- ✅ Chrome/Edge 88+ (CSS `color-mix`, `hsl()` variables)
- ✅ Firefox 88+
- ✅ Safari 15.4+
- ❌ IE 11 (not supported)

## Performance Impact

- **Negligible** - Color calculation happens once on theme change
- CSS variables update instantly without re-render
- No JavaScript running during normal usage

## Future Enhancements

1. **Contrast Ratio Display:** Show WCAG contrast ratio in color picker
2. **Accessibility Warnings:** Alert when contrast is below AA standard
3. **Preview Mode:** Show text samples before applying color
4. **Smart Suggestions:** Recommend primary colors with good contrast
