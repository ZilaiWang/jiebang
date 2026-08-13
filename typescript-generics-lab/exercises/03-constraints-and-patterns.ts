/**
 * Exercise 3: Type Constraints & Common Patterns
 * 
 * Learning goals:
 * - Use `extends` to constrain generic types
 * - Understand keyof and mapped types with generics
 * - Apply real-world generic patterns
 */

// ❌ Without constraints - can't access properties safely
function getPropertyBad(obj: any, key: string) {
  return obj[key]; // no type safety!
}

// ✅ With constraints - type-safe property access
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}

// Your tasks:

// 1. Create a generic function called `firstMatching<T>` that:
//    - Takes an array of T and a predicate function (item: T) => boolean
//    - Returns the first matching item or undefined
//    - Constraint: T must be an object (use object type)
function firstMatching<T extends object>(
  items: T[],
  predicate: (item: T) => boolean
): T | undefined {
  // Your implementation here
  throw new Error("Not implemented");
}

// 2. Create a generic utility type called `Pick<T, K extends keyof T>`
//    (recreate TypeScript's built-in Pick)
//    It should create a type with only the specified keys from T
type MyPick<T, K extends keyof T> = 
  // Your implementation here
  never;

// 3. Create a generic function called `groupBy<T, K extends string>` that:
//    - Takes an array of T and a keyExtractor function (item: T) => K
//    - Returns an object where keys are K and values are T[]
function groupBy<T, K extends string>(
  items: T[],
  keyExtractor: (item: T) => K
): Record<K, T[]> {
  // Your implementation here
  throw new Error("Not implemented");
}

// Tests (uncomment to verify your implementation)
// const people = [
//   { name: "Alice", age: 30 },
//   { name: "Bob", age: 25 },
//   { name: "Carol", age: 30 },
// ];
// 
// const firstAdult = firstMatching(people, p => p.age >= 18);
// console.log(firstAdult); // { name: "Alice", age: 30 }
// 
// type PersonName = MyPick<{ name: string; age: number; email: string }, "name" | "email">;
// // should be { name: string; email: string }
// 
// const grouped = groupBy(people, p => String(p.age));
// console.log(grouped); // { "30": [...], "25": [...] }
