# Generics in TypeScript: What They Are & Why You Need Them

## The Problem: You Want Reusable Code

Imagine you're writing a function that returns the first element of an array. You want to use it for numbers, strings, and objects — but you want TypeScript to **remember** what type it returned.

---

## The `any` Trap

### What `any` does

```typescript
function getFirst(arr: any[]): any {
  return arr[0];
}

const num = getFirst([1, 2, 3]);       // type: any
const str = getFirst(["a", "b", "c"]); // type: any
```

**Why `any` is bad:**

1. **You lose type safety.** TypeScript stops checking. No autocomplete. No error on typos.
2. **You lose meaning.** The function signature tells you nothing about what it returns.
3. **Bugs hide.** You can pass the result anywhere — even where it doesn't belong — and TypeScript won't warn you.

```typescript
const num = getFirst([1, 2, 3]);
num.toLowerCase(); // 💥 No error at compile time! Runs, then explodes at runtime.
//    ^^^^^^^^^^^^ is a number, but TypeScript doesn't know or care.
```

---

## The Generic Solution

### What is a generic?

A **generic** is a **type parameter** — a placeholder you give to a function, class, or interface so TypeScript can figure out the specific type **at call time**, without hardcoding it.

Think of it like a function argument, but for **types**.

```typescript
function getFirst<T>(arr: T[]): T {
  return arr[0];
}
```

| Part    | Meaning                                              |
|---------|------------------------------------------------------|
| `<T>`   | A type parameter named `T` (you pick the name)      |
| `T[]`   | "This is an array of whatever `T` turns out to be"   |
| `: T`   | "I return whatever `T` turns out to be"              |

### How TypeScript infers the type

You don't specify `T` yourself — TypeScript **infers** it from what you pass in:

```typescript
const num = getFirst([1, 2, 3]);       // T is inferred as number  → returns number
const str = getFirst(["a", "b", "c"]); // T is inferred as string  → returns string
const obj = getFirst([{ id: 1 }]);     // T is inferred as { id: number } → returns { id: number }
```

Now `num` is typed as `number`, `str` as `string`, `obj` as `{ id: number }`. Full autocomplete, full safety, no `any`.

---

## Side-by-Side Comparison

```typescript
// ❌ With `any` — no type safety
function identityAny(x: any): any {
  return x;
}
const a = identityAny("hello");
a.toUpperCase();  // works, but TypeScript has no idea `a` is a string
a.toFixed(2);     // NO error! This will blow up at runtime.

// ✅ With generics — full type safety
function identityGeneric<T>(x: T): T {
  return x;
}
const b = identityGeneric("hello");
b.toUpperCase();  // ✅ works, TypeScript knows `b` is a string
b.toFixed(2);     // ✅ ERROR at compile time — you're told before it runs
```

---

## When to Use Generics

Use generics when:

1. **A function/class works with many types, but you want to preserve the type.**
   - Utility functions: `first()`, `wrap()`, `clone()`
   - Data structures: `Stack<T>`, `Queue<T>`, `Result<T, E>`

2. **You're building reusable components** (React components, API clients, form handlers).

3. **You need type-safe relationships between parameters.**
   ```typescript
   function merge<T, U>(a: T, b: U): T & U {
     return { ...a, ...b };
   }
   // The return type knows about both `a` and `b`
   ```

4. **You want default types but allow overrides.**
   ```typescript
   interface ApiResponse<T = unknown> {
     data: T;
     status: number;
   }
   // ApiResponse       → data is `unknown`
   // ApiResponse<User> → data is `User`
   ```

---

## Key Takeaways

| Concept       | `any`                          | Generics (`<T>`)                  |
|---------------|--------------------------------|------------------------------------|
| Type safety   | ❌ None                        | ✅ Full                           |
| Autocomplete  | ❌ None                        | ✅ Yes                            |
| Error catching | ❌ Everything compiles         | ✅ Catches type bugs at compile   |
| Readability   | ❌ Tells you nothing           | ✅ Documents intent               |
| Use case      | Escape hatch (avoid)           | Default for reusable code          |

**Rule of thumb:** If you're about to type `any`, try a generic first.

---

[executed:concept-tutor]
