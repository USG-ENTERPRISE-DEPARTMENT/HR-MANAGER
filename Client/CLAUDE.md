# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start dev server on port 3000 (Vite serves on 3002)
npm run build      # Production build
npm run lint       # Type-check only — runs tsc --noEmit (no ESLint configured)
npm run preview    # Preview production build
npm run clean      # Remove dist/
```

The dev server proxies `/v1/api/hr` and `/uploads` to `http://localhost:3050` (the backend must be running separately).

## Architecture

**Stack:** React 19 + TypeScript + Vite 6 + Tailwind CSS v4 + `motion/react` (NOT framer-motion) + React Router DOM v7.

**Dual navigation pattern in `src/App.tsx`:** The app has two co-existing nav systems — a legacy `activeView` state switch (`renderView()`) and a newer React Router `<Routes>` tree. Some routes reference components not yet implemented (pre-existing TS errors). New features should use the Router pattern.

**Auth:** `lib/auth.ts` reads/writes `sessionStorage` with key `current_user`. The `AppUser` type lives in `types/permissions.ts`. `lib/permissions.ts` + `lib/permissionKeys.ts` + `hooks/usePermission.ts` expose a `canNav()` function used in the sidebar to gate navigation items.

**Theming:** CSS custom properties on `:root` and `.dark` (toggled by adding the `.dark` class to the root element). All color tokens (`--bg`, `--surface`, `--accent`, `--text-primary`, etc.) are defined in `src/index.css`. Never hardcode colors — use these variables.

**Global utility classes** (defined in `src/index.css`):
- Layout/table: `.th`, `.td`, `.tr`, `.stat-card`
- Buttons: `.primary-btn`, `.secondary-btn`, `.success-btn`, `.action-btn`
- Form: `.label`, `.search-wrap`
- Badges: `.pill`, `.pill-success`, `.pill-accent`
- Typography: `.syne` (Syne display font), `.dm-sans` (DM Sans body font)
- Other: `.avatar`

## Shared UI Components (`src/components/ui/`)

These were extracted to eliminate repetition — always use them instead of re-implementing:

| Component | Purpose | Key Props |
|---|---|---|
| `PageHeader` | Page title + subtitle | `title`, `subtitle` |
| `TabBar` | Tab button row (string tabs only) | `tabs`, `activeTab`, `onChange` |
| `TableToolbar` | Search + action buttons + optional filter bar | `searchQuery`, `onSearchChange`, `actions`, `filterBar` |
| `TablePagination` | "Showing X of Y" + page buttons | `total`, `filtered` |
| `FormModal` | Modal wrapper with header + footer | `title`, `onClose`, `onSave`, `maxWidth`, `scrollable` |
| `FormField` | Label + field wrapper | `label`, `required`, `children` |
| `FileUpload` | Dashed upload zone | `onChange`, `currentFile`, `accept` |

Also exports `inputClass` and `labelClass` string constants from `FormField` for use directly on `<input>`/`<select>`/`<textarea>` elements.

## Shared Hooks (`src/hooks/`)

- **`useFormState<T>(initialState, initialData?)`** — controlled form state with a `handleChange` handler compatible with `<input>`, `<select>`, `<textarea>`. Uses `useRef` for initial state to avoid re-render loops when `initialState` is defined inline.
- **`useCrud<T>(initialItems)`** — add/edit/delete state machine. Returns `items`, `isFormOpen`, `isAlertOpen`, `selectedItem`, and handlers: `handleAddClick`, `handleEditClick`, `handleDeleteClick`, `handleSave`, `handleConfirmDelete`.
- **`usePermission(user)`** — returns `{ canNav(key) }` for permission-gated rendering.

## Conventions

- Animations use `motion/react` (`import { motion } from 'motion/react'`). Standard entry animations: `initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}`.
- Tab bars with icons or dropdown sub-menus (e.g., Employees, LeaveSetup) cannot use `TabBar` — keep custom tab sections in those components.
- Components with cross-tab CRUD (Document, Users) use a single unified state block and branch on `activeTab` in save/delete handlers rather than separate `useCrud` instances per tab.
- Tailwind v4 config: uses `@import "tailwindcss"` in CSS (not `tailwind.config.js`). Do not add a v3-style config file.
