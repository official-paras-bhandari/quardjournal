---
name: Midnight Professional Terminal
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#3a3939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#201f1f'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353534'
  on-surface: '#e5e2e1'
  on-surface-variant: '#c7c4d7'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#908fa0'
  outline-variant: '#464554'
  surface-tint: '#c0c1ff'
  primary: '#c0c1ff'
  on-primary: '#1000a9'
  primary-container: '#8083ff'
  on-primary-container: '#0d0096'
  inverse-primary: '#494bd6'
  secondary: '#c8c5ca'
  on-secondary: '#303033'
  secondary-container: '#47464a'
  on-secondary-container: '#b6b4b8'
  tertiary: '#c6c6cf'
  on-tertiary: '#2f3037'
  tertiary-container: '#909099'
  on-tertiary-container: '#282930'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e1e0ff'
  primary-fixed-dim: '#c0c1ff'
  on-primary-fixed: '#07006c'
  on-primary-fixed-variant: '#2f2ebe'
  secondary-fixed: '#e4e1e6'
  secondary-fixed-dim: '#c8c5ca'
  on-secondary-fixed: '#1b1b1e'
  on-secondary-fixed-variant: '#47464a'
  tertiary-fixed: '#e2e1eb'
  tertiary-fixed-dim: '#c6c6cf'
  on-tertiary-fixed: '#1a1b22'
  on-tertiary-fixed-variant: '#45464e'
  background: '#131313'
  on-background: '#e5e2e1'
  surface-variant: '#353534'
typography:
  headline-xl:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Geist
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  body-md:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
  body-sm:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0em
  data-mono:
    fontFamily: Geist Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0em
  label-caps:
    fontFamily: Geist
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  headline-xl-mobile:
    fontFamily: Geist
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  container-padding: 1.5rem
  element-gap-xs: 0.25rem
  element-gap-sm: 0.5rem
  element-gap-md: 1rem
  grid-gutter: 1rem
  max-width: 1440px
---

## Brand & Style

This design system is engineered for high-performance environments where focus, precision, and information density are paramount. It adopts a **Professional Terminal** aesthetic, blending the utilitarian efficiency of a command-line interface with the refined sensibilities of modern high-end software.

The style is characterized by **Technical Minimalism**. It rejects decorative flourishes in favor of a strict "ink-and-paper" digital philosophy. By utilizing a "Deepest Black" foundation, the UI eliminates visual noise and light bleed, allowing the content and the primary Indigo actions to command full attention. The emotional response is one of absolute control, technical authority, and calm focus. 

Key stylistic pillars include:
- **Tonal Layering:** Depth is communicated through subtle shifts in value (from #000000 to #050505) rather than traditional drop shadows.
- **High Density:** Information is packed tightly to minimize scrolling and maximize data visibility, suitable for power users.
- **Architectural Borders:** Thin, 1px lines define the structure, creating a sense of rigid, reliable engineering.

## Colors

The color palette is restricted to a tight monochromatic range with a single high-contrast functional accent. 

- **The Void (#000000):** The primary canvas. It ensures perfect black levels on OLED displays and creates a "bottomless" feel for the UI.
- **Charcoal Layer (#050505):** Used for elevated containers, sidebars, and nested components to create a subtle hierarchy of information.
- **Indigo Action (#6366f1):** Reserved exclusively for primary actions, progress indicators, and active states. Its vibrancy against the black background provides immediate visual orientation.
- **Zinc/Slate Borders (#18181b):** The structural skeleton. These 1px borders are designed to be "felt but not seen," providing just enough contrast to separate functional areas.
- **Typography Tones:** Use pure white (#ffffff) for high-priority headers, Zinc-400 (#a1a1aa) for secondary text, and Zinc-500 (#71717a) for disabled or tertiary metadata.

## Typography

This design system uses a dual-font strategy to separate intent. 

**Geist** is the primary typeface for all UI elements, headings, and descriptive text. Its high x-height and geometric clarity maintain legibility even at the small sizes required by a high-density layout.

**Geist Mono** is utilized for all "active data"—including IDs, logs, code snippets, financial figures, and status metrics. This distinction immediately signals to the user which information is raw data versus UI instruction.

Maintain a strict hierarchy:
- **Headlines:** Keep short and punchy.
- **Data:** Use tabular figures in Geist Mono to ensure columns of numbers align vertically for easy comparison.
- **Labels:** Use the `label-caps` style for section headers within sidebars or small utility descriptions.

## Layout & Spacing

The layout philosophy is built on a **Rigid Grid** with a 4px base unit. Density is prioritized, meaning margins and paddings are tighter than typical consumer SaaS products.

- **Desktop:** A 12-column grid with 16px (1rem) gutters. Content should be contained within a 1440px max-width, though dashboard views may extend to a full-bleed "Fluid Grid" for data-heavy tables.
- **Tablet:** 8-column grid with 16px gutters.
- **Mobile:** 4-column grid with 12px (0.75rem) gutters.

Alignment is critical. Elements should snap to the grid to maintain the "Terminal" feel. Avoid using whitespace as a primary separator; instead, use the 1px subtle borders to define zones while keeping elements tightly packed.

## Elevation & Depth

In this design system, shadows are almost entirely deprecated in favor of **Tonal Layering**. Depth is achieved through the stacking of backgrounds:

1.  **Level 0 (Base):** #000000. Used for the main application background.
2.  **Level 1 (Surface):** #050505. Used for cards, sidebars, and navigation headers. These surfaces are defined by a 1px border (#18181b).
3.  **Level 2 (Interaction):** #0a0a0a. Used for hover states on Level 1 elements.
4.  **Level 3 (Popovers):** #0a0a0a with a slightly more prominent border (#27272a). Only for modals or dropdowns, a very subtle, large-radius shadow (0px 10px 30px rgba(0,0,0,0.5)) can be used to prevent the menu from bleeding into the background.

Use "inner-glow" borders (0.5px white at 5% opacity) on primary buttons to give them a slight metallic/glass sheen without using heavy gradients.

## Shapes

The shape language is **Soft-Industrial**. While the layout is rigid and grid-based, UI elements possess a slight radius to prevent the interface from feeling "sharp" or aggressive.

- **Standard Elements:** 0.25rem (4px) radius. Used for buttons, input fields, and small cards.
- **Large Containers:** 0.5rem (8px) radius. Used for main content areas and modals.
- **Terminal Components:** Elements like tags or status indicators may use a 0px radius if they are intended to look like "blocks" of data.

Consistency in rounding is vital to maintaining the professional, tool-like appearance. Never use pill-shapes or high-radius circles unless for user avatars.

## Components

### Buttons
- **Primary:** Solid Indigo (#6366f1) with white text. No gradient. 
- **Secondary:** Transparent background with the 1px Zinc (#18181b) border. Text is Zinc-100.
- **Ghost:** No background or border. Text is Zinc-400, turning White on hover.
- **Size:** Compact. Vertical padding should be minimal (8px).

### Input Fields
- **Style:** Background #050505, 1px border #18181b. 
- **Focus:** The border changes to Indigo (#6366f1). No "glow" or outer shadow.
- **Text:** Use Geist Mono for numerical inputs or technical IDs.

### Data Tables
- **Header:** Background #050505, uppercase label-caps typography, border-bottom 1px.
- **Rows:** Border-bottom 1px #18181b. Hover state changes row background to #0a0a0a.
- **Density:** High. Cell padding should not exceed 10px vertically.

### Chips/Status
- **Default:** Geist Mono, small font size. 
- **Success/Error:** Use low-saturation greens and reds, but keep the background dark. Only the text and a small dot indicator should carry the color.

### Navigation
- **Sidebar:** Fixed at #050505. Use subtle icons (20px) paired with Geist Medium text. Active states are indicated by an Indigo vertical line (2px) on the far left or right edge.