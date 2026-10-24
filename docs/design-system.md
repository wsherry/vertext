# Vertext design system

This document describes the current visual language used by the Vertext speaker workspace. It is a compact reference for extending the MVP consistently.

## Product character

Vertext uses a quiet, editorial workspace style: warm near-white surfaces, fine gray-green dividers, dark forest-green actions, and restrained purple and amber accents for insights and source categories. Controls are compact, rounded, and low contrast until selected or active.

## Typography

| Role | Typeface | Usage |
| --- | --- | --- |
| UI and body | DM Sans | Navigation, labels, helper text, buttons, body copy, and data labels |
| Display and headings | Manrope | Page titles, card headings, logo wordmark, and the brand mark |
| Fallback | `sans-serif` | Browser fallback if the web fonts cannot load |

Weights in use: 400 regular, 500 medium, 600 semibold, 700 bold, and 800 extra bold (Manrope). Body copy is generally compact; helper and metadata text use smaller sizes with comfortable line height. Headings use tight tracking and line height to keep the workspace scannable.

Fonts are loaded from Google Fonts in `index.html`. If the app needs to run without external font access, bundle DM Sans and Manrope locally and retain the same family names.

## Core color tokens

| Token | Value | Purpose |
| --- | --- | --- |
| Ink | `#20211f` | Primary text |
| Muted | `#777b76` | Secondary text |
| Paper | `#ffffff` | Cards and input surfaces |
| App background | `#f5f5f1` | Main page canvas |
| Wash | `#f4f5f0` | Subtle background sections |
| Line | `#e6e7e1` | Default borders and separators |
| Forest | `#446b52` | Primary action and brand accent |
| Soft forest | `#e9f0e9` | Selected and success-tinted surfaces |
| Purple | `#7261a3` | Insight and knowledge accents |
| Soft purple | `#f0edfa` | Purple-tinted surfaces |
| Amber | `#927243` | Caution, attention, and source interest accents |
| Soft amber | `#f7f0e3` | Amber-tinted surfaces |
| Red | `#a3574e` | Errors and destructive states |
| Soft red | `#f8ece9` | Error-tinted surfaces |
| Focus | `#acc0ae` | Keyboard focus outline |

The CSS contains additional shades for status indicators, graph nodes, and individual panels. Use the core tokens above for new surfaces and controls; use existing component styles for graph and status colors.

## Component styling

- **Buttons:** rounded corners (about 7 px), semibold text, forest-green primary treatment, subtle border on secondary actions, and a short press transition.
- **Cards and panels:** white or near-white backgrounds, thin neutral borders, 8–12 px corner radius, and restrained shadows only for selected items or overlays.
- **Inputs:** white surfaces, thin gray-green borders, compact labels, and a visible 3 px focus ring.
- **Navigation:** warm off-white sidebar, muted inactive items, and a pale green selected state.
- **Status:** green for ready/live/success, gray for inactive/ended, amber for attention, and red for errors.
- **Insights graph:** forest green for the talk, muted purple for sources, and warm amber for attendee needs.

## Layout and responsive behavior

The desktop workspace has a fixed-width sidebar beside a flexible content area. Main content is centered with a maximum width of 1,290 px and responsive horizontal padding. At narrower widths, panels and insight cards collapse into a single column; the layout supports viewports down to 320 px.

## Source of truth

The implementation lives in `client/src/styles.css`; font loading lives in `index.html`. This document records the current design rather than defining a separate theme system.
