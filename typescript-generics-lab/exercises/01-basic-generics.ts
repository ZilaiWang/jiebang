/**
 * Exercise 1: Basic Generic Functions
 * 
 * Learning goals:
 * - Understand what generics are and why they're useful
 * - Write your first generic function
 * - See how generics preserve type information
 */

// ❌ WITHOUT generics - loses type information
function identityAny(value: any): any {
  return value;
}

const result1 = identityAny("hello"); // type is `any` - not helpful!

// ✅ WITH generics - preserves type information
function identity<T>(value: T): T {
  return value;
}

// Your tasks:
// 1. Uncomment and verify the type is `string`, not `any`
// const result2 = identity("hello");

// 2. Create a generic function called `first<T>` that takes an array `T[]` 
//    and returns the first element `T | undefined`
function first<T>(items: T[]): T | undefined {
  // Your implementation here
  throw new Error("Not implemented");
}

// 3. Create a generic function called `wrap<T>` that takes a value `T`
//    and returns an object `{ value: T, timestamp: number }`
function wrap<T>(value: T): { value: T; timestamp: number } {
  // Your implementation here
  throw new Error("Not implemented");
}

// Tests (uncomment to verify your implementation)
// console.log(first([1, 2, 3]));           // should be 1
// console.log(first([]));                  // should be undefined
// console.log(wrap("hello"));              // should have value: "hello", timestamp: number
