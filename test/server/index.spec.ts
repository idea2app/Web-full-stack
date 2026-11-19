import { describe, it } from 'node:test';
import { expect } from 'expect';
import { fn } from 'jest-mock';

describe('Example', () => {
    it('should say Hello', () => {
        expect('Hello, Jest!').toHaveLength(12);
    });

    it('supports Jest mock functions', () => {
        const callback = fn((value: string) => value.toUpperCase());

        expect(callback('hello')).toBe('HELLO');
        expect(callback).toHaveBeenCalledWith('hello');
    });
});
