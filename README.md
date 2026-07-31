# smartive Utilities

A collection of general purpose utilities and helpers for web projects.

## Installation

```bash
npm install @smartive/utils
```

## Utilities

### `classNames`

Cleans and joins an array of class names (strings and numbers), filtering out undefined and boolean values.

```typescript
import { classNames } from '@smartive/utils';

const className = classNames('btn', isActive && 'btn-active', 42, undefined, 'btn-primary');
// Result: "btn btn-active 42 btn-primary"
```

### `getTelLink`

Converts a phone number into a `tel:` link by removing non-digit characters (except `+` for international numbers).

```typescript
import { getTelLink } from '@smartive/utils';

const link = getTelLink('+1 (555) 123-4567');
// Result: "tel:+15551234567"
```

## Migrating from `@smartive/datocms-utils`

This package was previously published as `@smartive/datocms-utils`. With `4.0.0` it was renamed to
`@smartive/utils` and all DatoCMS cache tag utilities were removed.

- `classNames` and `getTelLink` are unchanged — only the import specifier needs to be updated.
- The `cache-tags` entry points (`/cache-tags`, `/cache-tags/neon`, `/cache-tags/redis`, `/cache-tags/noop`)
  and the `CacheTag`, `CacheTagsProvider` and `CacheTagsInvalidateWebhook` types are gone. Stay on
  `@smartive/datocms-utils@3` if you still rely on them.

## License

MIT © [smartive AG](https://github.com/smartive)
