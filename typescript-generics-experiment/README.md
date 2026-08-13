# TypeScript Generics Experiment

## Learning Objectives
By the end of this experiment, you will:
1. Understand why `any` is problematic for type safety
2. Know how to use generics to preserve type information
3. Be able to write generic functions, interfaces, and classes
4. Apply generic constraints when needed

## How to Use

### Step 1: Read the Experiment
Open `experiment.ts` and read through each section. The code includes detailed comments explaining each concept.

### Step 2: Run the Experiment
```bash
npm install
npm run run:experiment
```

This will compile and run the TypeScript code, showing you the output.

### Step 3: Complete the Exercises
Open `exercises.ts` and complete each exercise. The exercises include:
1. Fix a function (convert `any` to generics)
2. Create a generic pair function
3. Generic interface for key-value store
4. Generic class (Stack implementation)
5. Generic constraints
6. Generic utility (wrapper function)
7. Challenge: Generic reduce function

### Step 4: Type Check Your Solutions
```bash
npm run typecheck
```

This checks for type errors without running the code.

## Key Concepts Covered

| Concept | File | Lines |
|---------|------|-------|
| Problem with `any` | experiment.ts | 1-30 |
| Basic generics | experiment.ts | 32-55 |
| Array operations | experiment.ts | 57-80 |
| Generic constraints | experiment.ts | 82-100 |
| Multiple type params | experiment.ts | 102-125 |
| Generic interfaces/classes | experiment.ts | 127-165 |
| Real-world patterns | experiment.ts | 167-210 |

## Tips for JavaScript Developers

- Think of generics like **template literals** for types: `<T>` is a placeholder
- Generics are like **functions but for types**: they take types as arguments
- The `extends` keyword in generics is like **duck typing** but compile-time safe
- Generic classes are like **classes with type parameters** - similar to how JavaScript classes can have constructor parameters

## Common Patterns You'll See

```typescript
// Pattern 1: Identity function
function identity<T>(x: T): T { return x; }

// Pattern 2: Array element
function first<T>(arr: T[]): T | undefined { return arr[0]; }

// Pattern 3: Key-value pair
function pair<K, V>(key: K, value: V): [K, V] { return [key, value]; }

// Pattern 4: Constrained generic
function logLength<T extends { length: number }>(x: T): void {
    console.log(x.length);
}
```

## Troubleshooting

**Error: "Cannot find module 'typescript'"**
Run `npm install` to install dependencies.

**Error: Type errors in exercises**
Make sure you've uncommented the exercise code before trying to solve it.

**Want to test your solutions?**
Uncomment the solution at the bottom of each exercise and compare with your answer.

## Next Steps

After completing this experiment:
1. Try modifying the examples
2. Create your own generic functions
3. Explore TypeScript utility types (Partial, Required, Pick, etc.)
4. Look into generic interfaces for API responses
