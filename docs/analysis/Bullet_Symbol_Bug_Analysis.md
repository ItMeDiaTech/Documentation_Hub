# Bullet Symbol Replacement Bug Analysis

## Problem Statement

"Bullet 3" still shows a square symbol (■) instead of the user-configured bullet character after processing.

## Root Cause Analysis

### Document Structure

```xml
<!-- Bullets 1-3 use abstractNum w:abstractNumId="2" -->
<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>

<!-- Bullets 4-6 use abstractNum w:abstractNumId="1" -->
<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>
```

### Numbering Definitions (BEFORE)

AbstractNum 2 has variable symbols per level:

- Level 0: ● (filled circle)
- Level 1: ○ (hollow circle)
- Level 2: ■ (SQUARE - the problematic symbol)

### Current Implementation Flow

```typescript
// Step 1: applyBulletUniformity() creates NEW custom list
const numId = manager.createCustomList(levels, 'UI Bullet List');

// Step 2: Assigns new list to bullet paragraphs
para.setNumbering(numId, level);

// Step 3: standardizeBulletSymbols() applies formatting
doc.standardizeBulletSymbols({
  font: '

Verdana',
  fontSize: 12,
  color: '000000',
  bold: true
});
```

## The Critical Issue

**`standardizeBulletSymbols()` PRESERVES existing bullet symbols by design!**

From the framework documentation:

> "Preserves user's chosen bullet characters - only standardizes font, size, color, and weight"

This means:

- ✅ It updates font, size, color, bold
- ❌ It does NOT change the bullet character itself

## Why Bullet 3 Shows a Square

1. "Bullet 3" paragraph references `numId="2", level="0"`
2. **BUT** the paragraph might be at a DEEPER indent level in the original document
3. The framework sees it as using the level 2 symbol (■) from abstractNum 2
4. Creating a new custom list doesn't help if paragraphs aren't reassigned to it
5. `standardizeBulletSymbols()` then preserves the ■ symbol

## Solution Options

### Option A: Framework-Only Approach (RECOMMENDED)

Use ONLY the framework's `standardizeBulletSymbols()` but with explicit symbol replacement:

```typescript
// Check if framework supports symbol replacement
const result = doc.standardizeBulletSymbols({
  symbol: bullet, // NEW: explicit symbol replacement
  font: 'Verdana',
  fontSize: 12,
  color: '000000',
  bold: true,
});
```

**Problem:** Need to verify if framework supports `symbol` parameter.

### Option B: Ensure All Paragraphs Are Reassigned

Make sure `applyBulletUniformity()` actually reassigns ALL bullet paragraphs:

```typescript
for (const para of paragraphs) {
  const numbering = para.getNumbering();
  if (numbering && this.isBulletList(doc, numbering.numId)) {
    const level = Math.min(numbering.level || 0, levels.length - 1);
    para.setNumbering(numId, level); // ← Verify this executes
    standardizedCount++;
  }
}
```

### Option C: Direct XML Modification (HYBRID)

Keep custom list creation but also modify abstractNum 2 directly:

```typescript
// After creating custom list
// Also update existing abstractNum 2 to use user's bullets
const existingAbstractNums = manager.getAllAbstractNumberings();
for (const abstractNum of existingAbstractNums) {
  for (let i = 0; i < levels.length; i++) {
    const level = abstractNum.getLevel(i);
    if (level && level.getFormat() === 'bullet') {
      level.setText(bullets[i]); // Replace symbol
    }
  }
}
```

## Recommended Fix

**Use Option C (Hybrid Approach):**

1. Keep existing custom list creation (for new documents)
2. ALSO update ALL existing abstractNum definitions
3. Then apply formatting standardization

This ensures:

- New lists get user symbols ✅
- Existing lists get user symbols ✅
- All formatting is standardized ✅

## Implementation Priority

**HIGH** - This is a visible bug that affects user experience.
