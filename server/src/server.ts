process.env.DEBUG = "*INFO* *WARN* *ERROR*";
process.env.INTERACTIVE = "1";

import { AwaitQueue } from "awaitqueue";
import * as mediasoup from "mediasoup";
import express, { Express, NextFunction, Request, Response } from "express";
import { Worker, WorkerLogLevel, WorkerLogTag } from "mediasoup/node/lib/Worker";
import * as devcert from "devcert";
import https from "https";
import url from "url";
import protoo from "protoo-server";

import config from "./config";
import Logger from "./lib/Logger";
import Room from "./lib/Room";
import startInteractiveServer from "./lib/interactiveServer";
import startInteractiveClient from "./lib/interactiveClient";
import utils from "./lib/utils";

const logger = new Logger();
const queue = new AwaitQueue();
const rooms = new Map();

let httpsServer: https.Server;
let expressApp: Express;
let protooWebSocketServer;

const mediasoupWorkers: Worker[] = [];

// Index of next mediasoup Worker to use.
// @type {Number}
let nextMediasoupWorkerIdx = 0;

run();

async function run() {
    await startInteractiveServer();

    if (process.env.INTERACTIVE === "true" || process.env.INTERACTIVE === "1") {
        await startInteractiveClient();
    }

    await runMediasoupWorkers();
    await createExpressApp();
    await runHttpsServer();
    await runProtooWebSocketServer();

    // Log rooms status every X seconds.
    setInterval(() => {
        for (const room of rooms.values()) {
            room.logStatus();
        }
    }, 120000);
}

async function runMediasoupWorkers() {
    const { numWorkers } = config.mediasoup;

    logger.info("running %d mediasoup Workers...", numWorkers);

    for (let i = 0; i < numWorkers; ++i) {
        const worker = await mediasoup.createWorker({
            logLevel: config.mediasoup.workerSettings.logLevel as WorkerLogLevel | undefined,
            logTags: config.mediasoup.workerSettings.logTags as WorkerLogTag[] | undefined,
            rtcMinPort: Number(config.mediasoup.workerSettings.rtcMinPort),
            rtcMaxPort: Number(config.mediasoup.workerSettings.rtcMaxPort),
        });

        worker.on("died", () => {
            logger.error("mediasoup Worker died, exiting  in 2 seconds... [pid:%d]", worker.pid);

            setTimeout(() => process.exit(1), 2000);
        });

        mediasoupWorkers.push(worker);

        // Create a WebRtcServer in this Worker.
        if (process.env.MEDIASOUP_USE_WEBRTC_SERVER !== "false") {
            // Each mediasoup Worker will run its own WebRtcServer, so those cannot
            // share the same listening ports. Hence we increase the value in config.js
            // for each Worker.
            const webRtcServerOptions = utils.clone(config.mediasoup.webRtcServerOptions);
            const portIncrement = mediasoupWorkers.length - 1;

            for (const listenInfo of webRtcServerOptions.listenInfos) {
                listenInfo.port += portIncrement;
            }

            const webRtcServer = await worker.createWebRtcServer(webRtcServerOptions);

            worker.appData.webRtcServer = webRtcServer;
        }

        // Log worker resource usage every X seconds.
        setInterval(async () => {
            const usage = await worker.getResourceUsage();

            logger.info("mediasoup Worker resource usage [pid:%d]: %o", worker.pid, usage);
        }, 120000);
    }
}

async function createExpressApp() {
    logger.info("creating Express app...");

    expressApp = express();

    expressApp.use(express.json());

    /**
     * For every API request, verify that the roomId in the path matches and
     * existing room.
     */
    expressApp.param("roomId", (req, res, next, roomId: string) => {
        // The room must exist for all API requests.
        if (!rooms.has(roomId)) {
            const error: any = new Error(`room with id "${roomId}" not found`);

            error.status = 404;
            throw error;
        }

        req.room = rooms.get(roomId);

        next();
    });

    /**
     * API GET resource that returns the mediasoup Router RTP capabilities of
     * the room.
     */
    expressApp.get("/rooms/:roomId", (req, res) => {
        const data = req.room.getRouterRtpCapabilities();

        res.status(200).json(data);
    });

    /**
     * POST API to create a Broadcaster.
     */
    expressApp.post("/rooms/:roomId/broadcasters", async (req, res, next) => {
        const { id, displayName, device, rtpCapabilities } = req.body;

        try {
            const data = await req.room.createBroadcaster({
                id,
                displayName,
                device,
                rtpCapabilities,
            });

            res.status(200).json(data);
        } catch (error) {
            next(error);
        }
    });

    /**
     * DELETE API to delete a Broadcaster.
     */
    expressApp.delete("/rooms/:roomId/broadcasters/:broadcasterId", (req, res) => {
        const { broadcasterId } = req.params;

        req.room.deleteBroadcaster({ broadcasterId });

        res.status(200).send("broadcaster deleted");
    });

    /**
     * POST API to create a mediasoup Transport associated to a Broadcaster.
     * It can be a PlainTransport or a WebRtcTransport depending on the
     * type parameters in the body. There are also additional parameters for
     * PlainTransport.
     */
    expressApp.post(
        "/rooms/:roomId/broadcasters/:broadcasterId/transports",
        async (req, res, next) => {
            const { broadcasterId } = req.params;
            const { type, rtcpMux, comedia, sctpCapabilities } = req.body;

            try {
                const data = await req.room.createBroadcasterTransport({
                    broadcasterId,
                    type,
                    rtcpMux,
                    comedia,
                    sctpCapabilities,
                });

                res.status(200).json(data);
            } catch (error) {
                next(error);
            }
        }
    );

    /**
     * POST API to connect a Transport belonging to a Broadcaster. Not needed
     * for PlainTransport if it was created with comedia option set to true.
     */
    expressApp.post(
        "/rooms/:roomId/broadcasters/:broadcasterId/transports/:transportId/connect",
        async (req, res, next) => {
            const { broadcasterId, transportId } = req.params;
            const { dtlsParameters } = req.body;

            try {
                const data = await req.room.connectBroadcasterTransport({
                    broadcasterId,
                    transportId,
                    dtlsParameters,
                });

                res.status(200).json(data);
            } catch (error) {
                next(error);
            }
        }
    );

    /**
     * POST API to create a mediasoup Producer associated to a Broadcaster.
     * The exact Transport in which the Producer must be created is signaled in
     * the URL path. Body parameters include kind and rtpParameters of the
     * Producer.
     */
    expressApp.post(
        "/rooms/:roomId/broadcasters/:broadcasterId/transports/:transportId/producers",
        async (req, res, next) => {
            const { broadcasterId, transportId } = req.params;
            const { kind, rtpParameters } = req.body;

            try {
                const data = await req.room.createBroadcasterProducer({
                    broadcasterId,
                    transportId,
                    kind,
                    rtpParameters,
                });

                res.status(200).json(data);
            } catch (error) {
                next(error);
            }
        }
    );

    /**
     * POST API to create a mediasoup Consumer associated to a Broadcaster.
     * The exact Transport in which the Consumer must be created is signaled in
     * the URL path. Query parameters must include the desired producerId to
     * consume.
     */
    expressApp.post(
        "/rooms/:roomId/broadcasters/:broadcasterId/transports/:transportId/consume",
        async (req, res, next) => {
            const { broadcasterId, transportId } = req.params;
            const { producerId } = req.query;

            try {
                const data = await req.room.createBroadcasterConsumer({
                    broadcasterId,
                    transportId,
                    producerId,
                });

                res.status(200).json(data);
            } catch (error) {
                next(error);
            }
        }
    );

    /**
     * POST API to create a mediasoup DataConsumer associated to a Broadcaster.
     * The exact Transport in which the DataConsumer must be created is signaled in
     * the URL path. Query body must include the desired producerId to
     * consume.
     */
    expressApp.post(
        "/rooms/:roomId/broadcasters/:broadcasterId/transports/:transportId/consume/data",
        async (req, res, next) => {
            const { broadcasterId, transportId } = req.params;
            const { dataProducerId } = req.body;

            try {
                const data = await req.room.createBroadcasterDataConsumer({
                    broadcasterId,
                    transportId,
                    dataProducerId,
                });

                res.status(200).json(data);
            } catch (error) {
                next(error);
            }
        }
    );

    /**
     * POST API to create a mediasoup DataProducer associated to a Broadcaster.
     * The exact Transport in which the DataProducer must be created is signaled in
     */
    expressApp.post(
        "/rooms/:roomId/broadcasters/:broadcasterId/transports/:transportId/produce/data",
        async (req, res, next) => {
            const { broadcasterId, transportId } = req.params;
            const { label, protocol, sctpStreamParameters, appData } = req.body;

            try {
                const data = await req.room.createBroadcasterDataProducer({
                    broadcasterId,
                    transportId,
                    label,
                    protocol,
                    sctpStreamParameters,
                    appData,
                });

                res.status(200).json(data);
            } catch (error) {
                next(error);
            }
        }
    );

    /**
     * Error handler.
     */
    expressApp.use((error: any, req: Request, res: Response, next: NextFunction) => {
        if (error) {
            logger.warn("Express app %s", String(error));

            error.status = error.status || (error.name === "TypeError" ? 400 : 500);

            res.statusMessage = error.message;
            res.status(error.status).send(String(error));
        } else {
            next();
        }
    });
}

async function runHttpsServer() {
    logger.info("running an HTTPS server...");

    // HTTPS server for the protoo WebSocket server.
    const ssl = await devcert.certificateFor("my-app.test");

    httpsServer = https.createServer(ssl, expressApp);

    await new Promise((resolve) => {
        httpsServer.listen(Number(config.https.listenPort), config.https.listenIp, () =>
            resolve(true)
        );
    });
}

async function runProtooWebSocketServer() {
    logger.info("running protoo WebSocketServer...");

    // Create the protoo WebSocket server.
    protooWebSocketServer = new protoo.WebSocketServer(httpsServer, {
        maxReceivedFrameSize: 960000, // 960 KBytes.
        maxReceivedMessageSize: 960000,
        fragmentOutgoingMessages: true,
        fragmentationThreshold: 960000,
    });

    // Handle connections from clients.
    protooWebSocketServer.on("connectionrequest", (info, accept, reject) => {
        // The client indicates the roomId and peerId in the URL query.
        const u = url.parse(info.request.url as string, true);
        const roomId = u.query["roomId"];
        const peerId = u.query["peerId"];

        if (!roomId || typeof roomId !== "string" || !peerId || typeof peerId !== "string") {
            reject(400, "Connection request without roomId and/or peerId");

            return;
        }

        logger.info(
            "protoo connection request [roomId:%s, peerId:%s, address:%s, origin:%s]",
            roomId,
            peerId,
            info.socket.remoteAddress,
            info.origin
        );

        // Serialize this code into the queue to avoid that two peers connecting at
        // the same time with the same roomId create two separate rooms with same
        // roomId.
        queue
            .push(async () => {
                const room = await getOrCreateRoom({ roomId });

                // Accept the protoo WebSocket connection.
                const protooWebSocketTransport = accept();

                room.handleProtooConnection({ peerId, protooWebSocketTransport });
            })
            .catch((error) => {
                logger.error("room creation or room joining failed:%o", error);

                reject(error);
            });
    });
}

async function getOrCreateRoom({ roomId }: { roomId: string }) {
    let room = rooms.get(roomId);

    // If the Room does not exist create a new one.
    if (!room) {
        logger.info("creating a new Room [roomId:%s]", roomId);

        const mediasoupWorker = getMediasoupWorker();

        room = await Room.create({ mediasoupWorker, roomId });

        rooms.set(roomId, room);
        room.on("close", () => rooms.delete(roomId));
    }

    return room;
}

function getMediasoupWorker() {
    const worker = mediasoupWorkers[nextMediasoupWorkerIdx];

    if (++nextMediasoupWorkerIdx === mediasoupWorkers.length) nextMediasoupWorkerIdx = 0;

    return worker;
}
