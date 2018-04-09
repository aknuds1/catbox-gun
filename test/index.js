'use strict';

const Catbox = require('catbox');
const Code = require('code');
const Hoek = require('hoek');
const Lab = require('lab');
const Tmp = require('tmp');

const Settings = require('../settings.json');
const CatboxGun = require('..');

const { describe, it, afterEach } = exports.lab = Lab.script();
const expect = Code.expect;

let databaseDir;

const createClient = () => {

    databaseDir = Tmp.dirSync({
        unsafeCleanup: true
    });
    return new Catbox.Client(new CatboxGun({
        grpcTlsCa: Buffer.from(Settings.GRPC_TLS_CA, 'base64').toString(),
        grpcTlsClientKey: Buffer.from(Settings.GRPC_TLS_CLIENT_KEY, 'base64').toString(),
        grpcTlsClientCert: Buffer.from(Settings.GRPC_TLS_CLIENT_CERT, 'base64').toString()
    }));
};

describe('CatboxGun', () => {

    afterEach(() => {

        if (databaseDir) {
            databaseDir.removeCallback();
        };
        databaseDir = null;
    });

    it('throws an error if not created with new', () => {

        const fn = () => CatboxGun();
        expect(fn).to.throw(Error);
    });

    it('creates a new connection', async () => {

        const client = createClient();
        await client.start();
        expect(client.isReady()).to.be.true();
    });

    it('closes the connection', async () => {

        const client = createClient();
        await client.start();
        expect(client.isReady()).to.be.true();
        await client.stop();
        expect(client.isReady()).to.be.false();
    });

    it('returns null when getting a non-existent item', async () => {

        const client = createClient();
        await client.start();
        const key = { id: 'x', segment: 'test' };

        const result = await client.get(key);
        expect(result).to.equal(null);
    });

    it('gets an item after setting it', async () => {

        const client = createClient();
        await client.start();
        const key = { id: 'x', segment: 'test' };
        await client.set(key, '123', 500);

        const result = await client.get(key);
        expect(result.item).to.equal('123');
    });

    it('ignored starting a connection twice chained', async () => {

        const client = createClient();
        await client.start();
        expect(client.isReady()).to.be.true();
        await client.start();
        expect(client.isReady()).to.be.true();
    });

    it('returns null on get when using null key', async () => {

        const client = createClient();
        await client.start();
        const result = await client.get(null);
        expect(result).to.equal(null);
    });

    it('returns not found on get when item expired', async () => {

        const client = createClient();
        await client.start();
        const key = { id: 'x', segment: 'test' };
        await client.set(key, 'x', 1);
        await Hoek.wait(2);

        const result = await client.get(key);
        expect(result).to.equal(null);
    });

    it('errors on set when using null key', async () => {

        const client = createClient();
        await client.start();
        await expect(client.set(null, {}, 1000)).to.reject();
    });

    it('errors on get when using invalid key', async () => {

        const client = createClient();
        await client.start();
        await expect(client.get({})).to.reject();
    });

    it('errors on set when using invalid key', async () => {

        const client = createClient();
        await client.start();
        await expect(client.set({}, {}, 1000)).to.reject();
    });

    it('ignores set when using non-positive ttl value', async () => {

        const client = createClient();
        await client.start();
        const key = { id: 'x', segment: 'test' };
        await expect(client.set(key, 'y', 0)).to.not.reject();
    });

    it('errors on get when stopped', () => {

        const client = createClient();
        client.stop();
        const key = { id: 'x', segment: 'test' };
        expect(client.connection.get(key)).to.reject();
    });

    it('errors on set when stopped', () => {

        const client = createClient();
        client.stop();
        const key = { id: 'x', segment: 'test' };
        expect(client.connection.set(key, 'y', 1)).to.reject();
    });

    it('errors on missing segment name', () => {

        const config = {
            expiresIn: 50000
        };

        const fn = () => {

            const client = createClient();
            const cache = new Catbox.Policy(config, client, '');    // eslint-disable-line no-unused-vars
        };

        expect(fn).to.throw(Error);
    });

    it('errors on bad segment name', () => {

        const config = {
            expiresIn: 50000
        };

        const fn = () => {

            const client = createClient();
            const cache = new Catbox.Policy(config, client, 'a\u0000b');    // eslint-disable-line no-unused-vars
        };

        expect(fn).to.throw(Error);
    });

    describe('drop()', () => {

        it('drops an existing item', async () => {

            const client = createClient();
            await client.start();
            const key = { id: 'x', segment: 'test' };
            await client.set(key, '123', 500);
            const result = await client.get(key);
            expect(result.item).to.equal('123');
            await client.drop(key);
        });

        it('drops an item from a missing segment', async () => {

            const client = createClient();
            await client.start();
            const key = { id: 'x', segment: 'test' };
            await client.drop(key);
        });

        it('drops a missing item', async () => {

            const client = createClient();
            await client.start();
            const key = { id: 'x', segment: 'test' };
            await client.set(key, '123', 500);
            const result = await client.get(key);
            expect(result.item).to.equal('123');
            await client.drop({ id: 'y', segment: 'test' });
        });

        it('errors on drop when using invalid key', async () => {

            const client = createClient();
            await client.start();
            await expect(client.drop({})).to.reject();
        });

        it('errors on drop when using null key', async () => {

            const client = createClient();
            await client.start();
            await expect(client.drop(null)).to.reject();
        });

        it('errors on drop when stopped', async () => {

            const client = createClient();
            const key = { id: 'x', segment: 'test' };
            await expect(client.drop(key)).to.reject();
        });

        it('errors when cache item dropped while stopped', async () => {

            const client = createClient();
            client.stop();
            await expect(client.drop('a')).to.reject();
        });
    });

    describe('validateSegmentName()', () => {

        it('errors when the name is empty', () => {

            const client = createClient();
            expect(() => client.validateSegmentName('')).to.throw('Empty string');
        });

        it('errors when the name has a null character', () => {

            const client = createClient();
            expect(() => client.validateSegmentName('\u0000test')).to.throw();
        });

        it('returns null when there are no errors', () => {

            const client = createClient();
            expect(() => client.validateSegmentName('valid')).to.not.throw();
        });
    });
});
