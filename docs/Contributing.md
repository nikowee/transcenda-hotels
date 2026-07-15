# 🤝 Contributing to Transcenda Hotels

Thank you for your interest in contributing to Transcenda Hotels! This guide outlines our development conventions and pull request process.

---

## 🌿 Branch Naming Conventions

Use descriptive, hyphenated branch names with a type prefix and forward-slash separator:

| Prefix | When to Use | Example |
|--------|-------------|---------|
| `feature/` | New functionality | `feature/booking-calendar` |
| `fix/` | Bug fixes | `fix/stripe-webhook-500` |
| `chore/` | Maintenance tasks | `chore/update-dependencies` |
| `refactor/` | Code restructuring | `refactor/api-middleware` |
| `docs/` | Documentation changes | `docs/add-troubleshooting-guide` |
| `test/` | Adding or updating tests | `test/booking-api` |
| `style/` | Formatting, styling changes | `style/tailwind-config` |

### Rules

- ✅ Use lowercase letters and hyphens: `feature/add-payment-form`
- ✅ Keep it descriptive but concise (under 50 characters)
- ❌ Don't use special characters: `feature/adding^payment`
- ❌ Don't use past tense: `fix/fixed-cors` ❌ → `fix/cors-headers` ✅

---

## 💬 Commit Message Format

We follow **Conventional Commits** with a strict format:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

| Type | Description |
|------|-------------|
| `feat` | A new feature |
| `fix` | A bug fix |
| `chore` | Maintenance, tooling, dependencies |
| `docs` | Documentation only changes |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test` | Adding or updating tests |
| `style` | Formatting, missing semicolons, etc. (not CSS) |

### Scope (Optional)

The part of the codebase affected:

- `frontend` — React/Vite/Tailwind changes
- `backend` — Express/API changes
- `docker` — Dockerfile or compose changes
- `deps` — Dependency updates

### Examples

```
feat(backend): add Stripe payment intent endpoint

Implement POST /api/payments/create-intent that creates a
Stripe PaymentIntent and returns the client secret.

Closes #42
```

```
fix(frontend): resolve CORS error on booking creation

Axios was sending requests without credentials. Added
withCredentials: true to the axios instance config.
```

```
chore(deps): bump axios to 1.18.1
```

```
docs: add environment variables guide to wiki
```

### Rules

- ✅ **Use imperative mood:** "add" not "added" or "adds"
- ✅ **Capitalize the description:** "fix: Resolve..." not "fix: resolve..."
- ✅ **Keep the first line under 72 characters**
- ✅ **Use the body** to explain what and why, not how
- ❌ Don't end the subject line with a period

---

## 📐 Code Style Guidelines

### TypeScript

- **Always use types.** Avoid `any` unless absolutely necessary.
- **Prefer `interface` over `type`** for object shapes (use `type` for unions/intersections).
- **Async/await over raw promises.** Use try/catch for error handling.
- **ESM imports only.** Both frontend and backend use `"type": "module"`.

```typescript
// ✅ Good
interface Booking {
  id: string;
  hotelId: string;
  checkIn: Date;
  checkOut: Date;
}

async function createBooking(data: Booking): Promise<void> {
  try {
    const response = await axios.post('/api/bookings', data);
    // ...
  } catch (error) {
    console.error('Failed to create booking:', error);
    throw error;
  }
}

// ❌ Avoid
const createBooking = async (data: any) => {
  return await axios.post('/api/bookings', data);
};
```

### React

- **Functional components only.** No class components.
- **Custom hooks** for reusable logic.
- **Co-locate styles** using Tailwind utility classes.
- **Destructure props** at the component definition.

```tsx
// ✅ Good
interface HotelCardProps {
  name: string;
  location: string;
  price: number;
}

export function HotelCard({ name, location, price }: HotelCardProps) {
  return (
    <div className="rounded-lg border p-4 shadow-sm">
      <h3 className="text-lg font-semibold">{name}</h3>
      <p className="text-gray-600">{location}</p>
      <p className="text-primary font-bold">${price}/night</p>
    </div>
  );
}
```

### Naming Conventions

| Item | Convention | Example |
|------|-----------|---------|
| **Files** | `kebab-case` | `hotel-card.tsx`, `api-client.ts` |
| **Components** | `PascalCase` | `HotelCard`, `BookingForm` |
| **Functions** | `camelCase` | `createBooking`, `handleSubmit` |
| **Variables** | `camelCase` | `hotelName`, `bookingData` |
| **Constants** | `UPPER_SNAKE_CASE` | `API_BASE_URL`, `MAX_GUESTS` |
| **Types/Interfaces** | `PascalCase` | `Booking`, `HotelCardProps` |
| **Directories** | `kebab-case` | `booking-form/`, `api/` |

### Imports Order

```
1. External libraries (react, axios, etc.)
2. Internal modules (@/components, @/utils)
3. Types/interfaces
4. Constants
5. Styles (CSS)
```

```typescript
// ✅ Good
import { useState, useEffect } from 'react';
import axios from 'axios';
import { HotelCard } from '@/components/HotelCard';
import { formatPrice } from '@/utils/format';
import type { Booking } from '@/types';
import { API_BASE_URL } from '@/constants';
```

---

## 🔄 Pull Request Process

### Step-by-Step

1. **Create a feature branch** from `main`
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** with clear, atomic commits
   ```bash
   git add .
   git commit -m "feat: add booking confirmation page"
   ```

3. **Keep your branch up to date**
   ```bash
   git fetch origin
   git rebase origin/main
   ```

4. **Run type-check and lint**
   ```bash
   # Backend
   cd server && npm run type-check

   # Frontend
   cd client && npm run lint
   ```

5. **Push your branch**
   ```bash
   git push origin feature/your-feature-name
   ```

6. **Open a Pull Request**
   - Title: Follow conventional commit format
   - Description: Explain what and why
   - Link any related issues: `Closes #42`
   - Add screenshots for UI changes

7. **Request a review**
   - At least one approval required
   - Address all feedback
   - Resolve any merge conflicts

8. **Merge**
   - Squash-merge into `main`
   - Delete the feature branch

### PR Template

```markdown
## Description
[Brief description of the changes]

## Type of Change
- [ ] feat: New feature
- [ ] fix: Bug fix
- [ ] refactor: Code restructuring
- [ ] docs: Documentation
- [ ] chore: Maintenance

## Testing
- [ ] Type-check passes (`npm run type-check`)
- [ ] Lint passes (`npm run lint`)
- [ ] Frontend tests pass (`cd client && npm run test`)
- [ ] Backend tests pass (`cd server && npm run test`)
- [ ] E2E tests pass (`cd e2e_testing && npx playwright test`)
- [ ] Tested in Docker

## Related Issues
Closes #[issue-number]
```

---

## ✅ Checklist Before Submitting

- [ ] Code follows the style guidelines
- [ ] Branch name follows conventions
- [ ] Commits follow conventional commit format
- [ ] Type-check passes (`npm run type-check`)
- [ ] Lint passes (`npm run lint`)
- [ ] Frontend tests pass (`cd client && npm run test`)
- [ ] Backend tests pass (`cd server && npm run test`)
- [ ] E2E tests pass (`cd e2e_testing && npx playwright test`)
- [ ] Tested with `docker compose up --build`
- [ ] PR description is complete

---

> 💡 **First time contributor?** Start with a `good-first-issue` or `docs` label issue. We welcome all contributions!
