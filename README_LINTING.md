# Linting and Type Checking

This project includes comprehensive linting and type checking to ensure code quality before deployment.

## Available Commands

### Type Checking
```bash
# Check TypeScript types for both src and api directories
npm run type-check

# Check only src directory
npm run type-check:src

# Check only api directory (Vercel functions)
npm run type-check:api
```

### Linting
```bash
# Run ESLint on all TypeScript files
npm run lint

# Run ESLint and auto-fix issues
npm run lint:fix
```

### Formatting
```bash
# Format all TypeScript files with Prettier
npm run format

# Check if files are formatted correctly (CI/CD)
npm run format:check
```

### Comprehensive Check
```bash
# Run all checks: type-check + lint + format-check
npm run check
```

## Pre-Deployment Checklist

Before pushing to Vercel, run:

```bash
npm run check
```

This will:
1. ✅ Check TypeScript types (src + api)
2. ✅ Run ESLint
3. ✅ Verify Prettier formatting

## Vercel Build

The `vercel-build` script automatically runs type checking before building:

```json
"vercel-build": "npm run type-check && npm run build"
```

This ensures builds fail early if there are type errors.

## Git Hooks (Optional)

To automatically run checks before committing, you can set up git hooks:

```bash
# Install husky (if not already installed)
npm install --save-dev husky

# Add pre-commit hook
npx husky add .husky/pre-commit "npm run check"
```

## Configuration Files

- `tsconfig.json` - TypeScript config for src directory
- `tsconfig.api.json` - TypeScript config for api directory (Vercel functions)
- `.eslintrc.json` - ESLint configuration
- `.eslintignore` - Files to ignore during linting
- `.prettierrc` - Prettier formatting rules

## Common Issues

### Type Errors in API Files
If you see type errors in `api/` directory:
```bash
npm run type-check:api
```

### ESLint Errors
To auto-fix most ESLint issues:
```bash
npm run lint:fix
```

### Formatting Issues
To auto-format all files:
```bash
npm run format
```
