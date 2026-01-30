---
inclusion: fileMatch
fileMatchPattern: ['frontend/**/*.tsx', 'frontend/**/*.ts', 'frontend/**/*.css']
---

# WP-AutoHealer Frontend Design System

## Critical Rules for AI Assistants

### 1. Styling Architecture (MANDATORY)
**ALWAYS inspect existing code patterns first** - Check the current component/page before making styling decisions.

**Hybrid Approach**: Use design tokens for semantic colors, Tailwind utilities for layout/spacing/structure.

#### Design Tokens (Semantic Colors Only)
```tsx
// Primary system colors
bg-background, text-foreground           // Main app background/text
bg-muted, text-muted-foreground         // Subtle backgrounds/secondary text
bg-primary, text-primary-foreground     // Brand colors, CTAs
bg-secondary, text-secondary-foreground // Secondary actions
bg-card, text-card-foreground           // Card containers
border-border                           // Standard borders

// Status colors
bg-destructive, text-destructive-foreground  // Errors, critical states
bg-success, text-success-foreground          // Success confirmations
bg-warning, text-warning-foreground          // Warnings, cautions
```

#### Tailwind Utilities (Layout & Structure)
```tsx
// Layout patterns
"p-6 space-y-4 grid grid-cols-1 md:grid-cols-2"
"flex items-center justify-between gap-4"
"w-full max-w-4xl mx-auto"

// Legacy gray scale (match existing code)
"bg-white text-gray-900 border-gray-200"
"bg-gray-50 text-gray-700 border-gray-300"
```

### 2. Component Architecture Standards
- **Location**: `frontend/src/components/{feature}/`
- **Pattern**: React functional components with TypeScript
- **Naming**: PascalCase components, kebab-case files
- **Structure**: Feature-based organization (incidents/, servers/, sites/, users/)
- **Required**: TypeScript interfaces for all props

### 3. Essential UI Component Patterns

#### Buttons (Copy Existing Patterns)
```tsx
// Primary (most common existing pattern)
"inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"

// Secondary (existing pattern)
"inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"

// Design token alternative (new components only)
"bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md transition-colors"
```

#### Cards (Match Existing)
```tsx
// Standard card (most common)
"bg-white overflow-hidden shadow rounded-lg"

// With content padding
"bg-white shadow overflow-hidden sm:rounded-md p-6"

// Design token version
"bg-card border border-border rounded-lg p-6 shadow-sm"
```

#### Form Controls
```tsx
// Input field
"block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"

// Error state
"border-red-300 focus:ring-red-500 focus:border-red-500"
```

### 4. Icon System (STRICT REQUIREMENT)
**ONLY use Heroicons** - No other icon libraries allowed.

```tsx
// Import pattern
import { IconName } from '@heroicons/react/24/outline';
import { IconName } from '@heroicons/react/24/solid';

// Standard sizes
h-4 w-4  // Small (16px)
h-5 w-5  // Medium (20px) - most common
h-6 w-6  // Large (24px)
h-8 w-8  // Extra large (32px)

// Default styling
<ShieldCheckIcon className="h-5 w-5 text-muted-foreground" />
```

### 5. Typography Hierarchy
```tsx
// Page titles
"text-3xl font-extrabold text-foreground"

// Section headers  
"text-2xl font-bold text-foreground"

// Subsection headers
"text-lg font-medium text-foreground"

// Body text
"text-sm text-foreground"

// Secondary/helper text
"text-xs text-muted-foreground"
```

### 6. Layout Patterns

#### Standard Page Structure
```tsx
<DashboardLayout>
  <div className="space-y-6">
    {/* Page header */}
    <div className="flex justify-between items-center">
      <h1 className="text-2xl font-bold text-foreground">Title</h1>
      <div className="flex gap-2">{/* Actions */}</div>
    </div>
    
    {/* Main content */}
    <div className="bg-card border border-border rounded-lg p-6 shadow-sm">
      {/* Content */}
    </div>
  </div>
</DashboardLayout>
```

#### Responsive Grid Patterns
```tsx
// Mobile-first responsive
"grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"

// Breakpoints: sm(640px), md(768px), lg(1024px), xl(1280px)
```

### 7. WP-AutoHealer Status System
**Copy these exact patterns for consistency:**

```tsx
// Incident status badges
const incidentStatus = {
  open: "bg-destructive/10 text-destructive border-destructive/20",
  investigating: "bg-warning/10 text-warning border-warning/20", 
  resolved: "bg-success/10 text-success border-success/20",
  closed: "bg-muted text-muted-foreground border-border"
};

// Server connection status
const serverStatus = {
  online: "bg-success/10 text-success",
  offline: "bg-destructive/10 text-destructive", 
  maintenance: "bg-warning/10 text-warning"
};

// Severity levels
const severity = {
  critical: "bg-destructive text-destructive-foreground",
  high: "bg-warning text-warning-foreground",
  medium: "bg-primary text-primary-foreground", 
  low: "bg-muted text-muted-foreground"
};
```

### 8. Interaction Standards
```tsx
// Transitions (use consistently)
"transition-colors duration-200"

// Loading states
"animate-spin"      // Spinners
"animate-pulse"     // Skeleton loading

// Hover effects
"hover:opacity-80"     // Subtle fade
"hover:bg-primary/90"  // Color variation
```

### 9. Accessibility Requirements (NON-NEGOTIABLE)
- **Focus rings**: All interactive elements need visible focus states
- **ARIA labels**: Required for icon-only buttons and complex UI
- **Semantic HTML**: Proper headings, form labels, button elements
- **Color contrast**: Design tokens ensure 4.5:1 minimum ratio

### 10. Component State Patterns
```tsx
// Loading state
{isLoading && <div className="animate-pulse">Loading...</div>}

// Error state  
{error && (
  <div className="bg-destructive/10 text-destructive p-4 rounded-md">
    {error.message}
  </div>
)}

// Empty state
{items.length === 0 && (
  <div className="text-center py-8 text-muted-foreground">
    No items found
  </div>
)}

// Success confirmation
{success && (
  <div className="bg-success/10 text-success p-4 rounded-md">
    Operation completed successfully
  </div>
)}
```

## Domain-Specific UI Patterns

### Incident Management
```tsx
// Timeline entries
"border-l-2 border-muted pl-4 pb-4 last:pb-0"

// Status badges (use exact patterns from section 7)
"inline-flex items-center px-2 py-1 rounded-full text-xs font-medium"
```

### Server Management  
```tsx
// Connection indicators
"inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs font-medium"

// SSH command output
"bg-muted rounded-md p-3 font-mono text-xs overflow-x-auto whitespace-pre-wrap"
```

### WordPress Site Health
```tsx
// Health status indicators
"flex items-center gap-2 text-sm"

// Version/plugin badges
"inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-secondary text-secondary-foreground"
```

## Implementation Rules for AI Assistants

### ALWAYS DO
- ✅ **Inspect existing code first** - Match patterns in the same component/page
- ✅ Use Tailwind for layout, spacing, responsive design
- ✅ Use design tokens for semantic colors (primary, success, destructive, etc.)
- ✅ Import icons from Heroicons only
- ✅ Include TypeScript interfaces for all component props
- ✅ Add proper accessibility attributes (ARIA labels, focus states)
- ✅ Follow mobile-first responsive design principles

### NEVER DO
- ❌ Use inline styles or CSS-in-JS
- ❌ Create arbitrary Tailwind values without justification
- ❌ Skip TypeScript interfaces
- ❌ Ignore accessibility requirements
- ❌ Import icons from non-Heroicons libraries
- ❌ Force design tokens where existing code uses Tailwind utilities
- ❌ Create components without proper error/loading/empty states

### Decision Framework
1. **Check existing code** - What patterns are already used?
2. **Match the context** - New component or updating existing?
3. **Choose styling approach** - Design tokens for colors, Tailwind for structure
4. **Verify accessibility** - Focus states, ARIA labels, semantic HTML
5. **Test responsiveness** - Mobile-first breakpoints