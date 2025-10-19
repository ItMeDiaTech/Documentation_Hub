## Problem Description

**Type:** Bug (Infinite Re-render Loop)
**Priority:** High
**Likelihood:** 60%
**Impact:** App freeze/crash when theme color parsing fails
**Timeline:** 1-2 weeks (user enters invalid color value)

ThemeContext calls `setState` inside a `useEffect` error handler, which can trigger an infinite re-render loop when color parsing fails.

### Affected Files

- [`src/contexts/ThemeContext.tsx:203-268`](src/contexts/ThemeContext.tsx#L203-L268) - Custom color application with error handler

###Current Problematic Code

```typescript
useEffect(() => {
  const root = window.document.documentElement;

  if (useCustomColors) {
    try {
      root.setAttribute('data-custom-colors', 'true');

      const foregroundColor = getContrastTextColor(customBackgroundColor);
      root.style.setProperty('--custom-primary', hexToHSL(customPrimaryColor));
      // ... more color applications
    } catch (error) {
      log.error('[ThemeContext] Error applying custom colors:', error);

      // ❌ INFINITE LOOP TRAP!
      setUseCustomColors(false); // Triggers useEffect again!
      root.removeAttribute('data-custom-colors');
    }
  }
}, [useCustomColors, customPrimaryColor, customBackgroundColor /* deps */]);
```

## The Infinite Loop Scenario

**Step 1:** User enters invalid color (e.g., "#GGGGGG")
**Step 2:** useEffect runs, `hexToHSL("#GGGGGG")` throws error
**Step 3:** Catch block calls `setUseCustomColors(false)` → state change
**Step 4:** State change triggers useEffect again (dependency changed)
**Step 5:** If error persists (bad color in localStorage), loop continues

**Result:** React error: "Maximum update depth exceeded"

## Additional Issues

**Problem 2:** Multiple useEffect hooks modify same DOM element

7 separate useEffect hooks all modify `window.document.documentElement`:

- Theme application (light/dark)
- Accent color
- Custom colors
- Density
- Animations
- Blur effects
- Typography

All running simultaneously during initial mount = potential race conditions

**Problem 3:** No validation before applying colors

Colors applied directly without validation:

```typescript
root.style.setProperty('--custom-primary', hexToHSL(customPrimaryColor));
```

If `hexToHSL()` throws, entire effect fails and triggers recovery via setState.

## Root Cause

1. **Error Recovery in useEffect:** Calling setState inside effect's error handler creates feedback loop
2. **No Color Validation:** Invalid colors aren't caught before attempting to apply
3. **Lack of Error Boundaries:** No fallback mechanism to prevent cascading failures
4. **Too Many Effects:** 7 separate hooks all modifying the same DOM element

## Evidence

**From Code Comments:**

- Line 232: "Disable custom colors on error to prevent cascading failures"
  - Confirms failures have occurred
  - The "fix" (setUseCustomColors) creates new problem

## Proposed Solution

**Solution 1: Validate colors before applying**

```typescript
// NEW: Color validation utility
function isValidHexColor(color: string): boolean {
  return /^#[0-9A-F]{6}$/i.test(color);
}

// REFACTORED: Validate in state setter, not in effect
const [customPrimaryColor, setCustomPrimaryColor] = useState<string>(() => {
  const stored = localStorage.getItem('customPrimaryColor') || '#3b82f6';
  return isValidHexColor(stored) ? stored : '#3b82f6'; // Validate on load
});

// Validate in setter
const updateCustomPrimaryColor = (color: string) => {
  if (isValidHexColor(color)) {
    setCustomPrimaryColor(color);
  } else {
    log.warn(`Invalid hex color: ${color}, using default`);
    setCustomPrimaryColor('#3b82f6');
  }
};

// Effect no longer needs error recovery
useEffect(() => {
  const root = window.document.documentElement;

  if (useCustomColors) {
    // Safe to apply - already validated
    const foregroundColor = getContrastTextColor(customBackgroundColor);
    root.style.setProperty('--custom-primary', hexToHSL(customPrimaryColor));
  }
}, [useCustomColors, customPrimaryColor, customBackgroundColor]);
```

**Solution 2: Consolidate effects**

```typescript
// Instead of 7 separate useEffect hooks, use one coordinated effect
useEffect(() => {
  const root = window.document.documentElement;

  try {
    applyTheme(root, theme, resolvedTheme);
    applyAccentColor(root, accentColor, customAccentColor);
    applyCustomColors(root, useCustomColors, { customPrimaryColor /* ... */ });
    applyDensity(root, density);
    applyAnimations(root, animations);
    applyBlur(root, blur);
    applyTypography(root, { fontSize, fontFamily /* ... */ });
  } catch (error) {
    log.error('[ThemeContext] Failed to apply theme:', error);
    // DON'T call setState here - just log and use defaults
  }
}, [theme, accentColor /* all deps */]);
```

## Acceptance Criteria

- [ ] No `setState` calls inside useEffect error handlers
- [ ] All colors validated before applying to DOM
- [ ] Invalid colors in localStorage don't crash app
- [ ] No infinite re-render loops on theme errors
- [ ] Clear error messages when color validation fails
- [ ] Fallback to default theme on catastrophic failure
- [ ] All 7 theme aspects apply correctly

## Testing Strategy

1. **Invalid Color Test:** Enter "#ZZZZZZ", verify app doesn't crash, fallback applied
2. **Corrupted Storage Test:** Set invalid localStorage color, restart app, verify loads with default
3. **Rapid Change Test:** Change all settings rapidly (10 changes/second), verify no loop warnings
4. **Error Boundary Test:** Force hexToHSL() to throw, verify boundary catches, app remains usable

## Estimated Effort

**2 hours** (1 hour implementation + 1 hour testing)

## Research Reference

Full analysis: [`GH_Issues/scratchpads/predictive-analysis-2025-10-18.md`](../GH_Issues/scratchpads/predictive-analysis-2025-10-18.md#high-priority-issue-5-theme-context-infinite-loop-on-error)
