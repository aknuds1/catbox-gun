'use strict';

const Boom = require('boom');
const Hoek = require('hoek');
const Grpc = require('grpc');
const Promise = require('bluebird');
const TypedError = require('error/typed');
const Map = require('ramda/src/map');
const Pipe = require('ramda/src/pipe');
const Path = require('path');
const Keys = require('ramda/src/keys');
const IsEmpty = require('ramda/src/isEmpty');
const FromPairs = require('ramda/src/fromPairs');

const badRequestError = TypedError({
    type: 'badRequest',
    message: 'Bad request',
    statusCode: 400
});

const notFoundError = TypedError({
    type: 'notFound',
    message: 'Resource not found',
    statusCode: 404
});

const badImplementationError = TypedError({
    type: 'badImplementation',
    message: 'Internal error',
    statusCode: 500
});

const DEFAULTS = {
    partition: 'catbox',
    peers: null
};

const GRPC_CODE2ERROR_TYPE = {
    3: badRequestError,
    5: notFoundError
};

const proto = Grpc.load(Path.join(__dirname, '../protos/gunCachingService.proto'))
    .gunCachingService;

const createService = (settings) => {

    Hoek.assert(!!settings);
    const serviceUri = process.env.GUN_CACHING_SERVICE_URI || 'localhost:9000';
    const client = new proto.GunCachingService(serviceUri,
        Grpc.credentials.createSsl(
            Buffer.from(settings.grpcTlsCa), Buffer.from(settings.grpcTlsClientKey),
            Buffer.from(settings.grpcTlsClientCert)
        ));

    // XXX: This isn't documented anywhere, but it's the best I could find
    const methodNames = Keys(proto.GunCachingService.service);
    return Pipe(
        Map((name) => {

            return [name, async (message) => {

                const promisifiedMethod = Promise.promisify(client[name], { context: client });
                let attempts = 0;
                const INTERVAL = 1000;
                while (attempts < 3) {
                    try {
                        return await promisifiedMethod(message);
                    }
                    catch (error) {
                        if (error.code === Grpc.status.UNAVAILABLE) {
                            ++attempts;
                            await Promise.delay(INTERVAL);
                        }
                        else {
                            const errorType = GRPC_CODE2ERROR_TYPE[error.code] ||
                                badImplementationError;
                            const params = {
                                message: !!(error.details || '').trim() ? error.details :
                                    error.message
                            };
                            if (!!error.metadata) {
                                const data = error.metadata.getMap();
                                if (!IsEmpty(Keys(data))) {
                                    params.data = data;
                                }
                            }
                            const translatedError = errorType(params);
                            throw translatedError;
                        }
                    }
                }

                throw badImplementationError({
                    message: `Couldn't connect to GUN caching service`
                });
            }];
        }, ),
        FromPairs
    )(methodNames);
};

const generatePath = (settings, key) => {

    Hoek.assert(!!settings.partition);
    Hoek.assert(!!key.segment);
    Hoek.assert(!!key.id);
    return [settings.partition, key.segment, key.id];
};

exports = module.exports = class Connection {

    constructor(options) {

        Hoek.assert(this.constructor === Connection,
            'GUN cache client must be instantiated using new');
        this.settings = Hoek.applyToDefaults(DEFAULTS, options || {});
        Hoek.assert(typeof this.settings.grpcTlsCa === 'string');
        Hoek.assert(typeof this.settings.grpcTlsClientKey === 'string');
        Hoek.assert(typeof this.settings.grpcTlsClientCert === 'string');
        if (!this.settings.peers) {
            delete this.settings.peers;
        }
        else {
            this.settings.peers = this.settings.peers.reduce((peers, peer) => {

                peers[peer] = null;
                return peers;
            }, {});
        }
        this.service = null;
    }

    start() {

        const self = this;
        if (!self.service) {
            self.service = createService(self.settings);
        }
    }

    stop() {

        this.service = null;
    }

    isReady() {

        return !!this.service;
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

        if (!self.service) {
            throw new Boom('Connection not started');
        }

        const { partition } = self.settings;
        Hoek.assert(!!partition);
        const path = generatePath(self.settings, key);
        const result = await self.service.getEntry({ path });
        result.ttl = Number(result.ttl);
        result.stored = Number(result.stored);
        return result;
    }

    async set(key, item, ttl) {

        const self = this;
        Hoek.assert(!!key.segment);
        Hoek.assert(!!key.id);
        Hoek.assert(!!item);
        Hoek.assert(!!ttl);

        if (!self.service) {
            throw new Boom('Connection not started');
        }

        const path = generatePath(self.settings, key);
        await self.service.setEntry({ path, item, ttl });
    }

    async drop(key) {

        const self = this;
        if (!self.service) {
            throw new Boom('Connection not started');
        }

        const path = generatePath(self.settings, key);
        await self.service.deleteEntry({ path });
    }
};
