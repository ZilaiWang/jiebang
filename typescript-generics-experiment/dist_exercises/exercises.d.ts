declare function first<T>(arr: T[]): T | undefined;
declare const testArray1: number[];
declare const testArray2: string[];
declare const result1: number | undefined;
declare const result2: string | undefined;
declare function pair<T, U>(a: T, b: U): [T, U];
declare const myPair1: [string, number];
declare const myPair2: [number, boolean];
interface KeyValueStore<K, V> {
    key: K;
    value: V;
}
declare const stringNumberStore: KeyValueStore<string, number>;
declare class GenericStack<T> {
    private items;
    push(item: T): void;
    pop(): T | undefined;
    peek(): T | undefined;
    isEmpty(): boolean;
}
declare const numStack: GenericStack<number>;
interface HasLength {
    length: number;
}
declare function logLength<T extends HasLength>(value: T): void;
declare function wrap<T>(value: T): {
    value: T;
    timestamp: number;
};
declare const wrapped: {
    value: string;
    timestamp: number;
};
declare function reduce<T, U>(arr: T[], reducer: (accumulator: U, current: T) => U, initialValue: U): U;
declare const numbers: number[];
declare const sum: number;
declare const words: string[];
declare const sentence: string;
