function hashSeed(text) {
    let hash = 2166136261 >>> 0;
    const input = String(text);
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    hash += hash << 13;
    hash ^= hash >>> 7;
    hash += hash << 3;
    hash ^= hash >>> 17;
    hash += hash << 5;
    return hash >>> 0 || 0x6d2b79f5;
}

export class SeededRandom {
    constructor(seed) {
        this.seed = String(seed);
        this.state = hashSeed(this.seed);
    }

    next() {
        let value = this.state += 0x6d2b79f5;
        value = Math.imul(value ^ value >>> 15, value | 1);
        value ^= value + Math.imul(value ^ value >>> 7, value | 61);
        const output = ((value ^ value >>> 14) >>> 0) / 4294967296;
        this.state >>>= 0;
        return output;
    }

    range(minimum, maximum) {
        return minimum + this.next() * (maximum - minimum);
    }

    integer(minimum, maximumExclusive) {
        return Math.floor(this.range(minimum, maximumExclusive));
    }

    chance(probability) {
        return this.next() < probability;
    }

    pick(items) {
        return items.length > 0 ? items[this.integer(0, items.length)] : undefined;
    }

    fork(label) {
        return new SeededRandom(`${this.seed}::${String(label)}`);
    }
}

export class RandomStreams {
    constructor(seed) {
        this.seed = String(seed);
        this.streams = new Map();
    }

    stream(name) {
        const key = String(name);
        if (!this.streams.has(key)) this.streams.set(key, new SeededRandom(`${this.seed}::${key}`));
        return this.streams.get(key);
    }

    random(name) {
        return this.stream(name).next();
    }
}

export function createRandomStreams(seed) {
    return new RandomStreams(seed);
}
