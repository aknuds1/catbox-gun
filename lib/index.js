'use strict';

const Boom = require('boom');
const Hoek = require('hoek');
const Gun = require('gun');
require('gun/lib/later');

const DEFAULTS = {
    partition: 'catbox'
};

const createEnvelope = (key, value, ttl) => {

    return {
        item: value,
        stored: Date.now(),
        ttl
    };
};

exports = module.exports = class Connection {

    constructor(options) {

        Hoek.assert(this.constructor === Connection,
            'GUN cache client must be instantiated using new');
        this.settings = Hoek.applyToDefaults(DEFAULTS, options || {});
        this.gun = null;
    }

    start() {

        if (!this.gun) {
            this.gun = Gun({ localStorage: false, file: this.settings.file });
        }
    }

    stop() {

        this.gun = null;
    }

    isReady() {

        return !!this.gun;
    }

    validateSegmentName(name) {

        if (!name) {
            throw new Boom('Empty string');
        }

        if (name.indexOf('\u0000') !== -1) {
            throw new Boom('Includes null character');
        }

        return null;
    }

    async get(key) {

        const self = this;
        Hoek.assert(!!key.segment);
        Hoek.assert(!!key.id);

        if (!self.gun) {
            throw new Boom('Connection not started');
        }

        const { partition } = self.settings;
        Hoek.assert(!!partition);
        const id = self.generateKey(key);
        const envelope = await new Promise((resolve) => {

            self.gun.get(partition).get(id).once(resolve);
        });
        if (!envelope) {
            return null;
        }

        return {
            item: envelope.item,
            stored: envelope.stored,
            ttl: envelope.ttl
        };
    }

    async set(key, value, ttl) {

        const self = this;
        Hoek.assert(!!key.segment);
        Hoek.assert(!!key.id);

        if (!self.gun) {
            throw new Boom('Connection not started');
        }

        const envelope = createEnvelope(key, value, ttl);
        Hoek.assert(!!envelope);

        await new Promise((resolve) => {

            const { partition } = self.settings;
            Hoek.assert(!!partition);
            const gunKey = self.generateKey(key);
            self.gun.get(partition).get(gunKey).put(envelope, () => {

                resolve();
            }).later((data, k) => {

                self.gun.get(partition).get(k).put(null);
            }, ttl / 1000);
        });
    }

    drop(key) {

        const self = this;
        if (!self.gun) {
            throw new Boom('Connection not started');
        }

        const { partition } = self.settings;
        Hoek.assert(!!partition);
        self.gun.get(partition).get(self.generateKey(key)).put(null);
    }

    generateKey(key) {

        Hoek.assert(!!key.segment);
        Hoek.assert(!!key.id);
        return [key.segment, key.id].join('/');
    };
};
