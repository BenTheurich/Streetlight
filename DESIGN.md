---
name: Streetlight
description: Calm, map-first church outreach administration that carries light to every street.
colors:
  paper: "#f6f1e5"
  paper-bright: "#fffdf7"
  ink: "#101a29"
  muted: "#596675"
  night: "#030914"
  amber: "#e7ad50"
  outreach-orange: "#c96b3b"
  overdue-red: "#ad5547"
  packet-blue: "#2767e9"
  success-green: "#43785c"
  line: "#d8cfbf"
typography:
  display:
    fontFamily: "Georgia, serif"
    fontSize: "clamp(3.5rem, 8vw, 8rem)"
    fontWeight: 400
    lineHeight: 0.9
    letterSpacing: "-0.04em"
  title:
    fontFamily: "Trebuchet MS, Arial, sans-serif"
    fontSize: "1.55rem"
    fontWeight: 800
    lineHeight: 1.08
  body:
    fontFamily: "Trebuchet MS, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Trebuchet MS, Arial, sans-serif"
    fontSize: "0.74rem"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "0.14em"
rounded:
  control: "8px"
  panel: "12px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "16px"
  lg: "24px"
  xl: "36px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper-bright}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.paper-bright}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
    height: "44px"
  input:
    backgroundColor: "{colors.paper-bright}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
    height: "44px"
  panel:
    backgroundColor: "{colors.paper-bright}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "20px"
---

# Design System: Streetlight

## Overview

**Creative North Star: "Carry the Light"**

Streetlight moves from cinematic darkness into warm daylight: a literal expression of the church
bringing light to streets that may otherwise be forgotten. The public experience may be atmospheric
and editorial, while the administrator workspace remains calm, map-first, and operational. Both
surfaces share the same navy, cream, amber, logo, and deliberate restraint.

The interface should feel made for a church office rather than a generic SaaS dashboard. Brand
character comes from the lamp mark, warm paper surfaces, precise typography, and truthful map data.
Operational screens favor scanability and native expectations; decoration never competes with the
map or the administrator's next action.

**Key Characteristics:**

- Warm cream paper against deep navy ink.
- Restrained amber light, with map colors reserved for real coverage meaning.
- Editorial Georgia display type paired with sturdy Trebuchet interface type.
- Map-first layouts, compact controls, and clear recovery states.
- Gentle depth and motion that clarify layers without making the tool feel glossy.

## Colors

The palette moves between midnight navy and warm paper, with amber as literal lamplight and the
remaining colors carrying factual map state.

### Primary

- **Lamp Navy:** Primary text, controls, navigation, and the dark atmospheric field.
- **Lamplight Amber:** Rare emphasis, spiritual warmth, and small labels—not a general action color.

### Secondary

- **Packet Blue:** Selected proposals, focus, links, and map actions.
- **Outreach Orange:** Included territory and middle-aged coverage.
- **Overdue Red:** Streets waiting longest and destructive or urgent states.
- **Success Green:** Recent outreach and successful completion.

### Neutral

- **Church Paper:** Main page background.
- **Bright Paper:** Cards, fields, sidebars, and raised working surfaces.
- **Slate Text:** Supporting copy and secondary labels.
- **Parchment Line:** Borders, separators, and control outlines.
- **Midnight:** Landing-page darkness only; operational screens default to paper.

**The Factual Color Rule.** On maps, blue, green, amber, orange, red, and gray retain their
established data meanings. Decorative styling must not borrow those colors in ways that confuse
coverage state.

**The Rare Light Rule.** Amber is most effective when scarce. Use it for atmosphere and emphasis,
not every button or heading.

## Typography

**Display Font:** Georgia (with serif fallback)  
**Body Font:** Trebuchet MS (with Arial and sans-serif fallback)

**Character:** Georgia supplies a warm editorial and quietly ecclesial voice. Trebuchet keeps tools
direct, readable, and familiar without collapsing into generic system-dashboard styling.

### Hierarchy

- **Display** (400, fluid 3.5–8rem, 0.9): Landing statements and rare ceremonial moments.
- **Headline** (400, fluid 2.2–4.5rem, 0.95): Public-page section statements.
- **Title** (800, about 1.55rem, 1.08): Workspace panel titles and important task headings.
- **Body** (400, 1rem, 1.55): Explanations and instructions; keep lines comfortably readable.
- **Label** (900, 0.74rem, tracked uppercase): Wordmarks, eyebrows, compact categories, and metrics.

**The Two-Voice Rule.** Georgia speaks the mission; Trebuchet runs the work. Do not introduce a
third font or use display type for dense controls.

## Layout

The administrator workspace is a persistent map with one changing tool sidebar. At desktop width,
the header is one 76px row, the map owns roughly three quarters of the viewport, and the sidebar
owns the rest. At tablet width (1024px and below), the header becomes two rows, the complete
four-tool navigation remains visible, the map sits above the full-width tool panel, and controls
remain at least 44px tall. At phone width (600px and below), labels become compact without changing
their accessible names.

Use a restrained 6/10/16/24/36px rhythm. Dense operational groups may use the smaller steps;
public storytelling earns larger gaps. Avoid nested dashboards, competing sidebars, and horizontal
scrolling.

**The Map Owns the Room Rule.** Tool chrome explains and edits the map; it never visually
outweighs it.

## Elevation & Depth

Operational surfaces are flat by default and separated with warm borders. Soft ambient shadows
identify floating map controls, menus, and modal recovery states. The landing page may use wider
glows and deeper shadows around the lamp, map, and printed packet to create cinematic depth.

### Shadow Vocabulary

- **Workspace lift** (`0 8px 28px rgb(16 26 41 / 5%)`): Header separation.
- **Floating control** (`0 14px 30px rgba(48, 45, 40, 0.16)`): Legends and map controls.
- **Recovery layer** (`0 12px 30px rgb(16 26 41 / 18%)`): Prompts requiring an explicit choice.
- **Cinematic object** (`0 22px 70px rgba(20, 30, 38, 0.14)`): Landing-page storytelling only.

**The Flat-by-Default Rule.** A shadow signals a real layer or state. Static cards use borders and
surface color instead.

## Shapes

Workspace controls use gently rounded 8px corners; substantial panels use 12px. Pills are reserved
for compact status or identity. The public landing page may use sharper rectangular actions beside
organic circular light and map forms. Borders stay thin and warm.

## Components

### Buttons

- **Shape:** Compact and confident, with 8px workspace corners and a 44px minimum height.
- **Primary:** Lamp Navy on Bright Paper text.
- **Secondary:** Bright Paper with Lamp Navy text and a Parchment Line border.
- **Hover / Focus:** A subtle navy lift on hover; a clearly visible blue 3px focus ring.

### Cards / Containers

- **Corner Style:** 12px for substantial operational cards.
- **Background:** Bright Paper over Church Paper.
- **Shadow Strategy:** Flat at rest; shadow only when floating above the map or blocking progress.
- **Border:** One-pixel Parchment Line.
- **Internal Padding:** Usually 16–24px.

### Inputs / Fields

- **Style:** Bright Paper, one-pixel Parchment Line, 8px corners, 44px minimum height.
- **Focus:** Blue 3px external ring; never rely on color change alone.
- **Error / Disabled:** Plain-language message beside the field; disabled controls retain labels.

### Navigation

The Streetlight mark stays left, the four administrator tools remain directly available, and the
account stays right. The active tool uses Lamp Navy fill and paper text. Tablet navigation wraps
into a deliberate second row rather than becoming a hidden menu.

### Map Controls

Map controls float in Bright Paper with soft depth. The coverage legend stays factual and vertical.
The church pin is anchored by its tip. Map and satellite views use a familiar layer preview.

## Do's and Don'ts

### Do:

- **Do** keep the map visible while administrators move through Coverage, Generate, Reconcile, and
  Territory.
- **Do** use church-specific language such as tracts and outreach.
- **Do** keep all interactive targets at least 44px and preserve visible keyboard focus.
- **Do** make failures recoverable and keep the last valid territory or batch visible.
- **Do** use the landing-page lamp, paper, navy, and amber details to make operational screens feel
  related without importing its cinematic density.

### Don't:

- **Don't** add generic SaaS gradients, glass cards, oversized metric dashboards, or decorative
  charts.
- **Don't** use map-state colors as decoration.
- **Don't** hide the normal workflow behind a wizard, hamburger menu, or AI-style recommendation.
- **Don't** fill empty space with explanatory copy the administrator does not need.
- **Don't** add religious ornament merely for atmosphere; the lamp, language, and purpose carry the
  church identity.
