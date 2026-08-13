"use strict";
// TypeScript Generics Exercises
// ============================
// Exercise 1: Fix the function
// ============================
// The function should return the same type as the input
// Currently it returns `any`, fix it using generics
function first(arr) {
    return arr[0];
}
// Test the function:
const testArray1 = [1, 2, 3];
const testArray2 = ["a", "b", "c"];
const result1 = first(testArray1); // Should be type: number
const result2 = first(testArray2); // Should be type: string
// Exercise 2: Create a generic function
// ============================
// Create a function that takes two arguments and returns them as a tuple
// The types should be preserved
function pair(a, b) {
    return [a, b];
}
// Test:
const myPair1 = pair("hello", 42); // type: [string, number]
const myPair2 = pair(1, true); // type: [number, boolean]
// Test:
const stringNumberStore = {
    key: "age",
    value: 25
};
// Exercise 4: Generic class
// ============================
// Create a generic Stack class
class GenericStack {
    constructor() {
        this.items = [];
    }
    push(item) {
        this.items.push(item);
    }
    pop() {
        return this.items.pop();
    }
    peek() {
        return this.items[this.items.length - 1];
    }
    isEmpty() {
        return this.items.length === 0;
    }
}
// Test:
const numStack = new GenericStack();
numStack.push(1);
numStack.push(2);
console.log(numStack.pop()); // 2
function logLength(value) {
    console.log(`Length: ${value.length}`);
}
// Test:
logLength("hello"); // ✅ string has length
logLength([1, 2, 3]); // ✅ array has length
logLength({ length: 10 }); // ✅ object with length property
// Exercise 6: Generic utility
// ============================
// Create a generic function that wraps a value in an object with metadata
function wrap(value) {
    return {
        value,
        timestamp: Date.now()
    };
}
// Test:
const wrapped = wrap("hello");
console.log(wrapped.value.toUpperCase()); // ✅ Works - TypeScript knows it's a string
// Exercise 7: Challenge - Generic reducer
// ============================
// Create a generic reduce function
function reduce(arr, reducer, initialValue) {
    let accumulator = initialValue;
    for (const item of arr) {
        accumulator = reducer(accumulator, item);
    }
    return accumulator;
}
// Test:
const numbers = [1, 2, 3, 4, 5];
const sum = reduce(numbers, (acc, curr) => acc + curr, 0);
console.log(sum); // 15
const words = ["hello", " ", "world"];
const sentence = reduce(words, (acc, curr) => acc + curr, "");
console.log(sentence); // "hello world"
// =====================================
// All exercises are now complete!
// =====================================
console.log("\n=== All exercises completed! ===");
//# sourceMappingURL=exercises.js.map