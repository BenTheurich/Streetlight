# Workspace Header Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cramped exposed account controls with the approved compact account menu while preserving a one-row workspace header.

**Architecture:** Keep the existing `StreetlightWorkspace` header and `AdministratorAccount` component. Use the native Popover API for menu dismissal and keyboard behavior, then adjust the shared header CSS for centered tools and responsive email hiding.

**Tech Stack:** React 19, Next.js 16, CSS, native HTML Popover API, Node test runner

## Global Constraints

- Keep one 68-pixel header row.
- Preserve the existing tool names, authentication URLs, palette, and map workspace behavior.
- Add no dependency and no custom menu event listener.

---

### Task 1: Compact account menu and balanced header

**Files:**
- Modify: `web/components/AdministratorAccount.test.mjs`
- Modify: `web/components/AdministratorAccount.tsx`
- Modify: `web/app/globals.css`
- Modify: `web/components/StreetlightWorkspace.tsx`

**Interfaces:**
- Consumes: `AdministratorAccount({ email }: { email: string })`
- Produces: The same component API with a native account-menu popover.

- [x] **Step 1: Write the failing contract test**

Assert that the component contains one account-menu button, a popover with the full email, and the unchanged `/logout` link.

- [x] **Step 2: Run the focused test and verify it fails**

Run: `node --test web/components/AdministratorAccount.test.mjs`

Expected: FAIL because the account button and popover do not exist.

- [x] **Step 3: Implement the minimum approved markup and layout**

Use `popovertarget="administrator-account-menu"` on the account button and `popover="auto"` on the menu. Derive the avatar from the first two email characters, keep the full email in the menu, and update the header to 68 pixels with centered tools and responsive email hiding.

- [x] **Step 4: Verify behavior and presentation**

Run the focused test, lint, TypeScript, and the Impeccable detector. Inspect the live desktop header and one narrow viewport, then make at most one correction pass.

- [x] **Step 5: Commit**

Commit the tested header implementation and evidence on `codex/phase7-auth`.
