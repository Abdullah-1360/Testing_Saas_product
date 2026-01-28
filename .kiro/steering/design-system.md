---
inclusion: fileMatch
fileMatchPattern: ['frontend/**/*.tsx', 'frontend/**/*.ts', 'frontend/**/*.css']
---

# WP-AutoHealer Frontend Design System

## CRITICAL RULES FOR AI ASSISTANTS

### 1. Design Token Usage (MANDATORY)
- **NEVER use hardcoded colors, spacing, or typography values**
- **ALWAYS reference CSS custom properties or Tailwind classes**
- **Location**: All design tokens are defined in `frontend/src/app/globals.css`

```css
/* Required CSS Custom Properties */
:root {
  --primary: #3b82f6;
  --primary-foreground: #ffffff;
  --secondary: #f1f5f9;
  --background: #ffffff;
  --foreground: #1e293b;
  --muted: #f8fafc;
  --border: #e2e8f0;
  --radius: 0.5rem;
}
```

### 2. Component Architecture Rules
- **File Location**: `frontend/src/components/`
- **Pattern**: React functional components with TypeScript
- **Naming**: PascalCase for components, kebab-case for files
- **Structure**: Feature-based organization (incidents/, servers/, sites/, users/)

### 3. Required Styling Patterns

#### Buttons (Use these exact patterns)
```tsx
// Primary button
className="bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md transition-colors duration-200"

// Secondary button  
className="bg-secondary text-foreground hover:bg-secondary/80 px-4 py-2 rounded-md transition-colors duration-200"

// Destructive button
className="bg-destructive text-destructive-foreground hover:bg-destructive/90 px-4 py-2 rounded-md transition-colors duration-200"
```

#### Cards (Use this exact pattern)
```tsx
className="bg-card border border-border rounded-lg p-6 shadow-sm"
```

#### Form Inputs (Use this exact pattern)
```tsx
// Default input
className="block w-full border border-border rounded-md px-3 py-2 focus:ring-2 focus:ring-primary focus:border-primary transition-colors duration-200"

// Error state
className="block w-full border border-destructive rounded-md px-3 py-2 focus:ring-2 focus:ring-destructive focus:border-destructive"

// Success state  
className="block w-full border border-success rounded-md px-3 py-2 focus:ring-2 focus:ring-success focus:border-success"
```

### 4. Icon System (MANDATORY)
- **Library**: Heroicons only (`@heroicons/react/24/outline` and `@heroicons/react/24/solid`)
- **Import Pattern**: `import { IconName } from '@heroicons/react/24/outline';`
- **Size Classes**: `h-4 w-4` (small), `h-5 w-5` (medium), `h-6 w-6` (large), `h-8 w-8` (xl)
- **Color**: Always use `text-muted-foreground` unless semantic color needed

```tsx
import { ShieldCheckIcon } from '@heroicons/react/24/outline';
<ShieldCheckIcon className="h-5 w-5 text-muted-foreground" />
```

### 5. Typography Scale (Use exact classes)
- **H1**: `text-3xl font-extrabold text-foreground`
- **H2**: `text-2xl font-bold text-foreground`  
- **H3**: `text-lg font-medium text-foreground`
- **Body**: `text-sm text-foreground`
- **Caption**: `text-xs text-muted-foreground`

### 6. Layout Patterns (Required Structure)

#### Page Layout (Use this exact pattern)
```tsx
<DashboardLayout>
  <div className="space-y-6">
    <div className="flex justify-between items-center">
      <h1 className="text-2xl font-bold text-foreground">Page Title</h1>
      <div className="flex gap-2">
        {/* Action buttons */}
      </div>
    </div>
    <div className="bg-card border border-border rounded-lg p-6 shadow-sm">
      {/* Content */}
    </div>
  </div>
</DashboardLayout>
```

#### Status Indicators (WP-AutoHealer specific)
```tsx
// Incident status badges
const statusStyles = {
  open: "bg-destructive/10 text-destructive border-destructive/20",
  investigating: "bg-warning/10 text-warning border-warning/20", 
  resolved: "bg-success/10 text-success border-success/20",
  closed: "bg-muted text-muted-foreground border-border"
};

// Server status indicators
const serverStatusStyles = {
  online: "bg-success/10 text-success",
  offline: "bg-destructive/10 text-destructive",
  maintenance: "bg-warning/10 text-warning"
};
```

### 7. Responsive Design Rules
- **Approach**: Mobile-first with Tailwind breakpoints
- **Breakpoints**: `sm:` (640px), `md:` (768px), `lg:` (1024px), `xl:` (1280px)
- **Grid**: Use `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` patterns
- **Spacing**: Adjust padding/margins with responsive classes

### 8. Animation Standards
- **Transitions**: Always use `transition-colors duration-200` for color changes
- **Loading**: Use `animate-spin` for spinners, `animate-pulse` for skeleton loading
- **Hover Effects**: Opacity changes (`hover:opacity-80`) or color variations (`hover:bg-primary/90`)

### 9. Accessibility Requirements (MANDATORY)
- **Focus States**: All interactive elements must have visible focus rings
- **ARIA Labels**: Required for icon-only buttons and complex interactions
- **Semantic HTML**: Use proper heading hierarchy, form labels, button elements
- **Color Contrast**: Minimum 4.5:1 ratio (handled by design tokens)

### 10. Component State Management
- **Loading States**: Show spinners or skeleton UI during async operations
- **Error States**: Use destructive colors and clear error messages
- **Empty States**: Provide helpful messaging and actions
- **Success States**: Use success colors for confirmations

## WP-AutoHealer Specific Patterns

### Incident Management UI
```tsx
// Incident timeline item
className="border-l-2 border-muted pl-4 pb-4 last:pb-0"

// Severity indicators
const severityStyles = {
  critical: "bg-destructive text-destructive-foreground",
  high: "bg-warning text-warning-foreground", 
  medium: "bg-primary text-primary-foreground",
  low: "bg-muted text-muted-foreground"
};
```

### Server Management UI
```tsx
// Server connection status
className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs font-medium"

// Command execution results
className="bg-muted rounded-md p-3 font-mono text-xs overflow-x-auto"
```

### Site Health Indicators
```tsx
// Health score visualization
className="flex items-center gap-2 text-sm"

// WordPress version badges
className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-secondary text-secondary-foreground"
```

## FORBIDDEN PRACTICES
- ❌ Never use inline styles
- ❌ Never use hardcoded hex colors
- ❌ Never use arbitrary Tailwind values without design tokens
- ❌ Never create components without TypeScript interfaces
- ❌ Never skip accessibility attributes
- ❌ Never use CSS modules or styled-components (Tailwind only)
- ❌ Never import icons from libraries other than Heroicons