// ============================================================
// CODE LAB: TypeScript Generics
// For JavaScript developers learning TypeScript
// ============================================================

// ============================================================
// EXERCISE 1: Convert an any-typed function to a generic
// ============================================================
// 
// This function currently uses `any` - it works but loses type safety.
// Your job: rewrite it to use a generic type parameter.
//
// STARTER CODE:

function getValueAny(obj: any, key: string): any {
  return obj[key];
}

// SOLUTION:
function getValueGeneric<T>(obj: T, key: keyof T): T[keyof T] {
  return obj[key];
}

// TEST IT:
interface User {
  name: string;
  age: number;
  email: string;
}

const user: User = { name: "Alice", age: 30, email: "alice@example.com" };

const anyName = getValueAny(user, "name");    // type: any ❌
const genericName = getValueGeneric(user, "name"); // type: string ✅

console.log("--- Exercise 1 ---");
console.log("anyName type is lost:", anyName);
console.log("genericName keeps type:", genericName);

// TRY IT YOURSELF:
// 1. Uncomment the line below and hover over `anyResult` - what type is it?
//    const anyResult = getValueAny(user, "name");

// 2. Uncomment the line below and hover over `genericResult` - what type is it?
//    const genericResult = getValueGeneric(user, "name");

// 3. What happens if you try: getValueGeneric(user, "nonexistent")?
//    (TypeScript should give an error - that's the power of generics!)


// ============================================================
// EXERCISE 2: Write a generic identity function
// ============================================================
//
// An identity function returns its argument unchanged.
// Write a generic version that preserves the input type.
//
// STARTER CODE:

// Write a generic identity function here:
// function identity(???) {
//   return ???;
// }

// SOLUTION:
function identity<T>(value: T): T {
  return value;
}

// TEST IT:
console.log("\n--- Exercise 2 ---");

const num = identity(42);           // should be: number
const str = identity("hello");      // should be: string
const bool = identity(true);        // should be: boolean
const arr = identity([1, 2, 3]);    // should be: number[]

console.log("identity(42):", num, "type:", typeof num);
console.log('identity("hello"):', str, "type:", typeof str);
console.log("identity(true):", bool, "type:", typeof bool);
console.log("identity([1,2,3]):", arr, "type:", typeof arr);

// TRY IT YOURSELF:
// 1. What happens if you remove the generic and use `any`?
//    function identityAny(value: any): any { return value; }
//    Hover over `identityAny(42)` - what type do you get?

// 2. Can you call identity() with no arguments? Why or why not?

// 3. What is the type of identity({ a: 1, b: "two" })?


// ============================================================
// EXERCISE 3: Generic function with arrays
// ============================================================
//
// Write a generic function that finds the first element in an array
// that matches a predicate function.
//
// STARTER CODE:

// function findFirst(array: ???, predicate: ???): ??? {
//   ???
// }

// HINT: The function should work for any array type!
//       findFirst([1, 2, 3], x => x > 2) should return 3
//       findFirst(["a", "b", "c"], x => x === "b") should return "b"

// SOLUTION:
function findFirst<T>(array: T[], predicate: (item: T) => boolean): T | undefined {
  for (const item of array) {
    if (predicate(item)) {
      return item;
    }
  }
  return undefined;
}

// TEST IT:
console.log("\n--- Exercise 3 ---");

const numbers = [1, 2, 3, 4, 5];
const fruits = ["apple", "banana", "cherry", "date"];

const firstEven = findFirst(numbers, x => x % 2 === 0);
console.log("First even number:", firstEven);  // should be: 2

const longFruit = findFirst(fruits, f => f.length > 5);
console.log("First long fruit:", longFruit);   // should be: "banana"

const noMatch = findFirst(numbers, x => x > 100);
console.log("No match:", noMatch);             // should be: undefined

// TRY IT YOURSELF:
// 1. Uncomment the line below. Why does TypeScript give an error?
//    const bad = findFirst([1, 2, 3], x => x > "hello");

// 2. Write a second generic function `filterArray<T>` that returns
//    all matching elements (not just the first).
//    Type: filterArray<T>(array: T[], predicate: (item: T) => boolean): T[]

// 3. What's the difference between `T` and `T[]` in the parameter types?


// ============================================================
// KEY TAKEAWAYS
// ============================================================
//
// 1. Generics preserve type information through function calls
// 2. <T> is a type parameter - TypeScript infers it from usage
// 3. Generics are better than `any` because they maintain type safety
// 4. Generic functions work with any type while keeping types correct
// 5. You can constrain generics (e.g., T extends SomeType) for more safety
//
// ============================================================
// [executed:code-lab]
// ============================================================
