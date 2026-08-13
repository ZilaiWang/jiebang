# TypeScript Generics: Code Lab

Welcome to your hands-on practice with TypeScript generics! This lab will help you understand when and how to use generics instead of `any`.

---

## Exercise 1: Convert `any` to Generics

**Goal:** Fix a function that loses type information by using `any`.

### Starter Code:
```typescript
// ❌ BAD: This function uses `any` - it accepts anything but returns `any`
function processData(input: any): any {
  return input;
}

// The problem: TypeScript doesn't know what type comes out!
const result = processData("hello");
// result is `any`, so this won't give you type errors even if it's wrong:
const upper: number = result.toUpperCase(); // No error, but wrong!
```

### Your Task:
1. Create a generic version of `processData` that preserves the input type
2. Make sure the return type matches the input type
3. Test it with a string and verify the type is correct

### Write Your Solution Here:
```typescript
// ✅ YOUR SOLUTION: Convert to a generic function
function processData<T>(input: T): T {
  return input;
}

// Test cases - uncomment and verify types
const stringResult = processData("hello");
const numberResult = processData(42);
const arrayResult = processData([1, 2, 3]);

// These should now be properly typed:
console.log(stringResult.toUpperCase()); // Works because T = string
console.log(numberResult.toFixed(2));    // Works because T = number
console.log(arrayResult.length);         // Works because T = number[]
```

### Key Learning:
- `<T>` is a type parameter (placeholder) that gets replaced with the actual type
- When you call `processData("hello")`, TypeScript infers `T = string`
- The return type is now `string`, not `any`

---

## Exercise 2: Build a Generic Identity Function

**Goal:** Create a function that returns exactly what it receives, with full type safety.

### Starter Code:
```typescript
// ❌ BAD: Using `any` defeats the purpose of TypeScript
function identityAny(input: any): any {
  return input;
}

// The returned value has type `any` - you lose all type checking
const val = identityAny(42);
val.nonExistentMethod(); // No error until runtime!
```

### Your Task:
1. Create a generic `identity` function that:
   - Accepts a parameter of type `T`
   - Returns the same value with type `T`
2. Create a function that takes two parameters of the same type and returns the first one

### Write Your Solution Here:
```typescript
// ✅ YOUR SOLUTION: Generic identity function
function identity<T>(input: T): T {
  return input;
}

// ✅ BONUS: Generic function with two same-type parameters
function getFirst<T>(first: T, second: T): T {
  return first;
}

// Test cases
const myString = identity("TypeScript");
const myNumber = identity(100);

// TypeScript knows these types!
console.log(myString.length);  // ✅ Works: myString is string
console.log(myNumber * 2);     // ✅ Works: myNumber is number

// getFirst example
const result = getFirst("hello", "world");
console.log(result.toUpperCase()); // ✅ Works: result is string
```

### Key Learning:
- Generic functions maintain type relationships between inputs and outputs
- TypeScript infers the type parameter from usage
- You get full autocompletion and type checking!

---

## Exercise 3: Generic Functions with Arrays

**Goal:** Create functions that work with arrays of any type while maintaining type safety.

### Starter Code:
```typescript
// ❌ BAD: These use `any` and lose type information
function getFirstElementAny(arr: any[]): any {
  return arr[0];
}

function containsItemAny(arr: any[], item: any): boolean {
  return arr.includes(item);
}

// No type safety - these will all "work" even when wrong:
const element = getFirstElementAny([1, 2, 3]);
const hasItem = containsItemAny(["a", "b"], 123); // Comparing string array with number!
```

### Your Task:
1. Create a generic `getFirstElement` function that:
   - Takes an array of type `T[]`
   - Returns an element of type `T` (or undefined if empty)
2. Create a generic `containsItem` function that:
   - Takes an array and an item of the same type
   - Returns a boolean

### Write Your Solution Here:
```typescript
// ✅ YOUR SOLUTION: Generic array functions
function getFirstElement<T>(arr: T[]): T | undefined {
  return arr[0];
}

function containsItem<T>(arr: T[], item: T): boolean {
  return arr.includes(item);
}

// Test cases
const numbers = [10, 20, 30];
const firstNum = getFirstElement(numbers);
console.log(firstNum?.toFixed(2)); // ✅ Works: firstNum is number | undefined

const names = ["Alice", "Bob", "Charlie"];
const firstName = getFirstElement(names);
console.log(firstName?.toUpperCase()); // ✅ Works: firstName is string | undefined

// containsItem - type safe!
console.log(containsItem(numbers, 42));     // ✅ Works: both are numbers
console.log(containsItem(names, "Alice"));  // ✅ Works: both are strings

// This would be a compile error (good!):
// containsItem(numbers, "not a number"); // ❌ Error: string is not assignable to number
```

### Key Learning:
- `T[]` means "array of T" where T can be any type
- Generic constraints let you write functions that work with multiple types
- TypeScript catches type mismatches at compile time

---

## Summary

| Pattern | Problem | Generic Solution |
|---------|---------|------------------|
| `any` parameter | Loses type info | Use `<T>` type parameter |
| `any` return type | Caller gets no type info | Return `T` (same as input) |
| `any[]` arrays | No element type checking | Use `T[]` for typed arrays |
| `any` comparisons | Unsafe comparisons | Same `<T>` for both params |

### Next Steps:
1. Practice with more complex generics (multiple type parameters)
2. Explore generic interfaces and classes
3. Learn about generic constraints (`<T extends SomeType>`)

---

**Exercise Complete!** You've learned how generics provide type safety without sacrificing flexibility.

[executed:code-lab]